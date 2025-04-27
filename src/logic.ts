import { ccc } from "@ckb-ccc/core";
import { ReceiptData } from "./entities.js";
import {
  getHeader,
  type ScriptDeps,
  type SmartTransaction,
  type TransactionHeader,
  type UdtHandler,
} from "@ickb/utils";
import { DaoManager, type DepositCell } from "@ickb/dao";

export class LogicManager implements ScriptDeps {
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
  ): LogicManager {
    return new LogicManager(c.script, c.cellDeps, daoManager, udtHandler);
  }

  isReceipt(cell: ccc.Cell): boolean {
    return Boolean(cell.cellOutput.type?.eq(this.script));
  }

  isDeposit(cell: ccc.Cell): boolean {
    return (
      this.daoManager.isDeposit(cell) && cell.cellOutput.lock.eq(this.script)
    );
  }

  deposit(
    tx: SmartTransaction,
    depositQuantity: ccc.NumLike,
    depositAmount: ccc.FixedPointLike,
    lock: ccc.ScriptLike,
  ): void {
    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    const capacities = Array.from(
      { length: Number(depositQuantity) },
      () => depositAmount,
    );
    this.daoManager.deposit(tx, capacities, this.script);

    // Add the Receipt to the outputs
    tx.addOutput(
      {
        lock: lock,
        type: this.script,
      },
      ReceiptData.encode({ depositQuantity, depositAmount }),
    );
  }

  completeDeposit(tx: SmartTransaction, receipts: ReceiptCell[]): void {
    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    tx.addHeaders(receipts.map((r) => r.header));

    for (const { cell } of receipts) {
      tx.addInput(cell);
    }
  }

  async *findReceipts(
    client: ccc.Client,
    locks: ccc.ScriptLike[],
    options?: {
      onChain?: boolean;
    },
  ): AsyncGenerator<ReceiptCell> {
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
        if (!this.isReceipt(cell) || !cell.cellOutput.lock.eq(lock)) {
          continue;
        }

        yield ReceiptCell.fromClient(client, cell);
      }
    }
  }

  findDeposits(
    client: ccc.Client,
    options?: {
      onChain?: boolean;
    },
  ): AsyncGenerator<DepositCell> {
    return this.daoManager.findDeposits(client, [this.script], options);
  }
}

export class ReceiptCell {
  constructor(
    public cell: ccc.Cell,
    public header: TransactionHeader,
  ) {}

  static async fromClient(
    client: ccc.Client,
    c: ccc.Cell | ccc.OutPoint,
  ): Promise<ReceiptCell> {
    const cell = "cellOutput" in c ? c : await client.getCell(c);
    if (!cell) {
      throw Error("No Receipt Cell not found at the outPoint");
    }

    const txHash = cell.outPoint.txHash;
    const header = await getHeader(client, {
      type: "txHash",
      value: txHash,
    });

    return new ReceiptCell(cell, { header, txHash });
  }
}
