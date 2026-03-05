/**
 * JustLend V1 Lending Operations
 *
 * VERSION: JustLend V1
 * All lending methods (supply, withdraw, borrow, repay, collateral management) are for JustLend V1.
 * Based on Compound V2 protocol architecture with jToken (cToken) mechanism.
 *
 * Core operations:
 * - Supply/Mint: Deposit assets to receive jTokens
 * - Withdraw/Redeem: Burn jTokens to receive underlying assets
 * - Borrow: Take loans against supplied collateral
 * - Repay: Return borrowed assets
 * - Enter/Exit Market: Enable/disable assets as collateral
 */

import { getTronWeb, getWallet } from "./clients.js";
import { getJustLendAddresses, getJTokenInfo, getAllJTokens, type JTokenInfo } from "../chains.js";
import { JTOKEN_ABI, JTRX_MINT_ABI, COMPTROLLER_ABI, TRC20_ABI } from "../abis.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/**
 * Wait for a transaction to be confirmed. Returns transaction info.
 */
async function waitForTx(txID: string, network: string, maxRetries = 20, intervalMs = 3000): Promise<any> {
  const { getTronWeb } = await import("./clients.js");
  const tronWeb = getTronWeb(network);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const info = await tronWeb.trx.getTransactionInfo(txID);
      if (info && info.id) return info;
    } catch { /* not found yet */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction ${txID} not confirmed after ${maxRetries * intervalMs / 1000}s`);
}

function resolveJToken(symbolOrAddress: string, network: string): JTokenInfo {
  const info = getJTokenInfo(symbolOrAddress, network);
  if (!info) throw new Error(`Unknown jToken market: ${symbolOrAddress}. Use get_supported_markets to list available markets.`);
  return info;
}

// ============================================================================
// SUPPLY (Mint jTokens)
// ============================================================================

/**
 * Supply (deposit) assets into a JustLend V1 market.
 *
 * VERSION: V1 - Uses JustLend V1 mint() function (Compound V2-style)
 *
 * For TRC20 tokens: requires prior approve() of underlying to jToken contract.
 * For TRX: sends TRX as callValue.
 *
 * @param privateKey - Wallet private key
 * @param jTokenSymbol - e.g. "jUSDT", "jTRX"
 * @param amount - Amount in underlying token units (human-readable, e.g. "100.5")
 * @param network - Network name
 * @returns Transaction ID
 */
export async function supply(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals));

  if (info.underlyingSymbol === "TRX" || !info.underlying) {
    // jTRX: mint() is payable, amount via callValue (in Sun)
    const contract = tronWeb.contract(JTRX_MINT_ABI, info.address);
    const txID = await contract.methods.mint().send({ callValue: amountRaw.toString() });
    return { txID, jTokenSymbol, amount, message: `Supplied ${amount} TRX to ${jTokenSymbol}` };
  } else {
    // TRC20: first check/do approval, then mint(amount)
    const contract = tronWeb.contract(JTOKEN_ABI, info.address);
    const txID = await contract.methods.mint(amountRaw.toString()).send();
    return { txID, jTokenSymbol, amount, message: `Supplied ${amount} ${info.underlyingSymbol} to ${jTokenSymbol}` };
  }
}

// ============================================================================
// WITHDRAW (Redeem jTokens)
// ============================================================================

/**
 * Withdraw assets from a JustLend V1 market.
 *
 * VERSION: V1 - Uses JustLend V1 redeemUnderlying() function (Compound V2-style)
 *
 * @param privateKey - Wallet private key
 * @param jTokenSymbol - e.g. "jUSDT"
 * @param amount - Amount in underlying units to withdraw (human-readable)
 * @param network - Network name
 */
export async function withdraw(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals));

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const txID = await contract.methods.redeemUnderlying(amountRaw.toString()).send();
  return { txID, jTokenSymbol, amount, message: `Withdrew ${amount} ${info.underlyingSymbol} from ${jTokenSymbol}` };
}

/**
 * Withdraw ALL supply from a V1 market by redeeming all jTokens.
 *
 * VERSION: V1 - Uses JustLend V1 redeem() function
 */
export async function withdrawAll(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const walletAddress = tronWeb.defaultAddress.base58;
  const jTokenBalance = await contract.methods.balanceOf(walletAddress).call();

  if (BigInt(jTokenBalance) === 0n) {
    throw new Error(`No ${jTokenSymbol} balance to withdraw`);
  }

  const txID = await contract.methods.redeem(jTokenBalance.toString()).send();
  return { txID, jTokenSymbol, message: `Withdrew all supply from ${jTokenSymbol}` };
}

// ============================================================================
// BORROW
// ============================================================================

/**
 * Borrow assets from a JustLend V1 market.
 *
 * VERSION: V1 - Uses JustLend V1 borrow() function (Compound V2-style)
 * Requires the user to have collateral enabled (enterMarkets) and sufficient liquidity.
 */
export async function borrow(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals));

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const txID = await contract.methods.borrow(amountRaw.toString()).send();
  return { txID, jTokenSymbol, amount, message: `Borrowed ${amount} ${info.underlyingSymbol} from ${jTokenSymbol}` };
}

// ============================================================================
// REPAY
// ============================================================================

/**
 * Repay borrowed assets to a JustLend V1 market.
 *
 * VERSION: V1 - Uses JustLend V1 repayBorrow() function (Compound V2-style)
 *
 * For TRC20: requires approval of underlying to jToken.
 * For TRX: sends callValue.
 * Use amount = "-1" or "max" to repay full borrow balance.
 */
export async function repay(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);

  const isMax = amount === "-1" || amount.toLowerCase() === "max";

  if (info.underlyingSymbol === "TRX" || !info.underlying) {
    // For TRX repay, we need the exact borrow balance
    const contract = tronWeb.contract(JTOKEN_ABI, info.address);
    const walletAddress = tronWeb.defaultAddress.base58;
    const borrowBal = BigInt(await contract.methods.borrowBalanceStored(walletAddress).call());

    // Add a small buffer (0.1%) for accrued interest
    const repayAmount = isMax
      ? borrowBal + borrowBal / 1000n
      : BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals));

    const txID = await contract.methods.repayBorrow().send({ callValue: repayAmount.toString() });
    return { txID, jTokenSymbol, amount: isMax ? "max" : amount, message: `Repaid ${isMax ? "all" : amount} TRX to ${jTokenSymbol}` };
  } else {
    const repayAmount = isMax ? MAX_UINT256 : BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals)).toString();
    const contract = tronWeb.contract(JTOKEN_ABI, info.address);
    const txID = await contract.methods.repayBorrow(repayAmount).send();
    return { txID, jTokenSymbol, amount: isMax ? "max" : amount, message: `Repaid ${isMax ? "all" : amount} ${info.underlyingSymbol} to ${jTokenSymbol}` };
  }
}

// ============================================================================
// COLLATERAL MANAGEMENT (Enter/Exit Markets)
// ============================================================================

/**
 * Enable a jToken market as collateral in V1 Comptroller.
 *
 * VERSION: V1 - Uses JustLend V1 enterMarkets() function
 */
export async function enterMarket(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);

  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const txID = await comptroller.methods.enterMarkets([info.address]).send();
  return { txID, message: `Enabled ${jTokenSymbol} as collateral` };
}

/**
 * Disable a jToken market as collateral in V1 Comptroller.
 *
 * VERSION: V1 - Uses JustLend V1 exitMarket() function
 * Will fail if it would make the account undercollateralized.
 */
export async function exitMarket(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);

  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const txID = await comptroller.methods.exitMarket(info.address).send();
  return { txID, message: `Disabled ${jTokenSymbol} as collateral` };
}

// ============================================================================
// APPROVE (TRC20 underlying for jToken)
// ============================================================================

/**
 * Approve a V1 jToken contract to spend underlying TRC20 tokens.
 *
 * VERSION: V1 - Approves underlying token for JustLend V1 jToken contracts
 * Required before supply() or repay() for TRC20-backed markets.
 *
 * @param amount - Amount to approve (human-readable), or "max" for unlimited
 */
export async function approveUnderlying(
  privateKey: string,
  jTokenSymbol: string,
  amount: string = "max",
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  if (!info.underlying) throw new Error(`${jTokenSymbol} is native TRX — no approval needed`);

  const tronWeb = getWallet(privateKey, network);
  const token = tronWeb.contract(TRC20_ABI, info.underlying);

  const approveAmount = amount.toLowerCase() === "max"
    ? MAX_UINT256
    : BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals)).toString();

  const txID = await token.methods.approve(info.address, approveAmount).send();
  return { txID, message: `Approved ${amount === "max" ? "unlimited" : amount} ${info.underlyingSymbol} for ${jTokenSymbol}` };
}

// ============================================================================
// CLAIM REWARDS
// ============================================================================

/**
 * Claim accrued JustLend rewards for the connected wallet.
 */
export async function claimRewards(
  privateKey: string,
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58;

  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const txID = await comptroller.methods.claimReward(walletAddress).send();
  return { txID, message: `Claimed JustLend rewards for ${walletAddress}` };
}

// ============================================================================
// RESOURCE ESTIMATION (Energy + Bandwidth + TRX Cost)
// ============================================================================

/**
 * Typical resource costs for JustLend operations (based on historical on-chain data).
 * Energy: computational cost. Bandwidth: transaction size cost.
 * Used as fallback when triggerConstantContract simulation reverts.
 */
const TYPICAL_RESOURCES: Record<string, { energy: number; bandwidth: number }> = {
  approve:        { energy: 23000,  bandwidth: 265 },
  supply_trx:     { energy: 80000,  bandwidth: 280 },
  supply_trc20:   { energy: 100000, bandwidth: 310 },
  withdraw:       { energy: 90000,  bandwidth: 300 },
  withdraw_all:   { energy: 90000,  bandwidth: 300 },
  borrow:         { energy: 100000, bandwidth: 310 },
  repay_trx:      { energy: 80000,  bandwidth: 280 },
  repay_trc20:    { energy: 90000,  bandwidth: 320 },
  enter_market:   { energy: 80000,  bandwidth: 300 },
  exit_market:    { energy: 50000,  bandwidth: 280 },
  claim_rewards:  { energy: 60000,  bandwidth: 330 },
};

/** Current TRON mainnet resource prices (SUN per unit). May change via governance votes. */
const RESOURCE_PRICES = {
  energyPriceSun: 100,     // 420 SUN per energy unit
  bandwidthPriceSun: 1000, // 1000 SUN per bandwidth point
  freeBandwidthPerDay: 1500, // free bandwidth for activated accounts
  sunPerTRX: 1_000_000,
};

interface StepEstimate {
  step: string;
  description: string;
  energyEstimate: number;
  bandwidthEstimate: number;
  energySource: "simulation" | "typical";
  simulationError?: string;
}

export interface ResourceEstimation {
  operation: string;
  market: string;
  steps: StepEstimate[];
  totalEnergy: number;
  totalBandwidth: number;
  /** Estimated TRX cost if all energy is paid by burning TRX (no staked energy). */
  estimatedTRXCost: string;
  /** Breakdown of TRX cost */
  costBreakdown: {
    energyCostTRX: string;
    bandwidthCostTRX: string;
    note: string;
  };
  note: string;
}

/**
 * Helper: try on-chain simulation via triggerConstantContract, return energy or null.
 */
async function trySimulateEnergy(
  tronWeb: any,
  ownerAddress: string,
  contractAddress: string,
  functionSelector: string,
  params: Array<{ type: string; value: any }>,
  options: any = {},
): Promise<{ energy: number | null; error?: string }> {
  try {
    const result = await tronWeb.transactionBuilder.triggerConstantContract(
      contractAddress,
      functionSelector,
      options,
      params,
      ownerAddress,
    );
    if (result?.result?.result) {
      return { energy: (result.energy_used || 0) + (result.energy_penalty || 0) };
    }
    const errorMsg = result?.result?.message
      ? Buffer.from(result.result.message, "hex").toString()
      : "simulation reverted";
    return { energy: null, error: errorMsg };
  } catch (e: any) {
    return { energy: null, error: e.message };
  }
}

/**
 * Build a step estimate from simulation result with fallback to typical values.
 *
 * triggerConstantContract is a static simulation that does NOT fully account for
 * storage write costs (SSTORE) or energy penalties on high-traffic contracts.
 * For write operations like approve/mint/borrow, it often returns significantly
 * lower energy than the actual on-chain cost (e.g. 7,350 vs 22,350 for approve).
 *
 * To avoid underestimating, we take the MAXIMUM of simulation and typical values.
 */
function buildStep(
  step: string,
  description: string,
  simResult: { energy: number | null; error?: string },
  typicalKey: string,
): StepEstimate {
  const typical = TYPICAL_RESOURCES[typicalKey];
  // Use max(simulation, typical) because simulation underestimates write operations
  const simEnergy = simResult.energy;
  const energyEstimate = simEnergy !== null
    ? Math.max(simEnergy, typical.energy)
    : typical.energy;
  const energySource: StepEstimate["energySource"] = simEnergy !== null ? "simulation" : "typical";
  return {
    step,
    description,
    energyEstimate,
    bandwidthEstimate: typical.bandwidth,
    energySource,
    ...(simResult.error ? { simulationError: simResult.error } : {}),
  };
}

/**
 * Calculate TRX cost from energy and bandwidth totals.
 */
function calculateTRXCost(totalEnergy: number, totalBandwidth: number): ResourceEstimation["costBreakdown"] & { total: string } {
  const energyCost = totalEnergy * RESOURCE_PRICES.energyPriceSun;
  const bandwidthCost = totalBandwidth * RESOURCE_PRICES.bandwidthPriceSun;
  const totalCost = energyCost + bandwidthCost;

  return {
    energyCostTRX: (energyCost / RESOURCE_PRICES.sunPerTRX).toFixed(3),
    bandwidthCostTRX: (bandwidthCost / RESOURCE_PRICES.sunPerTRX).toFixed(3),
    total: (totalCost / RESOURCE_PRICES.sunPerTRX).toFixed(3),
    note: `Energy price: ${RESOURCE_PRICES.energyPriceSun} SUN/unit, Bandwidth price: ${RESOURCE_PRICES.bandwidthPriceSun} SUN/point. If you have staked TRX for energy/bandwidth, actual TRX cost will be lower. Each account gets ${RESOURCE_PRICES.freeBandwidthPerDay} free bandwidth points per day.`,
  };
}

export type LendingOperation =
  | "supply" | "withdraw" | "withdraw_all" | "borrow" | "repay"
  | "enter_market" | "exit_market" | "approve" | "claim_rewards";

export interface ResourceWarning {
  hasEnoughEnergy: boolean;
  hasEnoughBandwidth: boolean;
  accountEnergy: number;
  accountBandwidth: number;
  requiredEnergy: number;
  requiredBandwidth: number;
  energyDeficit: number;
  bandwidthDeficit: number;
  /** Estimated TRX that will be burned to cover the energy deficit */
  energyBurnTRX: string;
  /** Estimated TRX that will be burned to cover the bandwidth deficit */
  bandwidthBurnTRX: string;
  /** Total TRX that will be burned (energy + bandwidth deficit) */
  totalBurnTRX: string;
  warning: string;
}

/**
 * Check if user has enough staked energy/bandwidth for an operation.
 * Returns a warning object if resources are insufficient.
 */
export async function checkResourceSufficiency(
  ownerAddress: string,
  requiredEnergy: number,
  requiredBandwidth: number,
  network = "mainnet",
): Promise<ResourceWarning> {
  const tronWeb = getTronWeb(network);
  const resources = await tronWeb.trx.getAccountResources(ownerAddress);

  const totalEnergy = (resources.EnergyLimit || 0) - (resources.EnergyUsed || 0);
  const totalBandwidth =
    ((resources.freeNetLimit || 0) - (resources.freeNetUsed || 0)) +
    ((resources.NetLimit || 0) - (resources.NetUsed || 0));

  const energyDeficit = Math.max(0, requiredEnergy - totalEnergy);
  const bandwidthDeficit = Math.max(0, requiredBandwidth - totalBandwidth);

  const energyBurnTRX = energyDeficit * RESOURCE_PRICES.energyPriceSun / RESOURCE_PRICES.sunPerTRX;
  const bandwidthBurnTRX = bandwidthDeficit * RESOURCE_PRICES.bandwidthPriceSun / RESOURCE_PRICES.sunPerTRX;

  const warnings: string[] = [];
  if (energyDeficit > 0) {
    warnings.push(
      `Energy insufficient: you have ${totalEnergy} but need ~${requiredEnergy}. ` +
      `Deficit of ${energyDeficit} energy will burn ~${energyBurnTRX.toFixed(3)} TRX.`
    );
  }
  if (bandwidthDeficit > 0) {
    warnings.push(
      `Bandwidth insufficient: you have ${totalBandwidth} but need ~${requiredBandwidth}. ` +
      `Deficit of ${bandwidthDeficit} bandwidth will burn ~${bandwidthBurnTRX.toFixed(3)} TRX.`
    );
  }

  return {
    hasEnoughEnergy: energyDeficit === 0,
    hasEnoughBandwidth: bandwidthDeficit === 0,
    accountEnergy: totalEnergy,
    accountBandwidth: totalBandwidth,
    requiredEnergy,
    requiredBandwidth,
    energyDeficit,
    bandwidthDeficit,
    energyBurnTRX: energyBurnTRX.toFixed(3),
    bandwidthBurnTRX: bandwidthBurnTRX.toFixed(3),
    totalBurnTRX: (energyBurnTRX + bandwidthBurnTRX).toFixed(3),
    warning: warnings.length > 0
      ? `⚠️ RESOURCE WARNING: ${warnings.join(" ")} Consider staking TRX for energy to reduce costs.`
      : "",
  };
}

/**
 * Get typical resource requirements for a lending operation.
 */
export function getTypicalResources(operation: string, isTRX: boolean): { energy: number; bandwidth: number } {
  let key = operation;
  if (operation === "supply") key = isTRX ? "supply_trx" : "supply_trc20";
  if (operation === "repay") key = isTRX ? "repay_trx" : "repay_trc20";
  return TYPICAL_RESOURCES[key] || { energy: 100000, bandwidth: 300 };
}

/**
 * Estimate energy, bandwidth, and TRX cost for any JustLend operation.
 * Tries on-chain simulation first, falls back to historical typical values.
 */
export async function estimateLendingEnergy(
  operation: LendingOperation,
  jTokenSymbol: string,
  amount: string,
  ownerAddress: string,
  network = "mainnet",
): Promise<ResourceEstimation> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);
  const steps: StepEstimate[] = [];

  const sim = (addr: string, fn: string, params: Array<{ type: string; value: any }>, opts: any = {}) =>
    trySimulateEnergy(tronWeb, ownerAddress, addr, fn, params, opts);

  let info: JTokenInfo | undefined;
  if (operation !== "claim_rewards") {
    info = resolveJToken(jTokenSymbol, network);
  }

  const isTRX = info ? (info.underlyingSymbol === "TRX" || !info.underlying) : false;

  switch (operation) {

    case "approve": {
      if (isTRX || !info!.underlying) throw new Error(`${jTokenSymbol} is native TRX — no approval needed`);
      const r = await sim(info!.underlying, "approve(address,uint256)", [
        { type: "address", value: info!.address }, { type: "uint256", value: MAX_UINT256 },
      ]);
      steps.push(buildStep("approve", `Approve ${info!.underlyingSymbol} for ${jTokenSymbol}`, r, "approve"));
      break;
    }

    case "supply": {
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info!.underlyingDecimals)).toString();
      if (!isTRX && info!.underlying) {
        const ar = await sim(info!.underlying, "approve(address,uint256)", [
          { type: "address", value: info!.address }, { type: "uint256", value: MAX_UINT256 },
        ]);
        steps.push(buildStep("approve", `Approve ${info!.underlyingSymbol} for ${jTokenSymbol}`, ar, "approve"));
      }
      if (isTRX) {
        const mr = await sim(info!.address, "mint()", [], { callValue: amountRaw });
        steps.push(buildStep("mint", `Supply ${amount} TRX to ${jTokenSymbol}`, mr, "supply_trx"));
      } else {
        const mr = await sim(info!.address, "mint(uint256)", [{ type: "uint256", value: amountRaw }]);
        steps.push(buildStep("mint", `Supply ${amount} ${info!.underlyingSymbol} to ${jTokenSymbol}`, mr, "supply_trc20"));
      }
      break;
    }

    case "withdraw": {
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info!.underlyingDecimals)).toString();
      const r = await sim(info!.address, "redeemUnderlying(uint256)", [{ type: "uint256", value: amountRaw }]);
      steps.push(buildStep("redeemUnderlying", `Withdraw ${amount} ${info!.underlyingSymbol} from ${jTokenSymbol}`, r, "withdraw"));
      break;
    }

    case "withdraw_all": {
      // withdraw_all uses redeem(jTokenBalance), simulate with a typical jToken amount
      const r = await sim(info!.address, "redeem(uint256)", [{ type: "uint256", value: "100000000" }]);
      steps.push(buildStep("redeem", `Withdraw all ${info!.underlyingSymbol} from ${jTokenSymbol}`, r, "withdraw_all"));
      break;
    }

    case "borrow": {
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info!.underlyingDecimals)).toString();
      const r = await sim(info!.address, "borrow(uint256)", [{ type: "uint256", value: amountRaw }]);
      steps.push(buildStep("borrow", `Borrow ${amount} ${info!.underlyingSymbol} from ${jTokenSymbol}`, r, "borrow"));
      break;
    }

    case "repay": {
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info!.underlyingDecimals)).toString();
      if (!isTRX && info!.underlying) {
        const ar = await sim(info!.underlying, "approve(address,uint256)", [
          { type: "address", value: info!.address }, { type: "uint256", value: MAX_UINT256 },
        ]);
        steps.push(buildStep("approve", `Approve ${info!.underlyingSymbol} for ${jTokenSymbol}`, ar, "approve"));
      }
      if (isTRX) {
        const r = await sim(info!.address, "repayBorrow()", [], { callValue: amountRaw });
        steps.push(buildStep("repayBorrow", `Repay ${amount} TRX to ${jTokenSymbol}`, r, "repay_trx"));
      } else {
        const r = await sim(info!.address, "repayBorrow(uint256)", [{ type: "uint256", value: amountRaw }]);
        steps.push(buildStep("repayBorrow", `Repay ${amount} ${info!.underlyingSymbol} to ${jTokenSymbol}`, r, "repay_trc20"));
      }
      break;
    }

    case "enter_market": {
      const r = await sim(addresses.comptroller, "enterMarkets(address[])", [{ type: "address[]", value: [info!.address] }]);
      steps.push(buildStep("enterMarkets", `Enable ${jTokenSymbol} as collateral`, r, "enter_market"));
      break;
    }

    case "exit_market": {
      const r = await sim(addresses.comptroller, "exitMarket(address)", [{ type: "address", value: info!.address }]);
      steps.push(buildStep("exitMarket", `Disable ${jTokenSymbol} as collateral`, r, "exit_market"));
      break;
    }

    case "claim_rewards": {
      const r = await sim(addresses.comptroller, "claimReward(address)", [{ type: "address", value: ownerAddress }]);
      steps.push(buildStep("claimReward", `Claim JustLend mining rewards`, r, "claim_rewards"));
      break;
    }
  }

  const totalEnergy = steps.reduce((sum, s) => sum + s.energyEstimate, 0);
  const totalBandwidth = steps.reduce((sum, s) => sum + s.bandwidthEstimate, 0);
  const hasTypical = steps.some((s) => s.energySource === "typical");
  const cost = calculateTRXCost(totalEnergy, totalBandwidth);

  return {
    operation,
    market: jTokenSymbol,
    steps,
    totalEnergy,
    totalBandwidth,
    estimatedTRXCost: cost.total,
    costBreakdown: {
      energyCostTRX: cost.energyCostTRX,
      bandwidthCostTRX: cost.bandwidthCostTRX,
      note: cost.note,
    },
    note: hasTypical
      ? "Some steps could not be simulated on-chain (e.g. insufficient balance or missing approval). Typical values from historical data are used. Actual costs may vary."
      : "All steps were successfully simulated on-chain. Actual costs should be close to these estimates.",
  };
}
