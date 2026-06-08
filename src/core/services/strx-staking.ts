/**
 * JustLend sTRX Staking Service
 *
 * Provides TRX staking operations via the sTRX proxy contract:
 * - Query staking market data (dashboard, APY, exchange rate)
 * - Query user staking account info
 * - Stake TRX to receive sTRX (with balance checks)
 * - Unstake sTRX to receive TRX (with balance checks)
 * - Query and claim staking rewards
 * - Check withdrawal eligibility
 */

import { getTronWeb } from "./clients.js";
import { getSigningClient } from "./wallet.js";
import { getJustLendAddresses, getApiHost } from "../chains.js";
import { STRX_ABI } from "../abis.js";
import { checkResourceSufficiency } from "./lending.js";
import { safeSend } from "./contracts.js";
import { cacheGet, cacheSet } from "./cache.js";
import { fetchWithTimeout } from "./http.js";
import { utils } from "./utils.js";

const TRX_DECIMALS = 6;
const STRX_DECIMALS = 18;
const TRX_PRECISION = 1_000_000n;
const TOKEN_PRECISION = 1_000_000_000_000_000_000n;
const DEFAULT_FEE_LIMIT = 200_000_000; // 200 TRX
const STRX_DASHBOARD_TTL_MS = 60_000; // 60s

const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function validateTronAddress(address: string, label = "address"): string {
  if (!TRON_ADDRESS_RE.test(address)) {
    throw new Error(`Invalid TRON ${label} format`);
  }
  return address;
}

function formatRawUnits(value: bigint | string | number, decimals: number, displayDecimals?: number): string {
  let raw = BigInt(value.toString());
  const negative = raw < 0n;
  if (negative) raw = -raw;
  const scale = 10n ** BigInt(decimals);
  const integer = raw / scale;
  let fraction = (raw % scale).toString().padStart(decimals, "0");
  if (displayDecimals !== undefined) {
    fraction = fraction.slice(0, displayDecimals).padEnd(displayDecimals, "0");
  } else {
    fraction = fraction.replace(/0+$/, "");
  }
  const formatted = fraction ? `${integer.toString()}.${fraction}` : integer.toString();
  return negative ? `-${formatted}` : formatted;
}

function parseTrxToSun(amountTrx: string | number): bigint {
  return utils.parseUnits(String(amountTrx), TRX_DECIMALS);
}

function formatRatio(numerator: bigint, denominator: bigint, decimals = 6): string {
  if (denominator === 0n) return "0";
  const scale = 10n ** BigInt(decimals);
  return formatRawUnits((numerator * scale) / denominator, decimals, decimals);
}

// ============================================================================
// Market Data
// ============================================================================

/**
 * Get sTRX staking dashboard data from the API, with on-chain fallback.
 * On-chain fallback provides exchange rate, total supply, unfreeze delay, etc.
 * but cannot provide APY, price, or JST reward data.
 */
export async function getStrxDashboard(network = "mainnet") {
  const cacheKey = `strx:dashboard:${network}`;
  const cached = cacheGet<Record<string, any>>(cacheKey);
  if (cached) return cached;

  // Try API first
  try {
    const apiHost = getApiHost(network);
    const resp = await fetchWithTimeout(`${apiHost}/strx/dashboard`);
    const json = await resp.json();
    if (json.code !== 0) throw new Error(`API error: ${json.message || "unknown"}`);

    const data = json.data;
    const result = {
      trxPrice: data.trxPrice,
      exchangeRate: data.exchangeRate,
      totalApy: data.totalApy,
      voteApy: data.voteApy,
      totalSupply: data.totalSupply,
      totalUnfreezable: data.totalUnfreezable,
      unfreezeDelayDays: data.unfreezeDelayDays,
      energyStakePerTrx: data.energyStakePerTrx,
      jstAmountRewardRentPerTrx: data.jstAmountRewardRentPerTrx,
      jstPrice: data.jstPrice,
      sTrx1Trx: formatRatio(TOKEN_PRECISION, BigInt(data.exchangeRate)),
      trx1sTrx: formatRatio(BigInt(data.exchangeRate), TOKEN_PRECISION),
    };
    cacheSet(cacheKey, result, STRX_DASHBOARD_TTL_MS);
    return result;
  } catch {
    // API unavailable, fallback to on-chain
  }

  // On-chain fallback
  const tronWeb = getTronWeb(network);
  const addrs = getJustLendAddresses(network);
  const contract = tronWeb.contract(STRX_ABI, addrs.strx.proxy);

  const [exchangeRateRaw, totalSupplyRaw, totalUnfreezableRaw, unfreezeDelayDays] = await Promise.all([
    contract.methods.exchangeRate().call(),
    contract.methods.totalSupply().call(),
    contract.methods.totalUnfreezable().call(),
    contract.methods.getUnfreezeDelayDays().call(),
  ]);

  const exchangeRateBig = BigInt(exchangeRateRaw);
  const exchangeRate = exchangeRateBig.toString();
  const totalSupply = formatRawUnits(totalSupplyRaw, STRX_DECIMALS);
  const totalUnfreezable = formatRawUnits(totalUnfreezableRaw, TRX_DECIMALS);

  const result = {
    trxPrice: null,
    exchangeRate,
    totalApy: null,
    voteApy: null,
    totalSupply,
    totalUnfreezable,
    unfreezeDelayDays: Number(unfreezeDelayDays),
    energyStakePerTrx: null,
    jstAmountRewardRentPerTrx: null,
    jstPrice: null,
    sTrx1Trx: formatRatio(TOKEN_PRECISION, exchangeRateBig),
    trx1sTrx: formatRatio(exchangeRateBig, TOKEN_PRECISION),
    source: "contract",
    note: "APY, price, and reward data unavailable (API down). Exchange rate and supply data from on-chain.",
  };
  cacheSet(cacheKey, result, STRX_DASHBOARD_TTL_MS);
  return result;
}

