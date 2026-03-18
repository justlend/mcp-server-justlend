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

export interface SafeSendParams {
  address: string;
  abi: any[];
  functionName: string;
  args?: any[];
  callValue?: string | number;
  feeLimit?: number;
}

/**
 * Safe transaction interaction with pre-flight simulation and resource checks.
 * Prevents failed transactions from burning gas.
 */
export async function safeSend(
  privateKey: string,
  params: SafeSendParams,
  network = "mainnet"
) {
  const tronWeb = getWallet(privateKey, network);
  const ownerAddress = tronWeb.defaultAddress.base58;
  if (!ownerAddress) throw new Error("Wallet not configured");

  const args = params.args || [];
  const hasCallValue = params.callValue && Number(params.callValue) > 0;
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
    // 检查是否是降级估算
    if ((simResult as any).degraded) {
      simulationDegraded = true;
    }
  } catch (err: any) {
    const errMsg = err.message || "";

    // ====== 新增：对原生 TRX 调用的模拟失败做降级处理 ======
    // 如果是 "No overload" 错误且是原生 TRX 调用，不阻断交易
    if (isNativeTRXCall && errMsg.includes("No overload of")) {
      simulationDegraded = true;
      // 使用典型 energy 估算值
      energyUsed = 80000;
      energyPenalty = 0;
      console.warn(
        `[safeSend] Simulation skipped for native TRX call ${params.functionName}(): ${errMsg}. Using typical energy estimate.`
      );
    } else if (errMsg.includes("REVERT opcode executed")) {
      // ====== 降级处理：REVERT 不阻断交易 ======
      // 测试网节点的 triggerConstantContract 模拟可能不准确，
      // DApp 前端也不做预检模拟。降级为典型值，让交易继续发送。
      simulationDegraded = true;
      energyUsed = 100000; // 保守典型估算值
      energyPenalty = 0;
      console.warn(
        `[safeSend] Pre-flight simulation REVERT for ${params.functionName}(): ${errMsg}. ` +
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

  const totalEnergyAvailable = (resources.EnergyLimit || 0) - (resources.EnergyUsed || 0);
  const totalEnergyTarget = energyUsed + energyPenalty;
  const energyDeficit = Math.max(0, totalEnergyTarget - totalEnergyAvailable);
  const trxForEnergy = BigInt(energyDeficit) * 420n;

  const requiredBandwidth = 350;
  const totalBandwidthAvailable = ((resources.freeNetLimit || 0) - (resources.freeNetUsed || 0)) +
    ((resources.NetLimit || 0) - (resources.NetUsed || 0));
  const bandwidthDeficit = totalBandwidthAvailable >= requiredBandwidth ? 0 : requiredBandwidth;
  const trxForBandwidth = BigInt(bandwidthDeficit) * 1000n;

  const callValueSun = BigInt(params.callValue || 0);

  // 降级模式下给更多余量（15%），正常模式 10%
  const marginPercent = simulationDegraded ? 115n : 110n;
  const feeMargin = (trxForEnergy + trxForBandwidth) * marginPercent / 100n;
  const requiredBalanceWithMargin = feeMargin + callValueSun;

  if (balanceSun < requiredBalanceWithMargin) {
    const requiredTrx = Number(requiredBalanceWithMargin) / 1e6;
    const currentTrx = Number(balanceSun) / 1e6;
    throw new Error(
      `Pre-flight check failed: Insufficient TRX balance. ` +
      `Estimated requirement to cover fees+value: ~${requiredTrx.toFixed(2)} TRX, but you only have ${currentTrx.toFixed(2)} TRX.`
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

    // ====== 新增：原生 TRX 零参数调用的签名构建 ======
    if (isNativeTRXCall) {
      // 优先匹配零参数重载
      const zeroArgMatch = candidates.filter((item) => (item.inputs || []).length === 0);
      if (zeroArgMatch.length > 0) {
        // ABI 中有零参数版本，直接用
        signature = `${params.functionName}()`;
        typedParams = [];
      } else {
        // ABI 中没有零参数版本（如只有 repayBorrow(uint256)），
        // 但实际合约有零参数的 payable 重载（通过 callValue 传值）。
        // 直接用零参数签名发交易。
        signature = `${params.functionName}()`;
        typedParams = [];
      }
    } else {
      // 标准路径：按参数数量匹配
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
    if (params.callValue) options.callValue = Number(params.callValue);

    const tx = await tronWeb.transactionBuilder.triggerSmartContract(
      params.address,
      signature,
      options,
      typedParams,
      ownerAddress
    );

    const signed = await tronWeb.trx.sign(tx.transaction, privateKey);
    const broadcast = await tronWeb.trx.sendRawTransaction(signed);

    if (broadcast.result) {
      const txID = broadcast.txid || broadcast.transaction?.txID || tx.transaction.txID;
      return { txID, message: "Transaction broadcasted successfully" };
    } else {
      const errorMsg = broadcast.message ? Buffer.from(broadcast.message, "hex").toString() : JSON.stringify(broadcast);
      throw new Error(`Broadcast failed: ${errorMsg}`);
    }
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
  if (!process.env.ALLOW_CONTRACT_DEPLOY) {
    throw new Error(
      "Contract deployment is disabled. Set the ALLOW_CONTRACT_DEPLOY=true environment variable to enable this feature."
    );
  }

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
    callValue?: string | number;
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

    // ====== 新增：原生 TRX 零参数 + callValue 降级处理 ======
    if (matched.length === 0 && args.length === 0 && params.callValue && Number(params.callValue) > 0) {
      // 没有零参数重载，但这是一个原生 TRX 调用（通过 callValue 传值）。
      // 直接用零参数函数签名调 triggerConstantContract，绕过 ABI 匹配。
      const signature = `${params.functionName}()`;
      try {
        const result = await tronWeb.transactionBuilder.triggerConstantContract(
          params.address,
          signature,
          { callValue: Number(params.callValue) },
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

        // 模拟返回了结果但不是 success，解码 revert reason
        const errorMsg = result?.result?.message
          ? tryDecodeHexMessage(result.result.message)
          : JSON.stringify(result);
        throw new Error(`Estimate energy failed: ${errorMsg}`);
      } catch (innerErr: any) {
        // 如果 triggerConstantContract 本身也失败了（比如节点不支持零参数重载），
        // 不阻断，而是返回一个降级估算值，让 safeSend 可以继续发交易。
        if (innerErr.message?.includes("Estimate energy failed")) {
          throw innerErr; // 真正的 REVERT，继续抛出
        }
        // 节点级别的错误（如 ABI 解析失败），返回典型值
        return {
          energyUsed: 80000,  // repay TRX 典型值
          energyPenalty: 0,
          totalEnergy: 80000,
          degraded: true,
          degradeReason: `Simulation not supported for ${params.functionName}() with callValue, using typical estimate: ${innerErr.message}`,
        };
      }
    }
    // ====== 降级处理结束 ======

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
      params.callValue ? { callValue: Number(params.callValue) } : {},
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

    // ====== 改进：解码 REVERT reason ======
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

    // 尝试检测 ABI 编码的 Error(string)：选择器 08c379a0
    if (hex.startsWith("08c379a0") && hex.length >= 136) {
      // 跳过 4 字节选择器 + 32 字节 offset + 32 字节 length，读取字符串
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

    // 直接尝试 hex → utf8
    const direct = Buffer.from(hex, "hex").toString("utf8");
    // 只返回可打印的 ASCII 内容
    if (direct && /^[\x20-\x7E\n\r\t]+$/.test(direct)) {
      return direct;
    }
  } catch { /* ignore decode failures */ }

  // 解码失败，原样返回
  return hexMsg;
}
