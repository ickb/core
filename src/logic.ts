import { ccc } from "@ckb-ccc/core";
import {
  type ScriptDeps,
  type SmartTransaction,
  type UdtHandler,
} from "@ickb/utils";
import { DaoManager } from "@ickb/dao";
import {
  IckbDepositCell,
  ickbDepositCellFrom,
  ReceiptCell,
  receiptCellFrom,
} from "./cells.js";
import { ReceiptData } from "./entities.js";

/**
 * Manages logic related to deposits and receipts in the blockchain.
 * Implements the ScriptDeps interface.
 */
export class LogicManager implements ScriptDeps {
  /**
   * Creates an instance of LogicManager.
   *
   * @param script - The script associated with the manager.
   * @param cellDeps - The cell dependencies for the manager.
   * @param daoManager - The DAO manager for handling deposits and receipts.
   * @param udtHandler - The handler for User Defined Tokens (UDTs).
   */
  constructor(
    public readonly script: ccc.Script,
    public readonly cellDeps: ccc.CellDep[],
    public readonly daoManager: DaoManager,
    public readonly udtHandler: UdtHandler,
  ) {}

  /**
   * Creates an instance of LogicManager from existing dependencies.
   *
   * @param deps - The existing script dependencies.
   * @param daoManager - The DAO manager for handling deposits and receipts.
   * @param udtHandler - The handler for User Defined Tokens (UDTs).
   * @returns An instance of LogicManager.
   */
  static fromDeps(
    deps: ScriptDeps,
    daoManager: DaoManager,
    udtHandler: UdtHandler,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._: never[]
  ): LogicManager {
    return new LogicManager(deps.script, deps.cellDeps, daoManager, udtHandler);
  }

  /**
   * Checks if the specified cell is an iCKB receipt.
   *
   * @param cell - The cell to check.
   * @returns True if the cell is a receipt, otherwise false.
   */
  isReceipt(cell: ccc.Cell): boolean {
    return Boolean(cell.cellOutput.type?.eq(this.script));
  }

  /**
   * Checks if the specified cell is an iCKB deposit.
   *
   * @param cell - The cell to check.
   * @returns True if the cell is a deposit, otherwise false.
   */
  isDeposit(cell: ccc.Cell): boolean {
    return (
      this.daoManager.isDeposit(cell) && cell.cellOutput.lock.eq(this.script)
    );
  }

  /**
   * Processes a deposit transaction.
   *
   * @param tx - The transaction to add the deposit to.
   * @param depositQuantity - The quantity of deposits.
   * @param depositAmount - The amount of each deposit.
   * @param lock - The lock script for the output receipt cell.
   */
  deposit(
    tx: SmartTransaction,
    depositQuantity: ccc.Num,
    depositAmount: ccc.FixedPoint,
    lock: ccc.Script,
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

  /**
   * Completes a deposit transaction by transforming the receipts into iCKB UDTs.
   *
   * @param tx - The transaction to add the receipts to.
   * @param receipts - The receipts to add to the transaction.
   */
  completeDeposit(tx: SmartTransaction, receipts: ReceiptCell[]): void {
    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    tx.addHeaders(receipts.map((r) => r.header));

    for (const { cell } of receipts) {
      tx.addInput(cell);
    }
  }

  /**
   * Asynchronously finds receipt cells associated with given lock scripts.
   *
   * @param client - The client used to interact with the blockchain.
   * @param locks - The lock scripts to filter receipt cells.
   * @param options - Optional parameters for the search.
   * @param options.onChain - A boolean indicating whether to use the cells cache or directly search on-chain.
   * @returns An async generator that yields ReceiptCell objects.
   */
  async *findReceipts(
    client: ccc.Client,
    locks: ccc.Script[],
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

        yield receiptCellFrom({ client, cell });
      }
    }
  }

  /**
   * Asynchronously finds iCKB deposit cells.
   *
   * @param {ccc.Client} client - The client used to interact with the blockchain.
   * @param {Object} [options] - Optional parameters for the deposit search.
   * @param {ccc.ClientBlockHeader} [options.tip] - The block header to use as the tip for the search. If not provided, the latest block header will be fetched.
   * @param {boolean} [options.onChain] - A flag indicating whether to search for on-chain deposits.
   * @param {ccc.Epoch} [options.minLockUp] - An optional minimum lock-up period in epochs (Default 15 minutes)
   * @param {ccc.Epoch} [options.maxLockUp] An optional maximum lock-up period in epochs (Default 3 days)
   *
   * @returns {AsyncGenerator<IckbDepositCell>} An asynchronous generator that yields iCKB deposit cells.
   */
  async *findDeposits(
    client: ccc.Client,
    options?: {
      tip?: ccc.ClientBlockHeader;
      onChain?: boolean;
      minLockUp?: ccc.Epoch;
      maxLockUp?: ccc.Epoch;
    },
  ): AsyncGenerator<IckbDepositCell> {
    const tip = options?.tip
      ? ccc.ClientBlockHeader.from(options.tip)
      : await client.getTipHeader();
    options = { ...options, tip };

    for await (const deposit of this.daoManager.findDeposits(
      client,
      [this.script],
      options,
    )) {
      yield ickbDepositCellFrom(deposit);
    }
  }
}
