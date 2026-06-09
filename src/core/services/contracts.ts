import { getTronWeb } from "./clients.js";
import { getSigningClient, signTransactionWithWallet } from "./wallet.js";
import { MULTICALL2_ABI, MULTICALL3_ABI } from "./multicall-abi.js";
import { getResourcePrices } from "./resource-prices.js";
import { waitForTransaction } from "./transactions.js";
import { utils } from "./utils.js";

/**
 * Typed shape of `tronWeb.trx.sendRawTransaction` responses. TronWeb's types are
 * incomplete and historically the success indicator has lived under both `result`
 * and `transaction.txID`. Funnel every call site through this interface so a
 * future SDK rename surfaces as a compile error, not a silent broadcast failure.
 */
export interface BroadcastResponse {
  result?: boolean;
  txid?: string;
  message?: string;
  code?: string | number;
  transaction?: { txID?: string };
}

/**
 * Resolve a broadcast result to either a txID or a decoded error message.
 * Centralises the "did the node accept it?" check that used to be `(broadcast as any).result`.
 */
export function resolveBroadcastResult(broadcast: BroadcastResponse, fallbackTxID?: string): { txID: string } {
  if (broadcast.result) {
    const txID = broadcast.txid || broadcast.transaction?.txID || fallbackTxID;
    if (!txID) throw new Error("Broadcast succeeded but no txID was returned.");
    return { txID };
  }
  const decodedMessage = broadcast.message
    ? safeDecodeHexMessage(broadcast.message)
    : JSON.stringify(broadcast);
  throw new Error(`Broadcast failed: ${decodedMessage}`);
}

function safeDecodeHexMessage(msg: string): string {
  try {
    if (/^[0-9a-fA-F]+$/.test(msg) && msg.length % 2 === 0) {
      return Buffer.from(msg, "hex").toString();
    }
  } catch { /* fall through */ }
  return msg;
}

/**
 * Convert a callValue (string | number | bigint) to the Number that TronWeb's
 * trigger* APIs accept. Throws if the value exceeds Number.MAX_SAFE_INTEGER —
 * Sun precision would otherwise be silently lost because BigInt → Number rounds
 * to the nearest double, and the broadcasted callValue would not match input.
 */
export function toSafeCallValueNumber(
  value: string | number | bigint | undefined | null,
): number {
  if (value === undefined || value === null || value === "") return 0;
  let big: bigint;
  try {
    big = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new Error(`Invalid callValue ${String(value)} (not a valid integer).`);
  }
  if (big < 0n) {
    throw new Error(`callValue cannot be negative (got ${big.toString()}).`);
  }
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `callValue ${big.toString()} exceeds the SDK safe-integer limit ` +
      `(${Number.MAX_SAFE_INTEGER} Sun ≈ ${Number.MAX_SAFE_INTEGER / 1e6} TRX). ` +
      `Reduce the amount or split into multiple calls.`,
    );
  }
  return Number(big);
}

/**
 * Read from a smart contract (view/pure functions).
 */
export async function readContract(
  params: {
    address: string;
    functionName: string;
    args?: any[];
    abi?: any[];
  },
  network = "mainnet",
) {
  const tronWeb = getTronWeb(network);

  try {
    const contract = params.abi
      ? tronWeb.contract(params.abi, params.address)
      : await tronWeb.contract().at(params.address);

    const method = contract.methods[params.functionName];
    if (!method) throw new Error(`Function ${params.functionName} not found in contract`);

    const args = params.args || [];
    return await method(...args).call();
  } catch (error: any) {
    throw new Error(`Read contract failed: ${error.message}`);
  }
}

