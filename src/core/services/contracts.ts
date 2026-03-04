import { getTronWeb, getWallet } from "./clients.js";
import { MULTICALL2_ABI, MULTICALL3_ABI } from "./multicall-abi.js";
import { waitForTransaction } from "./transactions.js";

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

/**
 * Write to a smart contract (state-changing functions).
 */
export async function writeContract(
  privateKey: string,
  params: {
    address: string;
    functionName: string;
    args?: any[];
    value?: string; // TRX call value in Sun
    abi?: any[];
  },
  network = "mainnet",
) {
  const tronWeb = getWallet(privateKey, network);

  try {
    const contract = params.abi
      ? tronWeb.contract(params.abi, params.address)
      : await tronWeb.contract().at(params.address);

    const method = contract.methods[params.functionName];
    if (!method) throw new Error(`Function ${params.functionName} not found in contract`);

    const args = params.args || [];
    const options: any = {};
    if (params.value) options.callValue = params.value;

    return await method(...args).send(options);
  } catch (error: any) {
    throw new Error(`Write contract failed: ${error.message}`);
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
  privateKey: string,
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
  const tronWeb = getWallet(privateKey, network);

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
    const signedTx = await tronWeb.trx.sign(transaction, privateKey);
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    if (result && result.result) {
      const txID = result.transaction.txID;
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

    throw new Error(`Broadcast failed: ${JSON.stringify(result)}`);
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

    const candidates = normalizedAbi.filter(
      (item) => item.type === "function" && item.name === params.functionName,
    );
    if (candidates.length === 0) throw new Error(`Function ${params.functionName} not found in ABI`);

    const matched = candidates.filter((item) => (item.inputs || []).length === args.length);
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
      {},
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

    const errorMsg =
      result?.result?.message
        ? Buffer.from(result.result.message, "hex").toString()
        : JSON.stringify(result);
    throw new Error(`Estimate energy failed: ${errorMsg}`);
  } catch (error: any) {
    throw new Error(`Estimate energy error: ${error.message}`);
  }
}