// ============================================================================
// User Account
// ============================================================================

/**
 * Get user's sTRX staking account info from the API, with on-chain fallback.
 * On-chain fallback reads balanceOf and viewBalanceOfUnderlying instead of returning silent zeros.
 */
export async function getStrxStakeAccount(address: string, network = "mainnet") {
  validateTronAddress(address);

  // Try API first
  try {
    const apiHost = getApiHost(network);
    const resp = await fetchWithTimeout(`${apiHost}/strx/stake/account?addr=${address}`);
    const json = await resp.json();

    if (json.code === 0 && json.data) {
      return json.data;
    }
  } catch {
    // API unavailable, fallback to on-chain
  }

  // On-chain fallback: read balance and underlying value from contract
  const tronWeb = getTronWeb(network);
  const addrs = getJustLendAddresses(network);
  const contract = tronWeb.contract(STRX_ABI, addrs.strx.proxy);

  const [balanceRaw, underlyingRaw] = await Promise.all([
    contract.methods.balanceOf(address).call(),
    contract.methods.viewBalanceOfUnderlying(address).call(),
  ]);

  const strxBalance = formatRawUnits(balanceRaw, STRX_DECIMALS);
  const underlyingTrx = formatRawUnits(underlyingRaw, TRX_DECIMALS);

  return {
    accountSupply: underlyingTrx,
    accountIncome: null,
    accountCanClaimAmount: null,
    accountWithDrawAmount: null,
    accountRentEnergyAmount: null,
    strxBalance,
    roundDetails: [],
    rewardMap: {},
    source: "contract",
    note: "Income and reward data unavailable (API down). Supply data from on-chain balanceOf/viewBalanceOfUnderlying.",
  };
}

/**
 * Get the on-chain sTRX token balance for an address.
 */
