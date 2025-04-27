import { ccc } from "@ckb-ccc/core";
import type { WithdrawalRequestCell } from "@ickb/dao";
import { getHeader, type TransactionHeader } from "@ickb/utils";
import { OwnerData } from "./entities.js";

/**
 * Represents a receipt cell containing the receipt for iCKB Deposits.
 */
export class ReceiptCell {
  /**
   * Creates an instance of ReceiptCell.
   *
   * @param cell - The cell associated with the receipt.
   * @param header - The transaction header associated with the receipt cell.
   */
  constructor(
    public cell: ccc.Cell,
    public header: TransactionHeader,
  ) {}

  /**
   * Creates a ReceiptCell instance from a client and a cell or out point.
   *
   * @param client - The client used to interact with the blockchain.
   * @param c - The cell or out point to retrieve the receipt cell from.
   * @returns A promise that resolves to a ReceiptCell instance.
   * @throws Error if the receipt cell is not found at the specified out point.
   */
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

/**
 * Represents a grouping of withdrawal-related data.
 */
export interface WithdrawalGroups {
  /** The withdrawal request cell associated with the group. */
  owned: WithdrawalRequestCell;
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
