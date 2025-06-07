import { ccc } from "@ckb-ccc/core";
import {
  defaultFindCellsLimit,
  unique,
  type ScriptDeps,
  type SmartTransaction,
  type UdtHandler,
} from "@ickb/utils";
import { daoCellFrom, DaoManager } from "@ickb/dao";
import { OwnerData } from "./entities.js";
import { OwnerCell, WithdrawalGroup, type IckbDepositCell } from "./cells.js";

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
   * @param deps - The script dependencies.
   * @param deps.ownedOwner - The script dependencies for owned owner.
   * @param daoManager - The DAO manager for handling withdrawal requests.
   * @param udtHandler - The handler for User Defined Tokens (UDTs).
   * @returns An instance of OwnedOwnerManager.
   */
  static fromDeps(
    { ownedOwner }: { ownedOwner: ScriptDeps },
    daoManager: DaoManager,
    udtHandler: UdtHandler,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._: never[]
  ): OwnedOwnerManager {
    return new OwnedOwnerManager(
      ownedOwner.script,
      ownedOwner.cellDeps,
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
      cell.outputData.length >= 10
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
   * @param options - Optional parameters for the withdrawal request.
   * @param options.isReadyOnly - Whether to only process ready deposits (default: false).
   * @returns void
   */
  requestWithdrawal(
    tx: SmartTransaction,
    deposits: IckbDepositCell[],
    lock: ccc.Script,
    options?: {
      isReadyOnly?: boolean;
    },
  ): void {
    const isReadyOnly = options?.isReadyOnly ?? false;
    if (isReadyOnly) {
      deposits = deposits.filter((d) => d.isReady);
    }
    if (deposits.length === 0) {
      return;
    }
    options = { ...options, isReadyOnly: false }; // non isReady deposits already filtered

    this.daoManager.requestWithdrawal(tx, deposits, this.script, options);
    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

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

    // Check that there are at most 64 output cells, see:
    // https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md#gotchas
    if (tx.outputs.length > 64) {
      throw Error("More than 64 output cells in a NervosDAO transaction");
    }
  }

  /**
   * Completes the withdrawals of the specified withdrawal groups.
   *
   * @param tx - The transaction to add the withdrawals to.
   * @param withdrawalGroups - The withdrawal groups to process.
   * @param options - Optional parameters for the withdrawal process.
   * @param options.isReadyOnly - Whether to only process ready withdrawal groups (default: false).
   * @returns void
   */
  withdraw(
    tx: SmartTransaction,
    withdrawalGroups: WithdrawalGroup[],
    options?: {
      isReadyOnly?: boolean;
    },
  ): void {
    const isReadyOnly = options?.isReadyOnly ?? false;
    if (isReadyOnly) {
      withdrawalGroups = withdrawalGroups.filter((g) => g.owned.isReady);
    }
    if (withdrawalGroups.length === 0) {
      return;
    }
    options = { ...options, isReadyOnly: false }; // non isReady deposits already filtered

    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    const requests = withdrawalGroups.map((g) => g.owned);
    this.daoManager.withdraw(tx, requests);

    for (const { owner } of withdrawalGroups) {
      tx.addInput(owner.cell);
    }

    // Check that there are at most 64 output cells, see:
    // https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md#gotchas
    if (tx.outputs.length > 64) {
      throw Error("More than 64 output cells in a NervosDAO transaction");
    }
  }

  /**
   * Async generator that finds and yields withdrawal groups for the specified lock scripts.
   *
   * A "withdrawal group" pairs an owner cell with its corresponding DAO withdrawal cell.
   *
   * @param client
   *   A CKB client instance providing:
   *   - `findCells(query, order, limit)` for cached searches
   *   - `findCellsOnChain(query, order, limit)` for on-chain searches
   *   - `getTipHeader()` to fetch the latest block header
   *
   * @param locks
   *   An array of lock scripts. Only owner cells whose `cellOutput.lock` exactly
   *   matches one of these scripts will be considered.
   *
   * @param options
   *   Optional parameters to refine the search:
   *   - `tip?: ClientBlockHeader`
   *       Reference block header for epoch and block-number lookups.
   *       Defaults to `await client.getTipHeader()`.
   *   - `onChain?: boolean`
   *       If `true`, uses `findCellsOnChain`; otherwise, uses `findCells`.
   *       Default: `false`.
   *   - `limit?: number`
   *       Maximum number of cells to fetch per lock script.
   *       Defaults to `defaultFindCellsLimit` (400).
   *
   * @yields
   *   {@link WithdrawalGroup} objects, each containing:
   *   - the owner cell (`OwnerCell`)
   *   - the corresponding DAO withdrawal cell (`DaoCell`)
   *
   * @remarks
   * - Deduplicates `locks` via `unique(locks)`.
   * - Applies an RPC filter with:
   *     • `script: this.script` (DAO type script)
   * - Skips any cell that:
   *     1. Fails `this.isOwner(cell)`
   *     2. Has a non-matching lock script
   * - For each owner cell:
   *     1. Construct an `OwnerCell` instance
   *     2. Fetch the owned DAO withdrawal cell via `daoCellFrom({ outpoint, isDeposit: false, client, tip })`
   *     3. Yield a new `WithdrawalGroup(ownedDaoCell, ownerCell)`
   */
  async *findWithdrawalGroups(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: {
      tip?: ccc.ClientBlockHeader;
      onChain?: boolean;
      limit?: number;
    },
  ): AsyncGenerator<WithdrawalGroup> {
    const tip = options?.tip ?? (await client.getTipHeader());
    const limit = options?.limit ?? defaultFindCellsLimit;
    for (const lock of unique(locks)) {
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
        limit,
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
        yield new WithdrawalGroup(owned, owner);
      }
    }
  }
}
