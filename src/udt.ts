import { ccc } from "@ckb-ccc/core";
import { ReceiptData } from "./entities.js";
import type { DaoManager } from "@ickb/dao";
import {
  UdtManager,
  type ExchangeRatio,
  type ScriptDeps,
  type SmartTransaction,
  type UdtHandler,
} from "@ickb/utils";

/**
 * IckbUdtManager is a class that implements the UdtHandler interface.
 * It is responsible for handling UDT (User Defined Token) operations related to iCKB.
 */
export class IckbUdtManager extends UdtManager implements UdtHandler {
  /**
   * Creates an instance of IckbUdtManager.
   * @param script - The script associated with the UDT.
   * @param cellDeps - An array of cell dependencies.
   * @param logicScript - The iCKB Logic script.
   * @param daoManager - The DAO manager instance.
   */
  constructor(
    script: ccc.Script,
    cellDeps: ccc.CellDep[],
    public readonly logicScript: ccc.Script,
    public readonly daoManager: DaoManager,
  ) {
    super(script, cellDeps);
  }

  /**
   * Creates an instance of IckbUdtManager from script dependencies and a DAO manager.
   * @param deps - The script dependencies.
   * @param deps.udt - The script dependencies for UDT (args is recalculated from ickbLogic).
   * @param deps.ickbLogic - The script dependencies for iCKB logic.
   * @param daoManager - The DAO manager instance.
   * @returns An instance of IckbUdtManager.
   */
  static override fromDeps(
    deps: {
      udt: ScriptDeps;
      ickbLogic: { script: ccc.Script };
    },
    daoManager: DaoManager,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ..._: never[]
  ): IckbUdtManager {
    const {
      udt: {
        script: { codeHash, hashType },
        cellDeps,
      },
      ickbLogic: { script: logicScript },
    } = deps;
    const udtScript = new ccc.Script(
      codeHash,
      hashType,
      [logicScript.hash(), "00000080"].join("") as ccc.Hex,
    );
    return new IckbUdtManager(udtScript, cellDeps, logicScript, daoManager);
  }

  /**
   * Asynchronously retrieves the iCKB balance of inputs in a transaction.
   * @param client - The client used to interact with the blockchain.
   * @param tx - The smart transaction containing the inputs.
   * @returns A promise that resolves to the total iCKB balance of the inputs.
   * @throws Error if an input is not well defined.
   */
  override async getInputsUdtBalance(
    client: ccc.Client,
    tx: SmartTransaction,
  ): Promise<ccc.FixedPoint> {
    return ccc.reduceAsync(
      tx.inputs,
      async (acc, input) => {
        // Get all cell info
        await input.completeExtraInfos(client);
        const { previousOutput: outPoint, cellOutput, outputData } = input;

        // Input is not well defined
        if (!cellOutput || !outputData) {
          throw new Error("Unable to complete input");
        }

        const { type, lock } = cellOutput;

        if (!type) {
          return acc;
        }

        const cell = new ccc.Cell(outPoint, cellOutput, outputData);

        // An iCKB UDT Cell
        if (this.isUdt(cell)) {
          return acc + ccc.udtBalanceFrom(outputData);
        }

        // An iCKB Receipt
        if (this.logicScript.eq(type)) {
          // Get header of Receipt cell and check its inclusion in HeaderDeps
          const header = await tx.getHeader(client, {
            type: "txHash",
            value: outPoint.txHash,
          });

          const { depositQuantity, depositAmount } =
            ReceiptData.decode(outputData);

          return acc + ickbValue(depositAmount, header) * depositQuantity;
        }

        // An iCKB Deposit for which the withdrawal is being requested
        if (this.logicScript.eq(lock) && this.daoManager.isDeposit(cell)) {
          // Get header of Deposit cell and check its inclusion in HeaderDeps
          const header = await tx.getHeader(client, {
            type: "txHash",
            value: outPoint.txHash,
          });

          return acc - ickbValue(cell.capacityFree, header);
        }

        return acc;
      },
      ccc.Zero,
    );
  }
}

/**
 * Calculates the iCKB value based on the unoccupied CKB capacity and the block header.
 *
 * @param ckbUnoccupiedCapacity - The unoccupied capacity in CKB.
 * @param header - The block header used for conversion.
 * @returns The calculated iCKB amount.
 */
export function ickbValue(
  ckbUnoccupiedCapacity: ccc.FixedPoint,
  header: ccc.ClientBlockHeader,
): ccc.FixedPoint {
  let ickbAmount = convert(true, ckbUnoccupiedCapacity, header, false);
  if (ICKB_DEPOSIT_CAP < ickbAmount) {
    // Apply a 10% discount for the amount exceeding the soft iCKB cap per deposit.
    ickbAmount -= (ickbAmount - ICKB_DEPOSIT_CAP) / 10n;
  }

  return ickbAmount;
}

/** The maximum deposit cap for iCKB, set to 100,000 iCKB. */
export const ICKB_DEPOSIT_CAP = ccc.fixedPointFrom(100000); // 100,000 iCKB

/**
 * Converts between CKB and iCKB based on the provided ratio.
 *
 * @param isCkb2Udt - A boolean indicating the direction of conversion (CKB to iCKB or vice versa).
 * @param amount - The amount to convert.
 * @param rate - The ratio information for conversion, which can be either:
 *   - An object containing `ckbScale` and `udtScale`.
 *   - A `ccc.ClientBlockHeader` for header information.
 * @param accountDepositCapacity - A boolean indicating whether to account for deposit capacity
 *  when using ccc.ClientBlockHeader (default: true).
 * @returns The converted amount in the target unit as a `ccc.FixedPoint`.
 */
export function convert(
  isCkb2Udt: boolean,
  amount: ccc.FixedPoint,
  rate: ExchangeRatio | ccc.ClientBlockHeader,
  accountDepositCapacity = true,
): ccc.FixedPoint {
  if ("dao" in rate) {
    rate = ickbExchangeRatio(rate, accountDepositCapacity);
  }
  return isCkb2Udt
    ? (amount * rate.ckbScale) / rate.udtScale
    : (amount * rate.udtScale) / rate.ckbScale;
}

/**
 * Calculates the iCKB exchange ratio based on the block header and deposit capacity.
 *
 * @param header - The block header used for calculating the exchange ratio.
 * @param accountDepositCapacity - A boolean indicating whether to account for the deposit capacity in the calculation.
 * @returns An object containing the CKB and UDT scales.
 */
export function ickbExchangeRatio(
  header: ccc.ClientBlockHeader,
  accountDepositCapacity = true,
): ExchangeRatio {
  const AR_m = header.dao.ar;
  return {
    ckbScale: AR_0,
    udtScale: accountDepositCapacity ? AR_m + depositCapacityDelta : AR_m,
  };
}

// Constants used in calculations
const AR_0: ccc.Num = 10000000000000000n; // Base scale for CKB
const depositUsedCapacity = ccc.fixedPointFrom(82); // 82n CKB
const depositCapacityDelta = (depositUsedCapacity * AR_0) / ICKB_DEPOSIT_CAP; // Delta for deposit capacity