function buildTransactionDescription(params: SafeSendParams, signature: string, typedParams: Array<{ type: string; value: any }>, network: string, simulationDegraded: boolean): string {
  const args = typedParams.map((p) => `${p.type}=${String(p.value)}`).join(", ");
  const callValue = params.callValue === undefined || params.callValue === null || params.callValue === "" ? "0" : String(params.callValue);
  const feeLimit = params.feeLimit || 1_000_000_000;
  return [
    `network=${network}`,
    `contract=${params.address}`,
    `function=${signature}`,
    `args=[${args}]`,
    `callValue=${callValue}`,
    `feeLimit=${feeLimit}`,
    `simulation=${simulationDegraded ? "degraded" : "ok"}`,
  ].join("; ");
}

export interface SafeSendParams {
  address: string;
  abi: any[];
  functionName: string;
  args?: any[];
  callValue?: string | number | bigint;
  feeLimit?: number;
}

/**
 * Safe transaction interaction with pre-flight simulation and resource checks.
 * Prevents failed transactions from burning gas.
 * Signing is handled by agent-wallet — no private key needed.
 */
export async function safeSend(
  params: SafeSendParams,
  network = "mainnet"
) {
  const tronWeb = await getSigningClient(network);
  const ownerAddress = tronWeb.defaultAddress.base58;
  if (!ownerAddress) throw new Error("Wallet not configured");

  const args = params.args || [];
  // Validate callValue once up-front: throws on values that exceed the SDK's
  // safe-integer range, so we don't silently truncate large TRX amounts.
  const callValueNum = toSafeCallValueNumber(params.callValue);
  const hasCallValue = callValueNum > 0;
  const isNativeTRXCall = hasCallValue && args.length === 0;

  // 1. Simulate and get energy requirement
  let energyUsed = 0;
  let energyPenalty = 0;
  let simulationDegraded = false;

  try {
    const simResult = await estimateEnergy({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      callValue: params.callValue,
    }, network);
    energyUsed = simResult.energyUsed;
    energyPenalty = simResult.energyPenalty;
    // Track whether the estimate was a degraded fallback rather than a real simulation result.
    if ((simResult as any).degraded) {
      simulationDegraded = true;
    }
  } catch (err: any) {
    const errMsg = err.message || "";

    // Native-TRX-call degrade path: when the ABI has no zero-arg overload but
    // the contract accepts a payable call via callValue, the "No overload" error
    // from estimateEnergy is expected and must not block the broadcast.
    if (isNativeTRXCall && errMsg.includes("No overload of")) {
      simulationDegraded = true;
      // Typical energy estimate for native-TRX calls (e.g. repayBorrow with TRX).
      energyUsed = 80000;
      energyPenalty = 0;
      console.warn(
        `[safeSend] Simulation skipped for native TRX call ${params.functionName}(): ${errMsg}. Using typical energy estimate.`
      );
    } else if (errMsg.includes("REVERT opcode executed")) {
      // Only degrade on testnet: testnet nodes' triggerConstantContract has been
      // historically unreliable. On mainnet a REVERT is a real failure signal —
      // broadcasting would burn the user's TRX, so we fail-closed and throw.
      if (network === "mainnet") {
        throw new Error(
          `Transaction pre-flight simulation reverted on mainnet. ` +
          `Refusing to broadcast — the transaction is very likely to fail on-chain ` +
          `and would burn TRX (energy/bandwidth/fees). Original error: ${errMsg}`
        );
      }
      simulationDegraded = true;
      energyUsed = 100000; // Conservative typical estimate for testnet degrade.
      energyPenalty = 0;
      console.warn(
        `[safeSend] Pre-flight simulation REVERT for ${params.functionName}() on ${network}: ${errMsg}. ` +
        `Proceeding with typical energy estimate. The transaction may still succeed on-chain.`
      );
    } else {
      const enhancedMsg = `Transaction pre-flight simulation failed. The transaction would revert: ${errMsg}`;
      throw new Error(enhancedMsg);
    }
  }

  // 2. Minimal resource balance check
  const resources = await tronWeb.trx.getAccountResources(ownerAddress);
  const account = await tronWeb.trx.getAccount(ownerAddress);
  const balanceSun = BigInt(account.balance || 0);
  const resourcePrices = await getResourcePrices(network);

  const totalEnergyAvailable = (resources.EnergyLimit || 0) - (resources.EnergyUsed || 0);
  const totalEnergyTarget = energyUsed + energyPenalty;
  const energyDeficit = Math.max(0, totalEnergyTarget - totalEnergyAvailable);
  const trxForEnergy = BigInt(energyDeficit) * BigInt(resourcePrices.energyPriceSun);

  const requiredBandwidth = 350;
  const totalBandwidthAvailable = ((resources.freeNetLimit || 0) - (resources.freeNetUsed || 0)) +
    ((resources.NetLimit || 0) - (resources.NetUsed || 0));
  const bandwidthDeficit = totalBandwidthAvailable >= requiredBandwidth ? 0 : requiredBandwidth;
  const trxForBandwidth = BigInt(bandwidthDeficit) * BigInt(resourcePrices.bandwidthPriceSun);

  const callValueSun = BigInt(params.callValue || 0);

  // Use a wider safety margin (15%) when the estimate is degraded, vs. 10% on a real simulation.
  const marginPercent = simulationDegraded ? 115n : 110n;
  const feeMargin = (trxForEnergy + trxForBandwidth) * marginPercent / 100n;
  const requiredBalanceWithMargin = feeMargin + callValueSun;

  if (balanceSun < requiredBalanceWithMargin) {
    const requiredTrx = utils.fromSun(requiredBalanceWithMargin.toString());
    const currentTrx = utils.fromSun(balanceSun.toString());
    throw new Error(
      `Pre-flight check failed: Insufficient TRX balance. ` +
      `Estimated requirement to cover fees+value: ~${requiredTrx} TRX, but you only have ${currentTrx} TRX.`
    );
  }

  // 3. Pre-flight checks passed, build and send the transaction
  try {
    const normalizedAbi = parseABI(params.abi);
    const candidates = normalizedAbi.filter(
      (item) => item.type === "function" && item.name === params.functionName,
    );
    if (candidates.length === 0) throw new Error(`Function ${params.functionName} not found in ABI`);

    let signature: string;
    let typedParams: Array<{ type: string; value: any }>;

    // Signature construction for native-TRX zero-arg calls.
    if (isNativeTRXCall) {
      // Prefer a zero-arg overload if the ABI declares one.
      const zeroArgMatch = candidates.filter((item) => (item.inputs || []).length === 0);
      if (zeroArgMatch.length > 0) {
        // ABI has a zero-arg overload — use it directly.
        signature = `${params.functionName}()`;
        typedParams = [];
      } else {
        // ABI has no zero-arg overload (e.g. only repayBorrow(uint256)) but the
        // deployed contract still exposes a payable zero-arg variant (value passed
        // via callValue). Use the zero-arg signature anyway.
        signature = `${params.functionName}()`;
        typedParams = [];
      }
    } else {
      // Standard path: match by argument count.
      const matched = candidates.filter((item) => (item.inputs || []).length === args.length);
      if (matched.length === 0) throw new Error(`No overload of ${params.functionName} accepts ${args.length} argument(s)`);
      if (matched.length > 1) throw new Error(`Ambiguous overload for ${params.functionName} with ${args.length} argument(s)`);

      const func = matched[0];
      const inputTypes = (func.inputs || []).map((i: any) => expandType(i));
      signature = `${params.functionName}(${inputTypes.join(",")})`;
      typedParams = args.map((val: any, index: number) => ({
        type: inputTypes[index],
        value: val,
      }));
    }

    const options: any = {
      feeLimit: params.feeLimit || 1_000_000_000,
    };
    if (hasCallValue) options.callValue = callValueNum;

    const tx = await tronWeb.transactionBuilder.triggerSmartContract(
      params.address,
      signature,
      options,
      typedParams,
      ownerAddress
    );

    const description = buildTransactionDescription(params, signature, typedParams, network, simulationDegraded);
    const signed = await signTransactionWithWallet(tx.transaction, description, network);
    const broadcast = (await tronWeb.trx.sendRawTransaction(signed)) as BroadcastResponse;
    const { txID } = resolveBroadcastResult(broadcast, tx.transaction.txID);
    return { txID, message: "Transaction broadcasted successfully" };
  } catch (error: any) {
    throw new Error(`Transaction failed during broadcast: ${error.message}`);
  }
}
/**
 * Fetch the ABI for a verified contract from TronGrid.
 */
