import { ccc } from "@ckb-ccc/core";
import { getHeader, type TransactionHeader } from "@ickb/utils";
import { OwnerData, ReceiptData } from "./entities.js";
import { ickbValue } from "./udt.js";
import { daoCellFrom, type DaoCell } from "@ickb/dao";

/**
 * Class representing an iCKB deposit cell, which extends the DaoCell interface.
 * This class adds functionality specific to iCKB deposits, including the calculation of the iCKB value.
 */
export interface IckbDepositCell extends DaoCell {
  /**
   * The iCKB value associated with this deposit cell.
   * This value is calculated based on the cell's free capacity and the deposit transaction header.
   */
  udtValue: ccc.FixedPoint;
}

/**
 * Creates an iCKBDepositCell instance from the provided parameters.
 *
 * @param options - The options to create a DaoCell. It can be one of the following:
 * - An object omitting "interests" and "maturity" from DaoCell.
 * - An object containing a cell, isDeposit flag, client, and an optional tip.
 * - An object containing an outpoint, isDeposit flag, client, and an optional tip.
 * - an instance of `DaoCell`.
 *
 * @returns A promise that resolves to an iCKBDepositCell instance.
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
  };
}

/**
 * Represents a receipt cell containing the receipt for iCKB Deposits.
 */
export interface ReceiptCell {
  /** The cell associated with the receipt. */
  cell: ccc.Cell;

  /** The transaction header associated with the receipt cell. */
  header: TransactionHeader;

  /**
   * The iCKB value associated with this receipt cell.
   * This value is calculated based on the deposit amount and quantity from the receipt data.
   */
  udtValue: ccc.FixedPoint;
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
    udtValue: ickbValue(depositAmount, header.header) * depositQuantity,
  };
}

/**
 * Represents a WithdrawalGroups
 */
export interface WithdrawalGroups {
  /** The DAO withdrawal request cell associated with the group. */
  owned: DaoCell;
  /** The owner cell associated with the group. */
  owner: OwnerCell;
}

/**
 * Represents a cell that contains ownership information.
 */
export class OwnerCell {
  /**
   * Creates an instance of OwnerCell.
   *
   * @param cell - The cell associated with the owner.
   */
  constructor(public cell: ccc.Cell) {}

  /**
   * Retrieves the out point of the owned cell based on the owner's distance.
   *
   * @returns The out point of the owned cell.
   */
  getOwned(): ccc.OutPoint {
    const { txHash, index } = this.cell.outPoint;
    const { ownedDistance } = OwnerData.decodePrefix(this.cell.outputData);
    return new ccc.OutPoint(txHash, index + ownedDistance);
  }
}
