import { ccc } from "@ckb-ccc/core";
import {
  getHeader,
  type TransactionHeader,
  type ValueComponents,
} from "@ickb/utils";
import { OwnerData, ReceiptData } from "./entities.js";
import { ickbValue } from "./udt.js";
import { daoCellFrom, type DaoCell } from "@ickb/dao";

export interface IckbDepositCell extends DaoCell {
  /**
   * A symbol property indicating that this cell is a Ickb Deposit Cell.
   * This property is always set to true.
   */
  [isIckbDepositSymbol]: true;
}

// Symbol to represent the isIckbDeposit property of Ickb Deposit Cells
const isIckbDepositSymbol = Symbol("isIckbDeposit");

/**
 * Creates an IckbDepositCell from the provided parameters.
 *
 * @param options - The options to create a DaoCell. It can be one of the following:
 * - An object omitting "interests" and "maturity" from DaoCell.
 * - An object containing a cell, isDeposit flag, client, and an optional tip.
 * - An object containing an outpoint, isDeposit flag, client, and an optional tip.
 * - an instance of `DaoCell`.
 *
 * @returns A promise that resolves to a IckbDepositCell instance.
 *
 * @throws Error if the cell is not found.
 */
export async function ickbDepositCellFrom(
  options: Parameters<typeof daoCellFrom>[0] | DaoCell,
): Promise<IckbDepositCell> {
  const daoCell = "maturity" in options ? options : await daoCellFrom(options);
  return {
    ...daoCell,
    udtValue: ickbValue(daoCell.cell.capacityFree, daoCell.headers[0].header),
    [isIckbDepositSymbol]: true,
  };
}

/**
 * Represents a receipt cell containing the receipt for iCKB Deposits.
 */
export interface ReceiptCell extends ValueComponents {
  /** The cell associated with the receipt. */
  cell: ccc.Cell;

  /** The transaction header associated with the receipt cell. */
  header: TransactionHeader;
}

/**
 * Creates a ReceiptCell instance from the provided options.
 * @param options - Options for creating a ReceiptCell.
 * @returns A promise that resolves to a ReceiptCell instance.
 * @throws ReceiptCellError if the cell is not found.
 */
export async function receiptCellFrom(
  options:
    | {
        cell: ccc.Cell;
        client: ccc.Client;
      }
    | {
        outpoint: ccc.OutPoint;
        client: ccc.Client;
      },
): Promise<ReceiptCell> {
  const cell =
    "cell" in options
      ? options.cell
      : await options.client.getCell(options.outpoint);
  if (!cell) {
    throw Error("Cell not found");
  }

  const txHash = cell.outPoint.txHash;
  const header = {
    header: await getHeader(options.client, {
      type: "txHash",
      value: txHash,
    }),
    txHash,
  };
  const { depositQuantity, depositAmount } = ReceiptData.decode(
    cell.outputData,
  );

  return {
    cell,
    header,
    ckbValue: cell.cellOutput.capacity,
    udtValue: ickbValue(depositAmount, header.header) * depositQuantity,
  };
}

/**
 * Represents a WithdrawalGroup
 *
 * @property owned - The DAO withdrawal request cell associated with the group.
 * @property owner - The owner cell associated with the group.
 */
export class WithdrawalGroup implements ValueComponents {
  constructor(
    public owned: DaoCell,
    public owner: OwnerCell,
  ) {}

  /**
   * Gets the CKB value of the group.
   *
   * @returns The total CKB amount as a `ccc.Num`, which is the sum of the CKB values of the owned cell and the owner cell.
   */
  get ckbValue(): ccc.Num {
    return this.owned.ckbValue + this.owner.cell.cellOutput.capacity;
  }

  /**
   * Gets the UDT value of the group.
   *
   * @returns The UDT amount as a `ccc.Num`, derived from the owned cell.
   */
  get udtValue(): ccc.Num {
    return this.owned.udtValue;
  }
}

/**
 * Represents a cell that contains ownership information.
 */
export class OwnerCell implements ValueComponents {
  /**
   * Creates an instance of OwnerCell.
   *
   * @param cell - The cell associated with the owner.
   */
  constructor(public cell: ccc.Cell) {}

  /**
   * Gets the CKB value of the cell.
   *
   * @returns The CKB amount as a `ccc.Num`.
   */
  get ckbValue(): ccc.Num {
    return this.cell.cellOutput.capacity;
  }

  /**
   * Gets the UDT value of the cell.
   *
   * @returns The UDT amount as a `ccc.Num`, which is always zero for this cell.
   */
  get udtValue(): ccc.Num {
    return ccc.Zero;
  }

  /**
   * Retrieves the out point of the owned cell based on the owner's distance.
   *
   * @returns The out point of the owned cell as a `ccc.OutPoint`.
   */
  getOwned(): ccc.OutPoint {
    const { txHash, index } = this.cell.outPoint;
    const { ownedDistance } = OwnerData.decodePrefix(this.cell.outputData);
    return new ccc.OutPoint(txHash, index + ownedDistance);
  }
}