export async function fetchContractABI(contractAddress: string, network = "mainnet") {
  const tronWeb = getTronWeb(network);

  try {
    const contract = await tronWeb.trx.getContract(contractAddress);
    if (contract && contract.abi) return contract.abi.entrys;
    throw new Error("ABI not found in contract data");
  } catch (error: any) {
    throw new Error(`Failed to fetch ABI: ${error.message}`);
  }
}

/**
 * Parse and normalise an ABI (string or array) for TronWeb compatibility.
 */
export function parseABI(abiJson: string | any[]): any[] {
  if (typeof abiJson === "string" && abiJson.length > 500_000) {
    throw new Error("ABI JSON string exceeds maximum allowed size (500KB)");
  }
  const abi: any[] = typeof abiJson === "string" ? JSON.parse(abiJson) : abiJson;

  return abi.map((item) => {
    const normalized = { ...item };
    if (typeof normalized.type === "string") normalized.type = normalized.type.toLowerCase();
    if (typeof normalized.stateMutability === "string")
      normalized.stateMutability = normalized.stateMutability.toLowerCase();
    return normalized;
  });
}

/**
 * Expand a tuple ABI parameter type to its canonical string form.
 * e.g. { type: "tuple", components: [{type:"address"},{type:"uint256"}] } → "(address,uint256)"
 */
