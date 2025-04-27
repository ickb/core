import { ccc, mol } from "@ckb-ccc/core";
import { CheckedInt32LE } from "@ickb/utils";

/**
 * Represents a permissive data structure of the owner data of the owned owner script.
 */
export interface OwnerDataLike {
  /** The signed distance between owner and owned cell in the mint transaction. */
  ownedDistance: ccc.NumLike;
}

/**
 * Represents the data structure to encode the owner data of the owned owner script.
 *
 * @extends mol.Entity.Base<OwnerDataLike, OwnerData>
 */
@mol.codec(
  mol.struct({
    ownedDistance: CheckedInt32LE,
  }),
)
export class OwnerData extends mol.Entity.Base<OwnerDataLike, OwnerData>() {
  /**
   * Creates an instance of OwnerData.
   *
   * @param ownedDistance - The signed distance between owner and owned cell in the mint transaction.
   */
  constructor(public ownedDistance: ccc.Num) {
    super();
  }

  /**
   * Creates an instance of OwnerData from the provided data.
   *
   * @param data - The data to create the OwnerData instance from.
   * @returns An instance of OwnerData.
   */
  static override from(data: OwnerDataLike): OwnerData {
    if (data instanceof OwnerData) {
      return data;
    }

    const { ownedDistance } = data;
    return new OwnerData(ccc.numFrom(ownedDistance));
  }

  /**
   * Decodes a prefix from the encoded data.
   *
   * @param encoded - The encoded data to decode.
   * @returns An instance of OwnerData.
   */
  static decodePrefix(encoded: ccc.Hex): OwnerData {
    return OwnerData.decode(encoded.slice(0, 10));
  }
}

/**
 * Represents a permissive data structure of the data structure for a receipt.
 */
export interface ReceiptDataLike {
  /** The quantity of deposits. */
  depositQuantity: ccc.NumLike;
  /** The total amount of deposits. */
  depositAmount: ccc.FixedPointLike;
}

/**
 * Represents receipt data containing deposit information.
 *
 * @extends mol.Entity.Base<ReceiptDataLike, ReceiptData>
 */
@mol.codec(
  mol.struct({
    depositQuantity: mol.Uint32,
    depositAmount: mol.Uint64,
  }),
)
export class ReceiptData extends mol.Entity.Base<
  ReceiptDataLike,
  ReceiptData
>() {
  /**
   * Creates an instance of ReceiptData.
   *
   * @param depositQuantity - The quantity of deposits.
   * @param depositAmount - The total amount of deposits.
   */
  constructor(
    public depositQuantity: ccc.Num,
    public depositAmount: ccc.FixedPoint,
  ) {
    super();
  }

  /**
   * Creates an instance of ReceiptData from the provided data.
   *
   * @param data - The data to create the ReceiptData instance from.
   * @returns An instance of ReceiptData.
   */
  static override from(data: ReceiptDataLike): ReceiptData {
    if (data instanceof ReceiptData) {
      return data;
    }

    const { depositQuantity, depositAmount } = data;
    return new ReceiptData(
      ccc.numFrom(depositQuantity),
      ccc.fixedPointFrom(depositAmount),
    );
  }
}
