import { ccc } from "@ckb-ccc/core";
import { OwnerData } from "./entities.js";
import type { ScriptDeps, SmartTransaction, UdtHandler } from "@ickb/utils";
import { DaoManager, DepositCell, WithdrawalRequestCell } from "@ickb/dao";

export class OwnedOwnerManager implements ScriptDeps {
  constructor(
    public script: ccc.Script,
    public cellDeps: ccc.CellDep[],
    public daoManager: DaoManager,
    public udtHandler: UdtHandler,
  ) {}

  static fromDeps(
    c: ScriptDeps,
    daoManager: DaoManager,
    udtHandler: UdtHandler,
  ): OwnedOwnerManager {
    return new OwnedOwnerManager(c.script, c.cellDeps, daoManager, udtHandler);
  }

  isOwner(cell: ccc.Cell): boolean {
    return (
      Boolean(cell.cellOutput.type?.eq(this.script)) &&
      !!OwnerData.decodePrefix(cell.outputData)
    );
  }

  isOwned(cell: ccc.Cell): boolean {
    return (
      this.daoManager.isWithdrawalRequest(cell) &&
      cell.cellOutput.lock.eq(this.script)
    );
  }

  requestWithdrawal(
    tx: SmartTransaction,
    deposits: DepositCell[],
    lock: ccc.ScriptLike,
  ): void {
    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    tx = this.daoManager.requestWithdrawal(tx, deposits, this.script);

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

  withdraw(tx: SmartTransaction, withdrawalGroups: WithdrawalGroups[]): void {
    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    const requests = withdrawalGroups.map((g) => g.owned);
    this.daoManager.withdraw(tx, requests);

    for (const { owner } of withdrawalGroups) {
      tx.addInput(owner.cell);
    }
  }

  async *findWithdrawalGroups(
    client: ccc.Client,
    lock: ccc.ScriptLike,
    options?: {
      onChain?: boolean;
    },
  ): AsyncGenerator<WithdrawalGroups> {
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
      const owned = await WithdrawalRequestCell.fromClient(
        client,
        owner.getOwned(),
      );

      yield { owned, owner };
    }
  }
}

export interface WithdrawalGroups {
  owned: WithdrawalRequestCell;
  owner: OwnerCell;
}

export class OwnerCell {
  constructor(public cell: ccc.Cell) {}

  getOwned(): ccc.OutPoint {
    const { txHash, index } = this.cell.outPoint;
    const { ownedDistance } = OwnerData.decodePrefix(this.cell.outputData);
    return new ccc.OutPoint(txHash, index + ownedDistance);
  }
}
