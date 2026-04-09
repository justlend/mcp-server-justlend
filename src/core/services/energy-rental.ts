/**
 * JustLend Energy Rental Service
 *
 * Provides energy rental operations via the Market Proxy contract:
 * - Query rental market data (dashboard, prices, rates)
 * - Calculate rental costs for given energy amounts
 * - Query user rental orders
 * - Rent energy (with balance & pause checks)
 * - Return/cancel energy rental (with order existence checks)
 */

import { getTronWeb } from "./clients.js";
import { getSigningClient } from "./wallet.js";
import { getJustLendAddresses, getApiHost, getNetworkConfig } from "../chains.js";
import { ENERGY_MARKET_ABI } from "../abis.js";
import { safeSend } from "./contracts.js";
import { waitForTransaction } from "./transactions.js";
import { checkResourceSufficiency } from "./lending.js";
import { fetchWithTimeout, promiseWithTimeout } from "./http.js";

const TRX_PRECISION = 1e6;
const TOKEN_PRECISION = 1e18;
const DEFAULT_FEE_LIMIT = 200_000_000; // 200 TRX
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function logEnergyRentalFallback(message: string): void {
  console.warn(`[energy-rental] ${message}`);
}

function validateTronAddress(address: string, label = "address"): string {
  if (!TRON_ADDRESS_RE.test(address)) {
    throw new Error(`Invalid TRON ${label} format`);
  }
  return address;
}

// ============================================================================
// Contract Read Helpers
// ============================================================================

async function getMarketContract(network: string) {
  const tronWeb = getTronWeb(network);
  const addrs = getJustLendAddresses(network);
  return tronWeb.contract(ENERGY_MARKET_ABI, addrs.strx.market);
}

// ============================================================================
// Market Data Queries
// ============================================================================

/**
 * Get energy rental market data from the JustLend API (dashboard).
 * Fallback to on-chain global parameters if API fails (e.g., in Nile terminal).
 */
/**
 * Get energy rental market data from the JustLend API (dashboard).
 * Fallback to on-chain global parameters if API fails or if in Nile network.
 */
export async function getEnergyRentalDashboard(network = "mainnet") {
  // 如果是 nile 测试网，直接跳过 API 请求，强制走链上
  if (network !== "nile") {
    const apiHost = getApiHost(network);
    try {
      const resp = await fetchWithTimeout(`${apiHost}/strx/dashboard`);
      const json = await resp.json();
      if (json.code === 0 && json.data) {
        const data = json.data;
        return {
          trxPrice: data.trxPrice,
          exchangeRate: data.exchangeRate,
          totalApy: data.totalApy,
          voteApy: data.voteApy,
          totalSupply: data.totalSupply,
          totalUnfreezable: data.totalUnfreezable,
          unfreezeDelayDays: data.unfreezeDelayDays,
          energyStakePerTrx: data.energyStakePerTrx,
          energyBurnPerTrx: data.energyBurnPerTrx,
          jstAmountRewardRentPerTrx: data.jstAmountRewardRentPerTrx,
          jstPrice: data.jstPrice,
          energyLimit: data.energyLimit,
          energyUsed: data.energyUsed,
          sTrx1Trx: (1e18 / Number(data.exchangeRate)).toFixed(6),
          trx1sTrx: (Number(data.exchangeRate) / 1e18).toFixed(6),
        };
      }
    } catch (error) {
      logEnergyRentalFallback("Dashboard API unavailable; using on-chain fallback.");
    }
  }

  // Pure On-Chain Fallback: Calculate Energy per TRX directly from the network
  const tronWeb = getTronWeb(network);
  const resource = await promiseWithTimeout(
    tronWeb.trx.getAccountResources("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"),
    undefined,
    "Timed out while loading global energy parameters",
  );
  const totalEnergyLimit = resource.TotalEnergyLimit || 90_000_000_000;
  const totalEnergyWeight = resource.TotalEnergyWeight || 1;
  const energyStakePerTrx = Math.floor(totalEnergyLimit / totalEnergyWeight);

  return {
    trxPrice: 0,
    exchangeRate: 1e18,
    totalApy: 0,
    voteApy: 0,
    totalSupply: 0,
    totalUnfreezable: 0,
    unfreezeDelayDays: 14,
    energyStakePerTrx: energyStakePerTrx, // Core value needed for rental calculations
    energyBurnPerTrx: 0,
    jstAmountRewardRentPerTrx: 0,
    jstPrice: 0,
    energyLimit: totalEnergyLimit,
    energyUsed: 0,
    sTrx1Trx: "1",
    trx1sTrx: "1",
  };
}

