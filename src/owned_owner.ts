import { ccc } from "@ckb-ccc/core";
import type { ScriptDeps, SmartTransaction, UdtHandler } from "@ickb/utils";
import { daoCellFrom, DaoManager } from "@ickb/dao";
import { OwnerData } from "./entities.js";
import {
  OwnerCell,
  type IckbDepositCell,
  type WithdrawalGroups,
} from "./cells.js";

/**
 * Manages ownership and withdrawal operations for owned cells.
 * Implements the ScriptDeps interface.
 */
export class OwnedOwnerManager implements ScriptDeps {
  /**
   * Creates an instance of OwnedOwnerManager.
   *
   * @param script - The script associated with the OwnedOwner script.
   * @param cellDeps - The cell dependencies for the OwnedOwner script.
   * @param daoManager - The DAO manager for handling withdrawal requests.
   * @param udtHandler - The handler for User Defined Tokens (UDTs).
   */
  constructor(
    public readonly script: ccc.Script,
    public readonly cellDeps: ccc.CellDep[],
    public readonly daoManager: DaoManager,
    public readonly udtHandler: UdtHandler,
  ) {}

  /**
   * Creates an instance of OwnedOwnerManager from existing dependencies.
   *
   * @param deps - The existing script dependencies.
   * @param daoManager - The DAO manager for handling withdrawal requests.
   * @param udtHandler - The handler for User Defined Tokens (UDTs).
   * @returns An instance of OwnedOwnerManager.
   */
  static fromDeps(
    deps: ScriptDeps,
    daoManager: DaoManager,
    udtHandler: UdtHandler,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._: never[]
  ): OwnedOwnerManager {
    return new OwnedOwnerManager(
      deps.script,
      deps.cellDeps,
      daoManager,
      udtHandler,
    );
  }

  /**
   * Checks if the specified cell is an owner cell.
   *
   * @param cell - The cell to check against.
   * @returns True if the cell is an owner cell, otherwise false.
   */
  isOwner(cell: ccc.Cell): boolean {
    return (
      Boolean(cell.cellOutput.type?.eq(this.script)) &&
      !!OwnerData.decodePrefix(cell.outputData)
    );
  }

  /**
   * Checks if the specified cell is an owned cell and is a withdrawal request.
   *
   * @param cell - The cell to check against.
   * @returns True if the cell is owned cell, otherwise false.
   */
  isOwned(cell: ccc.Cell): boolean {
    return (
      this.daoManager.isWithdrawalRequest(cell) &&
      cell.cellOutput.lock.eq(this.script)
    );
  }

  /**
   * Requests a withdrawal for the specified deposits.
   *
   * @param tx - The transaction to add the withdrawal request to.
   * @param deposits - The deposits to withdraw.
   * @param lock - The lock script for the output.
   */
  requestWithdrawal(
    tx: SmartTransaction,
    deposits: IckbDepositCell[],
    lock: ccc.Script,
  ): void {
    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    this.daoManager.requestWithdrawal(tx, deposits, this.script);

    const outputData = OwnerData.encode({ ownedDistance: -deposits.length });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of deposits) {
      tx.addOutput(
        {
          lock: lock,
          type: this.script,
        },
        outputData,
      );
    }
  }

  /**
   * Complete the withdraws of the specified withdrawal groups.
   *
   * @param tx - The transaction to add the withdrawals to.
   * @param withdrawalGroups - The withdrawal groups to process.
   */
  withdraw(tx: SmartTransaction, withdrawalGroups: WithdrawalGroups[]): void {
    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    const requests = withdrawalGroups.map((g) => g.owned);
    this.daoManager.withdraw(tx, requests);

    for (const { owner } of withdrawalGroups) {
      tx.addInput(owner.cell);
    }
  }

  /**
   * Asynchronously finds withdrawal groups associated with a given lock script.
   *
   * @param client - The client used to interact with the blockchain.
   * @param locks - The lock scripts to filter withdrawal groups.
   * @param options - Optional parameters for the search.
   * @param {ccc.ClientBlockHeader} options.tip - The block header to use as the tip for the search. If not provided, the latest block header will be fetched.   * @param options.onChain - A boolean indicating whether to use the cells cache or directly search on-chain.
   * @returns An async generator that yields WithdrawalGroups objects.
   */
  async *findWithdrawalGroups(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: {
      tip?: ccc.ClientBlockHeader;
      onChain?: boolean;
    },
  ): AsyncGenerator<WithdrawalGroups> {
    const tip = options?.tip ?? (await client.getTipHeader());
    for (const lock of locks) {
      const findCellsArgs = [
        {
          script: lock,
          scriptType: "lock",
          filter: {
            script: this.script,
          },
          scriptSearchMode: "exact",
          withData: true,
        },
        "asc",
        400, // https://github.com/nervosnetwork/ckb/pull/4576
      ] as const;

      for await (const cell of options?.onChain
        ? client.findCellsOnChain(...findCellsArgs)
        : client.findCells(...findCellsArgs)) {
        if (!this.isOwner(cell) || !cell.cellOutput.lock.eq(lock)) {
          continue;
        }

        const owner = new OwnerCell(cell);
        const owned = await daoCellFrom({
          outpoint: owner.getOwned(),
          isDeposit: false,
          client,
          tip,
        });
        yield { owned, owner };
      }
    }
  }
}