function expandType(param: any): string {
  if (!param.type.startsWith("tuple")) return param.type;
  const suffix = param.type.slice("tuple".length);
  const inner = (param.components || []).map(expandType).join(",");
  return `(${inner})${suffix}`;
}

/**
 * Return human-readable function signatures from an ABI array.
 */
export function getReadableFunctions(abi: any[]) {
  return abi
    .filter((item) => item.type === "function")
    .map((item) => {
      const inputs = (item.inputs || []).map((i: any) => `${i.type} ${i.name}`).join(", ");
      const outputs = (item.outputs || []).map((i: any) => `${i.type} ${i.name || ""}`).join(", ");
      return `${item.name}(${inputs}) -> (${outputs})`;
    });
}

/**
 * Find a specific function definition in an ABI array. Throws if not found.
 */
export function getFunctionFromABI(abi: any[], functionName: string) {
  const func = abi.find((item) => item.type === "function" && item.name === functionName);
  if (!func) throw new Error(`Function ${functionName} not found in ABI`);
  return func;
}

/**
 * Execute multiple contract reads in a single Multicall (v2 or v3).
 * Falls back to sequential Promise.allSettled when no multicall address is given.
 */
export async function multicall(
  params: {
    calls: Array<{
      address: string;
      functionName: string;
      args?: any[];
      abi: any[];
      allowFailure?: boolean;
    }>;
    multicallAddress?: string;
    version?: 2 | 3;
    allowFailure?: boolean;
  },
  network = "mainnet",
) {
  const { calls, version = 3, allowFailure: globalAllowFailure = true } = params;

  const fallbackToSimulation = async (error?: string) => {
    if (error) console.error(`Multicall failed, falling back to simulation: ${error}`);
    const results = await Promise.allSettled(calls.map((call) => readContract(call, network)));
    return results.map((result, idx) =>
      result.status === "fulfilled"
        ? { success: true, result: result.value }
        : { success: false, error: `Call to ${calls[idx].functionName} failed: ${result.reason}` },
    );
  };

  if (!params.multicallAddress) return fallbackToSimulation();

  const tronWeb = getTronWeb(network);

  try {
    const callDataWithFuncs = calls.map((call) => {
      const func = call.abi.find(
        (i: any) => i.name === call.functionName && i.type === "function",
      );
      if (!func) throw new Error(`Function ${call.functionName} not found in ABI for ${call.address}`);

      const inputs = func.inputs || [];
      const types = inputs.map((i: any) => i.type);
      const signature = `${call.functionName}(${types.join(",")})`;

      const fullHash = tronWeb.sha3(signature);
      const selector = fullHash.startsWith("0x")
        ? fullHash.slice(0, 10)
        : "0x" + fullHash.slice(0, 8);

      const values = call.args || [];
      const encodedArgs = (tronWeb as any).utils.abi
        .encodeParams(types, values)
        .replace(/^0x/, "");
      const callData = selector + encodedArgs;
      const callAllowFailure =
        call.allowFailure !== undefined ? call.allowFailure : globalAllowFailure;

      return {
        callData:
          version === 3
            ? [call.address, callAllowFailure, callData]
            : [call.address, callData],
        func,
      };
    });

    const encodedCalls = callDataWithFuncs.map((item) => item.callData);
    const multicallAbi = version === 3 ? MULTICALL3_ABI : MULTICALL2_ABI;
    const method = version === 3 ? "aggregate3" : "tryAggregate";
    const multicallArgs =
      version === 3 ? [encodedCalls] : [!globalAllowFailure, encodedCalls];

    const contract = tronWeb.contract(multicallAbi, params.multicallAddress);
    const results = await (contract as any)[method](...multicallArgs).call();

    const finalResults =
      Array.isArray(results) &&
        results.length === 1 &&
        Array.isArray(results[0]) &&
        (Array.isArray(results[0][0]) || typeof results[0][0] === "object")
        ? results[0]
        : results;

    return finalResults.map((res: any, index: number) => {
      const success = res.success !== undefined ? res.success : res[0];
      const returnData = res.returnData !== undefined ? res.returnData : res[1];

      if (!success) {
        return {
          success: false,
          error: `Call to ${calls[index].functionName} failed in multicall`,
        };
      }

      const func = callDataWithFuncs[index].func;
      const outputs = func.outputs || [];
      const outputTypes = outputs.map((o: any) => o.type);
      const outputNames = outputs.map((o: any) => o.name || "");

      try {
        const decoded = (tronWeb as any).utils.abi.decodeParams(
          outputNames,
          outputTypes,
          returnData,
          true,
        );

        let result: any;
        if (outputTypes.length === 1) {
          if (typeof decoded === "object" && !Array.isArray(decoded)) {
            const entries = Object.entries(decoded);
            const namedEntry = entries.find(([k]) => isNaN(Number(k)) && k !== "");
            result = namedEntry ? decoded : entries[0] ? entries[0][1] : decoded;
          } else {
            result = Array.isArray(decoded) && decoded.length === 1 ? decoded[0] : decoded;
          }
        } else {
          result = decoded;
        }
        return { success: true, result };
      } catch (e: any) {
        return {
          success: false,
          error: `Failed to decode ${calls[index].functionName}: ${e.message}`,
        };
      }
    });
  } catch (error: any) {
    return fallbackToSimulation(error.message);
  }
}