/**
 * Call a view/pure contract method using triggerSmartContract (low-level).
 * This avoids ABI-dependent tronWeb.contract().methods.xxx().call()
 * which can REVERT on Nile if ABI doesn't exactly match.
 */
async function viewContractMethod(
  contractAddress: string,
  functionSelector: string,
  parameters: Array<{ type: string; value: string | number }>,
  network: string,
): Promise<string | null> {
  const tronWeb = getTronWeb(network);
  const from = (tronWeb.defaultAddress.hex || tronWeb.defaultAddress.base58 || undefined) as string | undefined;

  const result = await promiseWithTimeout(
    tronWeb.transactionBuilder.triggerSmartContract(
      contractAddress,
      functionSelector,
      { _isConstant: true },
      parameters,
      from,
    ),
    undefined,
    "Timed out while reading energy rental contract state",
  );

  if (result && result.result && result.constant_result && result.constant_result.length > 0) {
    return result.constant_result[0];
  }
  return null;
}

function decodeUint256(hex: string, offset = 0): bigint {
  return BigInt("0x" + hex.slice(offset * 64, offset * 64 + 64));
}

/**
 * Get contract-level rental parameters (on-chain).
 * Adapts to Nile contract differences (e.g., rentPaused() has no params,
 * usageChargeRatio may not exist).
 */
export async function getEnergyRentalParams(network = "mainnet") {
  const addrs = getJustLendAddresses(network);
  const market = addrs.strx.market;

  try {
    // These methods exist on both mainnet and Nile
    const [
      liquidateThresholdHex,
      feeRatioHex,
      minFeeHex,
      totalDelegatedHex,
      totalFrozenHex,
      maxRentableHex,
    ] = await Promise.all([
      viewContractMethod(market, "liquidateThreshold()", [], network),
      viewContractMethod(market, "feeRatio()", [], network),
      viewContractMethod(market, "minFee()", [], network),
      viewContractMethod(market, "totalDelegatedOfType(uint256)", [{ type: "uint256", value: 1 }], network),
      viewContractMethod(market, "totalFrozenOfType(uint256)", [{ type: "uint256", value: 1 }], network),
      viewContractMethod(market, "maxRentableOfType(uint256)", [{ type: "uint256", value: 1 }], network),
    ]);

    if (
      !liquidateThresholdHex || !feeRatioHex || !minFeeHex ||
      !totalDelegatedHex || !totalFrozenHex || !maxRentableHex
    ) {
      throw new Error("Core contract view calls returned empty result");
    }

    // rentPaused: try no-param version first (Nile), then with param (mainnet)
    let rentPausedHex: string | null = null;
    rentPausedHex = await viewContractMethod(market, "rentPaused()", [], network).catch(() => null);
    if (!rentPausedHex) {
      rentPausedHex = await viewContractMethod(
        market, "rentPaused(uint256)", [{ type: "uint256", value: 1 }], network,
      ).catch(() => null);
    }

    // usageChargeRatio: may not exist on Nile
    let usageChargeRatio = 0.5; // default
    try {
      const hex = await viewContractMethod(market, "usageChargeRatio()", [], network);
      if (hex) {
        usageChargeRatio = Number(decodeUint256(hex)) / TOKEN_PRECISION;
      }
    } catch {
      logEnergyRentalFallback("Using default usage charge ratio.");
    }

    return {
      liquidateThreshold: Number(decodeUint256(liquidateThresholdHex)),
      feeRatio: Number(decodeUint256(feeRatioHex)) / TOKEN_PRECISION,
      minFee: Number(decodeUint256(minFeeHex)) / TRX_PRECISION,
      totalDelegated: Number(decodeUint256(totalDelegatedHex)) / TRX_PRECISION,
      totalFrozen: Number(decodeUint256(totalFrozenHex)) / TRX_PRECISION,
      maxRentable: Number(decodeUint256(maxRentableHex)) / TRX_PRECISION,
      rentPaused: rentPausedHex ? Number(decodeUint256(rentPausedHex)) !== 0 : false,
      usageChargeRatio,
    };
  } catch (error) {
    logEnergyRentalFallback("Energy rental parameters unavailable; using safe defaults.");

    return {
      liquidateThreshold: 86400,
      feeRatio: 0.05,
      minFee: 50,
      totalDelegated: 0,
      totalFrozen: 0,
      maxRentable: 100_000_000,
      rentPaused: false,
      usageChargeRatio: 0.5,
    };
  }
}

