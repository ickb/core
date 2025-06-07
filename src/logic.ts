import { ccc } from "@ckb-ccc/core";
import {
  defaultFindCellsLimit,
  unique,
  type Epoch,
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
   * @param deps - The script dependencies.
   * @param deps.ickbLogic - The script dependencies for iCKB logic.
   * @param daoManager - The DAO manager for handling deposits and receipts.
   * @param udtHandler - The handler for User Defined Tokens (UDTs).
   * @returns An instance of LogicManager.
   */
  static fromDeps(
    {
      ickbLogic,
    }: {
      ickbLogic: ScriptDeps;
    },
    daoManager: DaoManager,
    udtHandler: UdtHandler,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._: never[]
  ): LogicManager {
    return new LogicManager(
      ickbLogic.script,
      ickbLogic.cellDeps,
      daoManager,
      udtHandler,
    );
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
    depositQuantity: number,
    depositAmount: ccc.FixedPoint,
    lock: ccc.Script,
  ): void {
    if (depositQuantity <= 0) {
      return;
    }

    if (depositAmount < ccc.fixedPointFrom(1082)) {
      throw Error("iCKB deposit minimum is 1082 CKB");
    }

    if (depositAmount > ccc.fixedPointFrom(1000082)) {
      throw Error("iCKB deposit minimum is 1082 CKB");
    }

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

    // Check that there are at most 64 output cells, see:
    // https://github.com/nervosnetwork/rfcs/blob/master/rfcs/0023-dao-deposit-withdraw/0023-dao-deposit-withdraw.md#gotchas
    if (tx.outputs.length > 64) {
      throw Error("More than 64 output cells in a NervosDAO transaction");
    }
  }

  /**
   * Completes a deposit transaction by transforming the receipts into iCKB UDTs.
   *
   * @param tx - The transaction to add the receipts to.
   * @param receipts - The receipts to add to the transaction.
   */
  completeDeposit(tx: SmartTransaction, receipts: ReceiptCell[]): void {
    if (receipts.length === 0) {
      return;
    }

    tx.addCellDeps(this.cellDeps);
    tx.addUdtHandlers(this.udtHandler);

    tx.addHeaders(receipts.map((r) => r.header));

    for (const { cell } of receipts) {
      tx.addInput(cell);
    }
  }

  /**
   * Async generator that finds and yields receipt cells matching the given lock scripts.
   *
   * Receipt cells are identified by `this.script` (the receipt type script)
   * and must also pass `this.isReceipt(cell)`.
   *
   * @param client
   *   A CKB client instance providing:
   *   - `findCells(query, order, limit)` for cached searches
   *   - `findCellsOnChain(query, order, limit)` for direct on-chain searches
   *
   * @param locks
   *   An array of lock scripts. Only cells whose `cellOutput.lock` exactly matches
   *   one of these scripts will be considered.
   *
   * @param options
   *   Optional parameters to control query behavior:
   *   - `onChain?: boolean`
   *       If `true`, uses `findCellsOnChain`. Otherwise, uses `findCells`. Default: `false`.
   *   - `limit?: number`
   *       Maximum number of cells to fetch per lock script. Defaults to `defaultFindCellsLimit` (400).
   *
   * @yields
   *   {@link ReceiptCell} objects for each valid receipt cell found.
   *
   * @remarks
   * - Deduplicates `locks` via `unique(locks)`.
   * - Applies an RPC filter with:
   *     - `script: this.script` (receipt type script)
   * - Skips any cell that:
   *     1. Fails `this.isReceipt(cell)`
   *     2. Has a non-matching lock script
   * - Converts each raw cell via `receiptCellFrom({ client, cell })` before yielding.
   */
  async *findReceipts(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: {
      /**
       * If true, fetch cells directly from the chain RPC. Otherwise, use cached results.
       * @default false
       */
      onChain?: boolean;
      /**
       * Batch size per lock script. Defaults to {@link defaultFindCellsLimit}.
       */
      limit?: number;
    },
  ): AsyncGenerator<ReceiptCell> {
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
        if (!this.isReceipt(cell) || !cell.cellOutput.lock.eq(lock)) {
          continue;
        }

        yield receiptCellFrom({ client, cell });
      }
    }
  }

  /**
   * Async generator that finds and yields iCKB deposit cells.
   *
   * Wraps DAO deposit detection for the iCKB token by delegating
   * to `this.daoManager.findDeposits` and converting results.
   *
   * @param client
   *   A CKB RPC client instance implementing:
   *   - `getTipHeader()` to fetch the latest block header
   *   - `findCells` / `findCellsOnChain` for cell queries
   *
   * @param options
   *   Optional parameters to control the search:
   *   - `tip?: ClientBlockHeader`
   *       Block header to use as reference for epoch/lock calculations.
   *       If omitted, `client.getTipHeader()` is called to obtain the latest header.
   *   - `onChain?: boolean`
   *       When `true`, forces direct on-chain queries via `findCellsOnChain`.
   *       Otherwise, uses cached results via `findCells`. Default: `false`.
   *   - `minLockUp?: Epoch`
   *       Minimum lock-up period in epochs. Defaults to manager’s configured minimum (~10 min).
   *   - `maxLockUp?: Epoch`
   *       Maximum lock-up period in epochs. Defaults to manager’s configured maximum (~3 days).
   *   - `limit?: number`
   *       Maximum cells per batch when querying. Defaults to `defaultFindCellsLimit` (400).
   *
   * @returns
   *   An async generator yielding `IckbDepositCell` objects, each representing
   *   an iCKB deposit derived from a DAO deposit cell.
   *
   * @remarks
   * - Enforces that `options.tip` is a `ClientBlockHeader` instance by calling
   *   `ClientBlockHeader.from(...)` if a plain object is provided.
   * - Delegates to `this.daoManager.findDeposits(client, [this.script], options)` to locate
   *   raw DAO deposit cells locked under `this.script`.
   * - Converts each raw `DaoCell` into an `IckbDepositCell` via `ickbDepositCellFrom`.
   */
  async *findDeposits(
    client: ccc.Client,
    options?: {
      tip?: ccc.ClientBlockHeader;
      onChain?: boolean;
      minLockUp?: Epoch;
      maxLockUp?: Epoch;
      limit?: number;
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