/**
 * Deploy a smart contract to TRON.
 */
export async function deployContract(
  params: {
    abi: any[];
    bytecode: string;
    args?: any[];
    name?: string;
    feeLimit?: number;
    originEnergyLimit?: number;
    userPercentage?: number;
  },
  network = "mainnet",
) {
  if (!process.env.ALLOW_CONTRACT_DEPLOY) {
    throw new Error(
      "Contract deployment is disabled. Set the ALLOW_CONTRACT_DEPLOY=true environment variable to enable this feature."
    );
  }

  const tronWeb = await getSigningClient(network);

  try {
    const deploymentOptions = {
      abi: params.abi,
      bytecode: params.bytecode.startsWith("0x") ? params.bytecode : "0x" + params.bytecode,
      feeLimit: params.feeLimit || 1_000_000_000,
      name: params.name || "Contract",
      parameters: params.args || [],
      originEnergyLimit: params.originEnergyLimit || 10_000_000,
      userPercentage: params.userPercentage || 0,
    };

    const transaction = await tronWeb.transactionBuilder.createSmartContract(
      deploymentOptions,
      tronWeb.defaultAddress.hex as string,
    );
    const signedTx = await signTransactionWithWallet(transaction, undefined, network);
    const broadcast = (await tronWeb.trx.sendRawTransaction(signedTx)) as BroadcastResponse;

    if (broadcast && broadcast.result) {
      const txID = broadcast.transaction?.txID ?? transaction.txID;
      const info = await waitForTransaction(txID, network);

      if (info.receipt?.result && info.receipt.result !== "SUCCESS") {
        const revertReason = info.resMessage
          ? Buffer.from(info.resMessage, "hex").toString()
          : "Unknown revert reason";
        throw new Error(
          `Contract deployment failed with status ${info.receipt.result}: ${revertReason}`,
        );
      }

      const contractAddressHex = info?.contract_address as string | undefined;
      let contractAddress: string | undefined;
      if (contractAddressHex) {
        const hex = contractAddressHex.replace(/^0x/, "");
        const withPrefix = hex.length === 40 && !hex.startsWith("41") ? "41" + hex : hex;
        const decoded = tronWeb.address.fromHex(withPrefix);
        contractAddress = typeof decoded === "string" ? decoded : undefined;
      }

      if (!contractAddress) throw new Error("Contract deployed but failed to resolve address");

      return { txID, contractAddress, message: "Contract deployment successful" };
    }

    throw new Error(`Broadcast failed: ${JSON.stringify(broadcast)}`);
  } catch (error: any) {
    throw new Error(`Deploy contract failed: ${error.message}`);
  }
}