/**
 * Get the rental rate for a given TRX amount.
 * On mainnet: calls _rentalRate/_stableRate on market proxy.
 * On Nile: calls getRentalRate on energyRateModel contract (same as frontend).
 */
export async function getRentalRate(trxAmount: number, network = "mainnet") {
  const addrs = getJustLendAddresses(network);
  const market = addrs.strx.market;

  try {
    // First try mainnet-style: _rentalRate / _stableRate on market proxy
    const amountSun = BigInt(Math.floor(trxAmount * TRX_PRECISION)).toString();

    const [rentalRateHex, stableRateHex] = await Promise.all([
      viewContractMethod(market, "_rentalRate(uint256,uint256)", [
        { type: "uint256", value: amountSun },
        { type: "uint256", value: 1 },
      ], network).catch(() => null),
      viewContractMethod(market, "_stableRate(uint256)", [
        { type: "uint256", value: 1 },
      ], network).catch(() => null),
    ]);

    if (rentalRateHex && stableRateHex) {
      const rentalRate = Number(decodeUint256(rentalRateHex)) / TOKEN_PRECISION;
      const stableRate = Number(decodeUint256(stableRateHex)) / TOKEN_PRECISION;
      return { rentalRate, stableRate, effectiveRate: Math.max(rentalRate, stableRate) };
    }

    // Fallback: Nile-style — get totalDelegated/totalFrozen, call energyRateModel
    logEnergyRentalFallback("Primary rental-rate query unavailable; using fallback estimator.");

    const totalDelegatedHex = await viewContractMethod(
      market, "totalDelegatedOfType(uint256)", [{ type: "uint256", value: 1 }], network,
    );
    const totalFrozenHex = await viewContractMethod(
      market, "totalFrozenOfType(uint256)", [{ type: "uint256", value: 1 }], network,
    );

    if (!totalDelegatedHex || !totalFrozenHex) {
      throw new Error("Cannot get totalDelegated/totalFrozen for rate calculation");
    }

    const totalDelegated = decodeUint256(totalDelegatedHex).toString();
    const totalFrozen = decodeUint256(totalFrozenHex).toString();

    const rateHex = await viewContractMethod(
      addrs.energyRateModel, "getRentalRate(uint256,uint256)", [
      { type: "uint256", value: totalDelegated },
      { type: "uint256", value: totalFrozen },
    ], network,
    );

    if (!rateHex) {
      throw new Error("energyRateModel.getRentalRate returned empty");
    }

    const rate = Number(decodeUint256(rateHex)) / TOKEN_PRECISION;
    return { rentalRate: rate, stableRate: rate, effectiveRate: rate };
  } catch (error) {
    logEnergyRentalFallback("Rental rate unavailable; using default rate.");
    const defaultRate = 4e-8;
    return { rentalRate: defaultRate, stableRate: defaultRate, effectiveRate: defaultRate };
  }
}

// ============================================================================
// Price Calculation
// ============================================================================

export interface RentalPriceEstimate {
  energyAmount: number;
  trxAmount: number;
  durationSeconds: number;
  rate: number;
  fee: number;
  totalPrepayment: number;
  securityDeposit: number;
  dailyRentalCost: number;
}

export interface RenewalPriceEstimate extends RentalPriceEstimate {
  existingTrxAmount: number;
  existingSecurityDeposit: number;
  existingRemainingSeconds: number;
  totalTrxAmount: number;
  renewalPrepayment: number;
}

/**
 * Calculate the rental price for a given energy amount and duration.
 */