export async function getStrxBalance(address: string, network = "mainnet") {
  validateTronAddress(address);
  const tronWeb = getTronWeb(network);
  const addrs = getJustLendAddresses(network);
  const contract = tronWeb.contract(STRX_ABI, addrs.strx.proxy);
  const balance = await contract.methods.balanceOf(address).call();
  return {
    raw: BigInt(balance.toString()),
    formatted: formatRawUnits(balance, STRX_DECIMALS, 6),
    symbol: "sTRX",
    decimals: 18,
  };
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Stake TRX to receive sTRX tokens.
 *
 * Validations:
 * 1. Check TRX balance is sufficient (amount + gas)
 */
export async function stakeTrxToStrx(
  amountTrx: string | number,
  network = "mainnet",
) {
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const addrs = getJustLendAddresses(network);

  // Check TRX balance with dynamic gas estimation
  // Typical stake tx: ~80k energy, ~300 bandwidth
  const balanceSun = BigInt(await tronWeb.trx.getBalance(walletAddress));
  const amountSun = parseTrxToSun(amountTrx);
  if (amountSun <= 0n) throw new Error("Stake amount must be greater than 0 TRX");
  const STAKE_ENERGY_ESTIMATE = 80000;
  const STAKE_BANDWIDTH_ESTIMATE = 300;
  const resourceCheck = await checkResourceSufficiency(walletAddress, STAKE_ENERGY_ESTIMATE, STAKE_BANDWIDTH_ESTIMATE, network);
  const gasSun = parseTrxToSun(
    (parseFloat(resourceCheck.energyBurnTRX) + parseFloat(resourceCheck.bandwidthBurnTRX)).toString(),
  );
  const totalNeededSun = amountSun + gasSun;

  if (balanceSun < totalNeededSun) {
    throw new Error(
      `Insufficient TRX balance for staking. Need ~${formatRawUnits(totalNeededSun, TRX_DECIMALS)} TRX ` +
      `(stake: ${String(amountTrx)} TRX + gas: ${formatRawUnits(gasSun, TRX_DECIMALS)} TRX)`,
    );
  }

  const contract = tronWeb.contract(STRX_ABI, addrs.strx.proxy);

  const { txID: txId } = await safeSend({
    address: addrs.strx.proxy,
    abi: STRX_ABI,
    functionName: "deposit",
    callValue: amountSun.toString(),
    feeLimit: DEFAULT_FEE_LIMIT,
  }, network);

  // Estimate sTRX received based on exchange rate
  let estimatedStrx: string | undefined;
  try {
    const dashboard = await getStrxDashboard(network);
    const exchangeRate = BigInt(dashboard.exchangeRate);
    if (exchangeRate > 0n) {
      estimatedStrx = formatRawUnits((amountSun * TOKEN_PRECISION) / exchangeRate, STRX_DECIMALS, 6);
    }
  } catch {
    // Non-critical, skip
  }

  return {
    txId,
    stakedTrx: String(amountTrx),
    estimatedStrx,
    wallet: walletAddress,
  };
}

/**
 * Unstake sTRX to receive TRX back.
 *
 * Validations:
 * 1. Check sTRX balance is sufficient
 * Note: Unstaked TRX has an unbonding period before it can be withdrawn
 */
export async function unstakeStrx(
  amountStrx: string,
  network = "mainnet",
) {
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const addrs = getJustLendAddresses(network);

  // Check sTRX balance (compare in BigInt to avoid precision loss for large holdings)
  const strxBalance = await getStrxBalance(walletAddress, network);
  const amountWei = utils.parseUnits(amountStrx, STRX_DECIMALS);

  if (strxBalance.raw < amountWei) {
    throw new Error(
      `Insufficient sTRX balance for unstaking. Need ${amountStrx} sTRX`,
    );
  }
  const contract = tronWeb.contract(STRX_ABI, addrs.strx.proxy);

  const { txID: txId } = await safeSend({
    address: addrs.strx.proxy,
    abi: STRX_ABI,
    functionName: "withdraw",
    args: [amountWei.toString()],
    feeLimit: DEFAULT_FEE_LIMIT,
  }, network);

  // Estimate TRX to receive
  let estimatedTrx: string | undefined;
  let unfreezeDelayDays: number | undefined;
  try {
    const dashboard = await getStrxDashboard(network);
    const exchangeRate = BigInt(dashboard.exchangeRate);
    if (exchangeRate > 0n) {
      estimatedTrx = formatRawUnits((amountWei * exchangeRate) / TOKEN_PRECISION, TRX_DECIMALS, 6);
    }
    unfreezeDelayDays = dashboard.unfreezeDelayDays;
  } catch {
    // Non-critical
  }

  return {
    txId,
    unstakedStrx: amountStrx,
    estimatedTrx,
    unfreezeDelayDays,
    wallet: walletAddress,
    note: unfreezeDelayDays
      ? `TRX will be available for withdrawal after ${unfreezeDelayDays} days unbonding period`
      : "TRX will be available after the unbonding period",
  };
}

/**
 * Claim all staking rewards.
 *
 * Validations:
 * 1. Check if there are claimable rewards
 */
export async function claimStrxRewards(
  network = "mainnet",
) {
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const addrs = getJustLendAddresses(network);

  // Check if there are rewards to claim
  const account = await getStrxStakeAccount(walletAddress, network);
  if (!account.accountCanClaimAmount || Number(account.accountCanClaimAmount) <= 0) {
    throw new Error("No claimable staking rewards available");
  }

  const contract = tronWeb.contract(STRX_ABI, addrs.strx.proxy);
  const { txID: txId } = await safeSend({
    address: addrs.strx.proxy,
    abi: STRX_ABI,
    functionName: "claimAll",
    feeLimit: DEFAULT_FEE_LIMIT,
  }, network);

  return {
    txId,
    claimedAmount: account.accountCanClaimAmount,
    wallet: walletAddress,
  };
}

/**
 * Check withdrawal eligibility — whether user has TRX available to withdraw
 * after the unbonding period.
 */
export async function checkWithdrawalEligibility(
  address: string,
  network = "mainnet",
) {
  validateTronAddress(address);
  const account = await getStrxStakeAccount(address, network);
  const dashboard = await getStrxDashboard(network);

  const canClaim = Number(account.accountCanClaimAmount || 0);
  const withdrawAmount = Number(account.accountWithDrawAmount || 0);
  const supply = Number(account.accountSupply || 0);
  const income = Number(account.accountIncome || 0);

  // roundDetails contains pending unstake rounds with expiry info
  const roundDetails = account.roundDetails || [];
  const now = Date.now();
  const pendingRounds = roundDetails.filter((r: any) => r.endTimestamp && r.endTimestamp > now);
  const completedRounds = roundDetails.filter((r: any) => r.endTimestamp && r.endTimestamp <= now);

  return {
    address,
    hasStakedTrx: supply > 0,
    stakedAmount: supply,
    totalIncome: income,
    claimableRewards: canClaim,
    withdrawnAmount: withdrawAmount,
    pendingUnstakeRounds: pendingRounds.length,
    completedUnstakeRounds: completedRounds.length,
    hasCompletedWithdrawals: completedRounds.length > 0,
    unfreezeDelayDays: Number(dashboard.unfreezeDelayDays),
    roundDetails,
  };
}