/**
 * Estimate the energy required for a contract call using triggerConstantContract.
 */
export async function estimateEnergy(
  params: {
    address: string;
    functionName: string;
    args?: any[];
    abi: any[];
    callValue?: string | number | bigint;
    ownerAddress?: string;
  },
  network = "mainnet",
) {
  const tronWeb = getTronWeb(network);

  try {
    const ownerAddress = params.ownerAddress || tronWeb.defaultAddress.base58;
    if (!ownerAddress) {
      throw new Error(
        "Missing ownerAddress for energy estimation. Provide an address or configure a wallet.",
      );
    }

    const normalizedAbi = parseABI(params.abi);
    const args = params.args || [];
    // Validate callValue once: rejects values above Number.MAX_SAFE_INTEGER so
    // simulation matches the broadcast that safeSend will eventually do.
    const callValueNum = toSafeCallValueNumber(params.callValue);

    const candidates = normalizedAbi.filter(
      (item) => item.type === "function" && item.name === params.functionName,
    );
    if (candidates.length === 0) throw new Error(`Function ${params.functionName} not found in ABI`);

    const matched = candidates.filter((item) => (item.inputs || []).length === args.length);

    // Native-TRX zero-arg + callValue degrade path.
    if (matched.length === 0 && args.length === 0 && callValueNum > 0) {
      // No zero-arg overload in the ABI, but this is a native-TRX call (value passed
      // via callValue). Bypass ABI matching and call triggerConstantContract with
      // the zero-arg signature directly.
      const signature = `${params.functionName}()`;
      try {
        const result = await tronWeb.transactionBuilder.triggerConstantContract(
          params.address,
          signature,
          { callValue: callValueNum },
          [],
          ownerAddress,
        );

        if (result?.result?.result) {
          return {
            energyUsed: result.energy_used || 0,
            energyPenalty: result.energy_penalty || 0,
            totalEnergy: (result.energy_used || 0) + (result.energy_penalty || 0),
          };
        }

        // Simulation returned a result but not a success — decode the revert reason.
        const errorMsg = result?.result?.message
          ? tryDecodeHexMessage(result.result.message)
          : JSON.stringify(result);
        throw new Error(`Estimate energy failed: ${errorMsg}`);
      } catch (innerErr: any) {
        // triggerConstantContract itself failed (e.g. the node doesn't support
        // a zero-arg overload). Don't block the call — return a degraded estimate
        // so safeSend can still proceed.
        if (innerErr.message?.includes("Estimate energy failed")) {
          throw innerErr; // Real REVERT — propagate.
        }
        // Node-level error (e.g. ABI parse failure) — return a typical estimate.
        return {
          energyUsed: 80000,  // Typical estimate for repay-with-TRX.
          energyPenalty: 0,
          totalEnergy: 80000,
          degraded: true,
          degradeReason: `Simulation not supported for ${params.functionName}() with callValue, using typical estimate: ${innerErr.message}`,
        };
      }
    }
    // End of native-TRX degrade path.

    if (matched.length === 0) {
      const overloads = candidates
        .map(
          (item) =>
            `${params.functionName}(${(item.inputs || []).map((i: any) => i.type).join(", ")})`,
        )
        .join(" | ");
      throw new Error(
        `No overload of ${params.functionName} accepts ${args.length} argument(s). Available: ${overloads}`,
      );
    }
    if (matched.length > 1) {
      const overloads = matched
        .map(
          (item) =>
            `${params.functionName}(${(item.inputs || []).map((i: any) => i.type).join(", ")})`,
        )
        .join(" | ");
      throw new Error(
        `Ambiguous overload for ${params.functionName} with ${args.length} argument(s). Candidates: ${overloads}`,
      );
    }

    const func = matched[0];
    const inputTypes = (func.inputs || []).map((i: any) => expandType(i));
    const signature = `${params.functionName}(${inputTypes.join(",")})`;
    const typedParams = args.map((val: any, index: number) => ({
      type: inputTypes[index],
      value: val,
    }));

    const result = await tronWeb.transactionBuilder.triggerConstantContract(
      params.address,
      signature,
      callValueNum > 0 ? { callValue: callValueNum } : {},
      typedParams,
      ownerAddress,
    );

    if (result?.result?.result) {
      return {
        energyUsed: result.energy_used || 0,
        energyPenalty: result.energy_penalty || 0,
        totalEnergy: (result.energy_used || 0) + (result.energy_penalty || 0),
      };
    }

    // Decode the REVERT reason from the simulation result.
    const errorMsg = result?.result?.message
      ? tryDecodeHexMessage(result.result.message)
      : JSON.stringify(result);
    throw new Error(`Estimate energy failed: ${errorMsg}`);
  } catch (error: any) {
    throw new Error(`Estimate energy error: ${error.message}`);
  }
}