export async function calculateRentalPrice(
  energyAmount: number,
  durationSeconds: number,
  network = "mainnet",
): Promise<RentalPriceEstimate> {
  const dashboard = await getEnergyRentalDashboard(network);
  const params = await getEnergyRentalParams(network);

  if (params.rentPaused) {
    throw new Error("Energy rental is currently paused");
  }

  const energyStakePerTrx = Number(dashboard.energyStakePerTrx);
  if (!energyStakePerTrx || energyStakePerTrx <= 0 || Number.isNaN(energyStakePerTrx)) {
    throw new Error("Invalid energyStakePerTrx from dashboard");
  }

  const trxAmount = Math.ceil(energyAmount / energyStakePerTrx);

  if (trxAmount > params.maxRentable) {
    throw new Error(
      `Requested ${trxAmount} TRX exceeds max rentable ${params.maxRentable.toFixed(2)} TRX`,
    );
  }

  const rateInfo = await getRentalRate(trxAmount, network);
  const rate = rateInfo.effectiveRate;
  const fee = Math.max(params.minFee, trxAmount * params.feeRatio);

  const totalPrepayment =
    trxAmount * rate * (durationSeconds + 86400 + params.liquidateThreshold) + fee;

  const unUsageChargeRent =
    trxAmount *
    rate *
    (86400 * (1 - params.usageChargeRatio) + params.liquidateThreshold);
  const securityDeposit = unUsageChargeRent + fee;

  const dailyRentalCost = trxAmount * rate * 86400;

  return {
    energyAmount,
    trxAmount,
    durationSeconds,
    rate,
    fee,
    totalPrepayment,
    securityDeposit,
    dailyRentalCost,
  };
}

/**
 * Calculate the renewal price for adding energy to an existing rental.
 */
export async function calculateRenewalPrice(
  energyAmount: number,
  existingTrxAmount: number,
  existingSecurityDeposit: number,
  existingRemainingSeconds: number,
  additionalDurationSeconds = 0,
  network = "mainnet",
): Promise<RenewalPriceEstimate> {
  const dashboard = await getEnergyRentalDashboard(network);
  const params = await getEnergyRentalParams(network);

  if (params.rentPaused) {
    throw new Error("Energy rental is currently paused");
  }

  const energyStakePerTrx = Number(dashboard.energyStakePerTrx);
  if (!energyStakePerTrx || energyStakePerTrx <= 0 || Number.isNaN(energyStakePerTrx)) {
    throw new Error("Invalid energyStakePerTrx from dashboard");
  }

  // New TRX to add (incremental)
  const newTrxAmount = energyAmount > 0 ? Math.ceil(energyAmount / energyStakePerTrx) : 0;
  const totalTrxAmount = newTrxAmount + existingTrxAmount;

  // Rate is based on the NEW/incremental amount
  const rateInfo = await getRentalRate(newTrxAmount, network);
  const rate = rateInfo.effectiveRate;

  // Fee on total TRX amount
  const fee = Math.max(params.minFee, totalTrxAmount * params.feeRatio);

  // Total seconds = existing remaining + additional duration
  const totalSeconds = existingRemainingSeconds + additionalDurationSeconds;

  // Gross prepayment for the combined order, minus existing deposit
  const grossPrepayment =
    totalTrxAmount * rate * (totalSeconds + 86400 + params.liquidateThreshold) + fee;
  const renewalPrepayment = Math.max(0, grossPrepayment - existingSecurityDeposit);

  // Security deposit for the combined order
  const unUsageChargeRent =
    totalTrxAmount *
    rate *
    (86400 * (1 - params.usageChargeRatio) + params.liquidateThreshold);
  const securityDeposit = unUsageChargeRent + fee;

  const dailyRentalCost = totalTrxAmount * rate * 86400;

  return {
    energyAmount,
    trxAmount: newTrxAmount,
    durationSeconds: totalSeconds,
    rate,
    fee,
    totalPrepayment: renewalPrepayment,
    securityDeposit,
    dailyRentalCost,
    existingTrxAmount,
    existingSecurityDeposit,
    existingRemainingSeconds,
    totalTrxAmount,
    renewalPrepayment,
  };
}

// ============================================================================
// User Rental Queries
// ============================================================================

/**
 * Fallback: scan RentResource events from the market contract via TronGrid v1 API
 * to discover rental orders for a given address, then verify each on-chain.
 * This is used when the backend JustLend API is unavailable (e.g., Nile testnet).
 */
