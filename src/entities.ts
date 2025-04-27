import { ccc, mol } from "@ckb-ccc/core";
import { CheckedInt32LE } from "@ickb/utils";

export interface OwnerDataLike {
  ownedDistance: ccc.NumLike;
}

@mol.codec(
  mol.struct({
    ownedDistance: CheckedInt32LE,
  }),
)
export class OwnerData extends mol.Entity.Base<OwnerDataLike, OwnerData>() {
  constructor(public ownedDistance: ccc.Num) {
    super();
  }

  static override from(data: OwnerDataLike): OwnerData {
    if (data instanceof OwnerData) {
      return data;
    }

    const { ownedDistance } = data;
    return new OwnerData(ccc.numFrom(ownedDistance));
  }

  static decodePrefix(encoded: ccc.Hex): OwnerData {
    return OwnerData.decode(encoded.slice(0, 10));
  }
}

export interface ReceiptDataLike {
  depositQuantity: ccc.NumLike;
  depositAmount: ccc.FixedPointLike;
}

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
  constructor(
    public depositQuantity: ccc.Num,
    public depositAmount: ccc.FixedPoint,
  ) {
    super();
  }

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