/**
 * Try to decode a hex-encoded error message from contract revert.
 * Handles both raw hex strings and ABI-encoded Error(string) selectors.
 */
function tryDecodeHexMessage(hexMsg: string): string {
  try {
    const hex = hexMsg.startsWith("0x") ? hexMsg.slice(2) : hexMsg;

    // Detect ABI-encoded Error(string): selector 08c379a0.
    if (hex.startsWith("08c379a0") && hex.length >= 136) {
      // Skip 4-byte selector + 32-byte offset + 32-byte length, then read the string.
      const lengthHex = hex.slice(72, 136);
      const strLength = parseInt(lengthHex, 16);
      if (strLength > 0 && strLength < 1000) {
        const strHex = hex.slice(136, 136 + strLength * 2);
        const decoded = Buffer.from(strHex, "hex").toString("utf8");
        if (decoded && /^[\x20-\x7E]+$/.test(decoded)) {
          return decoded;
        }
      }
    }

    // Fall back to a direct hex → utf8 conversion.
    const direct = Buffer.from(hex, "hex").toString("utf8");
    // Only return printable ASCII content.
    if (direct && /^[\x20-\x7E\n\r\t]+$/.test(direct)) {
      return direct;
    }
  } catch { /* ignore decode failures */ }

  // Decoding failed — return the original hex unchanged.
  return hexMsg;
}