async function getOrdersFromContractEvents(
  address: string,
  network: string,
): Promise<{ orders: any[]; receiverOrders: any[] }> {
  const tronWeb = getTronWeb(network);
  const addrs = getJustLendAddresses(network);
  const marketAddress = addrs.strx.market;
  const networkConfig = getNetworkConfig(network);

  try {
    // Use TronGrid v1 event API directly (tronWeb.getEventResult is unreliable on Nile)
    const eventUrl =
      `${networkConfig.fullNode}/v1/contracts/${marketAddress}/events` +
      `?event_name=RentResource&only_confirmed=true&limit=200`;

    const resp = await fetchWithTimeout(eventUrl);
    const json = await resp.json();

    if (!json.success || !json.data || !Array.isArray(json.data) || json.data.length === 0) {
      return { orders: [], receiverOrders: [] };
    }

    // Collect unique renter-receiver pairs involving our address
    const renterPairs: Array<{ renter: string; receiver: string }> = [];
    const receiverPairs: Array<{ renter: string; receiver: string }> = [];
    const seenPairs = new Set<string>();

    for (const event of json.data) {
      const result = event.result || {};
      // v1 API returns hex addresses (without 41 prefix)
      const renterHex = result.renter || result._renter || result["0"];
      const receiverHex = result.receiver || result._receiver || result["1"];

      if (!renterHex || !receiverHex) continue;

      // Convert hex addresses to base58
      // TronGrid v1 returns "0x..." format, need to convert to "41..." TRON hex first
      const toB58 = (hex: string): string => {
        if (hex.startsWith("T")) return hex;
        const cleanHex = hex.replace(/^0x/, "");
        return tronWeb.address.fromHex("41" + cleanHex);
      };

      const renterB58 = toB58(renterHex);
      const receiverB58 = toB58(receiverHex);

      const pairKey = `${renterB58}-${receiverB58}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      if (renterB58 === address) {
        renterPairs.push({ renter: renterB58, receiver: receiverB58 });
      }
      if (receiverB58 === address) {
        receiverPairs.push({ renter: renterB58, receiver: receiverB58 });
      }
    }

    // Verify each pair on-chain to find active rentals
    const verifyPair = async (pair: { renter: string; receiver: string }) => {
      try {
        const info = await getRentInfo(pair.renter, pair.receiver, network);
        if (info.hasActiveRental) {
          return {
            renter: pair.renter,
            receiver: pair.receiver,
            rentBalance: info.rentBalance,
            securityDeposit: info.securityDeposit,
            hasActiveRental: true,
            source: "on-chain-event-scan",
          };
        }
      } catch {
        // skip failed verifications
      }
      return null;
    };

    const [renterResults, receiverResults] = await Promise.all([
      Promise.all(renterPairs.map(verifyPair)),
      Promise.all(receiverPairs.map(verifyPair)),
    ]);

    const activeRenterOrders = renterResults.filter(Boolean);
    const activeReceiverOrders = receiverResults.filter(Boolean);

    return { orders: activeRenterOrders, receiverOrders: activeReceiverOrders };
  } catch (error) {
    logEnergyRentalFallback("Event-based rental order scan failed.");
    return { orders: [], receiverOrders: [] };
  }
}

/**
 * Get user's rental orders.
 * Strategy:
 * 1. Try the backend API (works on mainnet, may work on Nile)
 * 2. If API fails or returns empty, fall back to on-chain event scanning
 */
export async function getUserRentalOrders(
  address: string,
  type: "renter" | "receiver" | "all" = "all",
  page = 0,
  pageSize = 10,
  network = "mainnet",
) {
  validateTronAddress(address, "address");

  const apiHost = getApiHost(network);
  const params = new URLSearchParams({
    rentType: "1",
    orderBy: "0",
    page: String(page),
    pageSize: String(pageSize),
    renter: address,
    receiver: address,
  });

  let apiSuccess = false;
  try {
    const resp = await fetchWithTimeout(`${apiHost}/strx/rent/allOrderList?${params}`);
    const json = await resp.json();
    if (json.code !== 0) throw new Error(`API returned code ${json.code}`);

    const data = json.data;
    const renterOrders: any[] = data.orders || [];
    const receiverOrders: any[] = data.receiverOrders || [];

    // API returned data — check if it's non-empty
    if (renterOrders.length > 0 || receiverOrders.length > 0) {
      apiSuccess = true;
      const selfRentalOrders = renterOrders.filter((o: any) => o.renter === o.receiver);

      if (type === "renter") {
        return { total: data.total || 0, receiverTotal: 0, orders: renterOrders, receiverOrders: [] };
      }
      if (type === "receiver") {
        const merged = [...receiverOrders, ...selfRentalOrders];
        return { total: 0, receiverTotal: merged.length, orders: [], receiverOrders: merged };
      }

      const mergedReceiverOrders = [...receiverOrders, ...selfRentalOrders];
      return {
        total: data.total || 0,
        receiverTotal: mergedReceiverOrders.length,
        orders: renterOrders,
        receiverOrders: mergedReceiverOrders,
      };
    }
    // API returned empty — may be legitimate or API limitation, fall through to event scan
    apiSuccess = true; // API worked, just returned empty
  } catch (error) {
    logEnergyRentalFallback("Rental order API unavailable; trying on-chain discovery.");
  }

  // Fallback: scan contract events to discover active orders
  const eventOrders = await getOrdersFromContractEvents(address, network);

  if (eventOrders.orders.length > 0 || eventOrders.receiverOrders.length > 0) {
    if (type === "renter") {
      return { total: eventOrders.orders.length, receiverTotal: 0, orders: eventOrders.orders, receiverOrders: [], source: "on-chain-event-scan" };
    }
    if (type === "receiver") {
      return { total: 0, receiverTotal: eventOrders.receiverOrders.length, orders: [], receiverOrders: eventOrders.receiverOrders, source: "on-chain-event-scan" };
    }
    return {
      total: eventOrders.orders.length,
      receiverTotal: eventOrders.receiverOrders.length,
      orders: eventOrders.orders,
      receiverOrders: eventOrders.receiverOrders,
      source: "on-chain-event-scan",
    };
  }

  // Both API and event scan returned empty
  return {
    total: 0,
    receiverTotal: 0,
    orders: [],
    receiverOrders: [],
    source: apiSuccess ? "api-empty" : "all-fallbacks-exhausted",
  };
}

/**
 * Get on-chain rental info for a renter-receiver pair.
 * Uses low-level triggerSmartContract to avoid ABI mismatch on Nile.
 */
export async function getRentInfo(
  renterAddress: string,
  receiverAddress: string,
  network = "mainnet",
) {
  validateTronAddress(renterAddress, "renter address");
  validateTronAddress(receiverAddress, "receiver address");
  const addrs = getJustLendAddresses(network);
  const market = addrs.strx.market;
  const receiver = receiverAddress || renterAddress;

  try {
    const [rentInfoHex, rentalsHex] = await Promise.all([
      viewContractMethod(market, "getRentInfo(address,address,uint256)", [
        { type: "address", value: renterAddress },
        { type: "address", value: receiver },
        { type: "uint256", value: 1 },
      ], network),
      viewContractMethod(market, "rentals(address,address,uint256)", [
        { type: "address", value: renterAddress },
        { type: "address", value: receiver },
        { type: "uint256", value: 1 },
      ], network),
    ]);

    const securityDeposit = rentInfoHex
      ? Number(decodeUint256(rentInfoHex, 0)) / TRX_PRECISION
      : 0;
    const rentBalance = rentalsHex
      ? Number(decodeUint256(rentalsHex, 0)) / TRX_PRECISION
      : 0;

    return {
      securityDeposit,
      rentBalance,
      hasActiveRental: rentBalance > 0,
    };
  } catch (error) {
    logEnergyRentalFallback("Rental status lookup failed; assuming no active rental.");
    return {
      securityDeposit: 0,
      rentBalance: 0,
      hasActiveRental: false,
    };
  }
}

/**
 * Get return rental info from the API, fallback to on-chain estimates if API fails.
 */
/**
 * Get return rental info from the API, fallback to on-chain estimates if API fails or in Nile.
 */
export async function getReturnRentalInfo(
  renter: string,
  receiver: string,
  network = "mainnet",
) {
  validateTronAddress(renter, "renter address");
  validateTronAddress(receiver, "receiver address");
  const onChainInfo = await getRentInfo(renter, receiver, network);

  // Nile 环境熔断，不调 API
  if (network !== "nile") {
    const apiHost = getApiHost(network);
    const params = new URLSearchParams({ renter, receiver, rentType: "1" });

    try {
      const apiResp = await fetchWithTimeout(`${apiHost}/strx/rent/quit?${params}`);
      const json = await apiResp.json();
      if (json.code === 0 && json.data) {
        const data = json.data;
        const securityDeposit = Number(data.securityDeposit || 0);
        const rentRemain = Number(data.rentRemain || 0);
        return {
          hasActiveRental: onChainInfo.hasActiveRental,
          delegatedTrx: onChainInfo.rentBalance,
          securityDeposit: securityDeposit / TRX_PRECISION,
          rentRemain: rentRemain / TRX_PRECISION,
          usageRental: Number(data.usageRental || 0) / TRX_PRECISION,
          dailyRent: Number(data.dailyRent || 0) / TRX_PRECISION,
          rentAmount: Number(data.rentAmount || 0) / TRX_PRECISION,
          unrecoveredEnergyAmount: Number(data.unrecoveredEnergyAmount || 0),
          estimatedRefundTrx: (securityDeposit + rentRemain) / TRX_PRECISION,
        };
      }
    } catch (error) {
      logEnergyRentalFallback("Return-info API unavailable; using on-chain estimate.");
    }
  }

  // Pure On-chain fallback
  return {
    hasActiveRental: onChainInfo.hasActiveRental,
    delegatedTrx: onChainInfo.rentBalance,
    securityDeposit: onChainInfo.securityDeposit,
    rentRemain: 0,
    usageRental: 0,
    dailyRent: 0,
    rentAmount: 0,
    unrecoveredEnergyAmount: 0,
    // The securityDeposit serves as the maximum possible refund upper-bound.
    estimatedRefundTrx: onChainInfo.securityDeposit,
  };
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Rent energy for a receiver address.
 * Automatically handles backend API failures for remaining duration via on-chain calculation fallback.
 */
export async function rentEnergy(
  receiverAddress: string,
  energyAmount: number,
  durationSeconds: number | undefined,
  network = "mainnet",
) {
  validateTronAddress(receiverAddress, "receiver address");

  const tronWebForCheck = await getSigningClient(network);
  const walletAddress = tronWebForCheck.defaultAddress.base58 as string;
  const existingRental = await getRentInfo(walletAddress, receiverAddress, network);
  const isRenewal = existingRental.hasActiveRental;

  let priceEstimate: RentalPriceEstimate;

  if (isRenewal) {
    let remainingSeconds = 0;

    // 1. Try backend API first
    const orders = await getUserRentalOrders(walletAddress, "renter", 0, 50, network);
    const matchingOrder = orders.orders.find(
      (o: any) => o.receiver === receiverAddress && o.renter === walletAddress,
    );

    if (matchingOrder && matchingOrder.canRentSeconds) {
      remainingSeconds = Number(matchingOrder.canRentSeconds);
    } else {
      // 2. Pure On-chain Fallback calculation if API fails
      logEnergyRentalFallback("Calculating remaining rental time from on-chain state.");
      const params = await getEnergyRentalParams(network);
      const rateInfo = await getRentalRate(existingRental.rentBalance, network);
      const rate = rateInfo.effectiveRate;
      const currentFee = Math.max(params.minFee, existingRental.rentBalance * params.feeRatio);

      const unUsageChargeRent = existingRental.securityDeposit - currentFee;
      if (unUsageChargeRent > 0 && existingRental.rentBalance > 0 && rate > 0) {
        remainingSeconds = (unUsageChargeRent / (existingRental.rentBalance * rate)) -
          (86400 * (1 - params.usageChargeRatio)) - params.liquidateThreshold;
      }
      remainingSeconds = Math.max(0, Math.floor(remainingSeconds));
    }

    if (remainingSeconds <= 0 && (!durationSeconds || durationSeconds <= 0)) {
      throw new Error("Existing rental is expired. Please specify durationSeconds to extend.");
    }

    priceEstimate = await calculateRenewalPrice(
      energyAmount,
      existingRental.rentBalance,
      existingRental.securityDeposit,
      remainingSeconds,
      durationSeconds || 0, // Fallback/CLI users might want to add more time
      network,
    );
  } else {
    if (!durationSeconds || durationSeconds <= 0) {
      throw new Error("durationSeconds is required for new rentals");
    }
    if (energyAmount < 300000) {
      throw new Error("Minimum energy amount for new rentals is 300,000. For renewals, minimum is 50,000.");
    }
    priceEstimate = await calculateRentalPrice(energyAmount, durationSeconds, network);
  }

  // Check TRX balance with dynamic gas estimation
  const balanceSun = await promiseWithTimeout(
    tronWebForCheck.trx.getBalance(walletAddress),
    undefined,
    "Timed out while loading renter TRX balance",
  );
  const balanceTrx = Number(balanceSun) / TRX_PRECISION;

  const RENT_ENERGY_ESTIMATE = 70000;
  const RENT_BANDWIDTH_ESTIMATE = 400;
  let gasTrx = 30;

  if (network === "nile") {
    logEnergyRentalFallback("Using fallback gas estimate for energy rental.");
    gasTrx = 30;
  } else {
    const resourceCheck = await checkResourceSufficiency(walletAddress, RENT_ENERGY_ESTIMATE, RENT_BANDWIDTH_ESTIMATE, network);
    gasTrx = parseFloat(resourceCheck.energyBurnTRX) + parseFloat(resourceCheck.bandwidthBurnTRX);
  }

  const totalNeeded = priceEstimate.totalPrepayment + gasTrx;
  if (balanceTrx < totalNeeded) {
    throw new Error(
      `Insufficient TRX balance for energy rental. Need ~${totalNeeded.toFixed(2)} TRX (prepayment: ${priceEstimate.totalPrepayment.toFixed(2)} TRX + gas: ${gasTrx.toFixed(2)} TRX)`,
    );
  }

  const addrs = getJustLendAddresses(network);
  const stakeAmountSun = BigInt(Math.floor(priceEstimate.trxAmount * TRX_PRECISION));
  const prepaymentSun = BigInt(Math.ceil(priceEstimate.totalPrepayment * TRX_PRECISION));

  const { txID: txId } = await safeSend({
    address: addrs.strx.market,
    abi: ENERGY_MARKET_ABI,
    functionName: "rentResource",
    args: [receiverAddress, stakeAmountSun.toString(), 1],
    callValue: prepaymentSun.toString(),
    feeLimit: DEFAULT_FEE_LIMIT,
  }, network);

  return {
    txId,
    receiver: receiverAddress,
    energyAmount: priceEstimate.energyAmount,
    trxAmount: priceEstimate.trxAmount,
    totalPrepayment: priceEstimate.totalPrepayment,
    durationSeconds: priceEstimate.durationSeconds,
    isRenewal,
  };
}

/**
 * Return/cancel energy rental.
 */
export async function returnEnergyRental(
  counterpartyAddress: string,
  endOrderType: "renter" | "receiver" = "renter",
  network = "mainnet",
) {
  validateTronAddress(counterpartyAddress, "counterparty address");
  if (endOrderType !== "renter" && endOrderType !== "receiver") {
    throw new Error("endOrderType must be 'renter' or 'receiver'");
  }
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const addrs = getJustLendAddresses(network);

  // Determine renter and receiver based on caller type
  const renter = endOrderType === "renter" ? walletAddress : counterpartyAddress;
  const receiver = endOrderType === "renter" ? counterpartyAddress : walletAddress;

  // Check if active rental exists
  const rentInfo = await getRentInfo(renter, receiver, network);
  if (!rentInfo.hasActiveRental) {
    throw new Error(
      `No active energy rental found from renter ${renter} to receiver ${receiver}`,
    );
  }

  const stakeAmountSun = BigInt(Math.floor(rentInfo.rentBalance * TRX_PRECISION));

  const methodName = endOrderType === "receiver" ? "returnResourceByReceiver" : "returnResource";
  const targetAddress = counterpartyAddress;

  const { txID: txId } = await safeSend({
    address: addrs.strx.market,
    abi: ENERGY_MARKET_ABI,
    functionName: methodName,
    args: [targetAddress, stakeAmountSun.toString(), 1],
    feeLimit: DEFAULT_FEE_LIMIT,
  }, network);

  let actualSubedAmount = rentInfo.rentBalance;
  let actualSubedSecurityDeposit = rentInfo.securityDeposit;
  let actualUsageRental = 0;

  try {
    const txInfo = await waitForTransaction(txId, network);
    if (txInfo.log && txInfo.log.length > 0) {
      const RETURN_RESOURCE_TOPIC =
        tronWeb.sha3(
          "ReturnResource(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
        )?.replace(/^0x/, "");

      for (const log of txInfo.log) {
        const topics = log.topics || [];
        if (topics.length > 0 && topics[0] === RETURN_RESOURCE_TOPIC) {
          const data = log.data || "";
          const cleanData = data.replace(/^0x/, "");
          actualSubedAmount = Number(BigInt("0x" + cleanData.slice(0, 64))) / TRX_PRECISION;
          actualUsageRental = Number(BigInt("0x" + cleanData.slice(128, 192))) / TRX_PRECISION;
          actualSubedSecurityDeposit = Number(BigInt("0x" + cleanData.slice(192, 256))) / TRX_PRECISION;
          break;
        }
      }
    }
  } catch {
    // Fall back to pre-tx estimates if parsing fails
  }

  return {
    txId,
    renter,
    receiver,
    returnedTrxAmount: actualSubedAmount,
    usageRental: actualUsageRental,
    refundedDeposit: actualSubedSecurityDeposit,
  };
}
