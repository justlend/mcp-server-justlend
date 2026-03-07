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

import { getTronWeb, getWallet } from "./clients.js";
import { getJustLendAddresses, getApiHost } from "../chains.js";
import { ENERGY_MARKET_ABI, ENERGY_RATE_MODEL_ABI } from "../abis.js";

const TRX_PRECISION = 1e6;
const TOKEN_PRECISION = 1e18;
const DEFAULT_FEE_LIMIT = 200_000_000; // 200 TRX

// ============================================================================
// Contract Read Helpers
// ============================================================================

async function getMarketContract(network: string) {
  const tronWeb = getTronWeb(network);
  const addrs = getJustLendAddresses(network);
  return tronWeb.contract(ENERGY_MARKET_ABI, addrs.strx.market);
}

async function getRateModelContract(network: string) {
  const tronWeb = getTronWeb(network);
  const addrs = getJustLendAddresses(network);
  return tronWeb.contract(ENERGY_RATE_MODEL_ABI, addrs.energyRateModel);
}

// ============================================================================
// Market Data Queries
// ============================================================================

/**
 * Get energy rental market data from the JustLend API (dashboard).
 */
export async function getEnergyRentalDashboard(network = "mainnet") {
  const apiHost = getApiHost(network);
  const resp = await fetch(`${apiHost}/strx/dashboard`);
  const json = await resp.json();
  if (json.code !== 0) throw new Error(`Dashboard API error: ${json.message || "unknown"}`);

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

/**
 * Get contract-level rental parameters (on-chain).
 */
export async function getEnergyRentalParams(network = "mainnet") {
  const contract = await getMarketContract(network);

  const [
    liquidateThresholdRaw,
    feeRatioRaw,
    minFeeRaw,
    totalDelegatedRaw,
    totalFrozenRaw,
    maxRentableRaw,
    rentPausedRaw,
    usageChargeRatioRaw,
  ] = await Promise.all([
    contract.methods.liquidateThreshold().call(),
    contract.methods.feeRatio().call(),
    contract.methods.minFee().call(),
    contract.methods.totalDelegatedOfType(1).call(),
    contract.methods.totalFrozenOfType(1).call(),
    contract.methods.maxRentableOfType(1).call(),
    contract.methods.rentPaused(1).call(),
    contract.methods.usageChargeRatio().call(),
  ]);

  return {
    liquidateThreshold: Number(liquidateThresholdRaw),
    feeRatio: Number(feeRatioRaw) / TOKEN_PRECISION,
    minFee: Number(minFeeRaw) / TRX_PRECISION,
    totalDelegated: Number(totalDelegatedRaw) / TRX_PRECISION,
    totalFrozen: Number(totalFrozenRaw) / TRX_PRECISION,
    maxRentable: Number(maxRentableRaw) / TRX_PRECISION,
    rentPaused: Number(rentPausedRaw) !== 0,
    usageChargeRatio: Number(usageChargeRatioRaw) / TOKEN_PRECISION,
  };
}

/**
 * Get the rental rate for a given TRX amount (on-chain).
 * Returns the max of _rentalRate and _stableRate.
 */
export async function getRentalRate(trxAmount: number, network = "mainnet") {
  const contract = await getMarketContract(network);
  const amountSun = BigInt(Math.floor(trxAmount * TRX_PRECISION));

  const [rentalRateRaw, stableRateRaw] = await Promise.all([
    contract.methods._rentalRate(amountSun.toString(), 1).call(),
    contract.methods._stableRate(1).call(),
  ]);

  const rentalRate = Number(rentalRateRaw) / TOKEN_PRECISION;
  const stableRate = Number(stableRateRaw) / TOKEN_PRECISION;
  const rate = Math.max(rentalRate, stableRate);

  return { rentalRate, stableRate, effectiveRate: rate };
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

  const energyStakePerTrx = dashboard.energyStakePerTrx;
  if (!energyStakePerTrx || energyStakePerTrx <= 0) {
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

// ============================================================================
// User Rental Queries
// ============================================================================

/**
 * Get user's rental orders from the API.
 */
export async function getUserRentalOrders(
  address: string,
  type: "renter" | "receiver" | "all" = "all",
  page = 0,
  pageSize = 10,
  network = "mainnet",
) {
  const apiHost = getApiHost(network);
  const params = new URLSearchParams({
    rentType: "1",
    orderBy: "0",
    page: String(page),
    pageSize: String(pageSize),
  });

  if (type === "renter" || type === "all") params.set("renter", address);
  if (type === "receiver" || type === "all") params.set("receiver", address);

  const resp = await fetch(`${apiHost}/strx/rent/allOrderList?${params}`);
  const json = await resp.json();
  if (json.code !== 0) throw new Error(`Order list API error: ${json.code}`);

  return json.data;
}

/**
 * Get on-chain rental info for a renter-receiver pair.
 */
export async function getRentInfo(
  renterAddress: string,
  receiverAddress: string,
  network = "mainnet",
) {
  const contract = await getMarketContract(network);

  const [rentInfoResult, rentalsResult] = await Promise.all([
    contract.methods.getRentInfo(renterAddress, receiverAddress || renterAddress, 1).call(),
    contract.methods.rentals(renterAddress, receiverAddress || renterAddress, 1).call(),
  ]);

  const securityDeposit = Number(rentInfoResult[0]) / TRX_PRECISION;
  const rentBalance = Number(rentalsResult) / TRX_PRECISION;

  return {
    securityDeposit,
    rentBalance,
    hasActiveRental: rentBalance > 0,
  };
}

/**
 * Get return rental info from the API.
 */
export async function getReturnRentalInfo(
  renter: string,
  receiver: string,
  network = "mainnet",
) {
  const apiHost = getApiHost(network);
  const params = new URLSearchParams({ renter, receiver, rentType: "1" });
  const resp = await fetch(`${apiHost}/strx/rent/quit?${params}`);
  const json = await resp.json();

  return {
    securityDeposit: json.data?.securityDeposit,
    rentRemain: json.data?.rentRemain,
    unrecoveredEnergyAmount: json.data?.unrecoveredEnergyAmount,
    dailyRent: json.data?.dailyRent,
    rentAmount: json.data?.rentAmount,
  };
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Rent energy for a receiver address.
 *
 * Validations:
 * 1. Rental not paused
 * 2. Amount within max rentable
 * 3. Sufficient TRX balance (prepayment + fee + gas)
 */
export async function rentEnergy(
  privateKey: string,
  receiverAddress: string,
  energyAmount: number,
  durationSeconds: number,
  network = "mainnet",
) {
  // Calculate price first (includes pause check and max rentable check)
  const priceEstimate = await calculateRentalPrice(energyAmount, durationSeconds, network);

  // Check TRX balance
  const tronWeb = getWallet(privateKey, network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const balanceSun = await tronWeb.trx.getBalance(walletAddress);
  const balanceTrx = Number(balanceSun) / TRX_PRECISION;

  const totalNeeded = priceEstimate.totalPrepayment + DEFAULT_FEE_LIMIT / TRX_PRECISION;
  if (balanceTrx < totalNeeded) {
    throw new Error(
      `Insufficient TRX balance. Have: ${balanceTrx.toFixed(2)} TRX, ` +
      `Need: ~${totalNeeded.toFixed(2)} TRX (prepayment: ${priceEstimate.totalPrepayment.toFixed(2)} + gas)`,
    );
  }

  const addrs = getJustLendAddresses(network);
  const stakeAmountSun = BigInt(Math.floor(priceEstimate.trxAmount * TRX_PRECISION));
  const prepaymentSun = BigInt(Math.ceil(priceEstimate.totalPrepayment * TRX_PRECISION));

  const contract = tronWeb.contract(ENERGY_MARKET_ABI, addrs.strx.market);
  const txId = await contract.methods
    .rentResource(receiverAddress, stakeAmountSun.toString(), 1)
    .send({ callValue: prepaymentSun.toString(), feeLimit: DEFAULT_FEE_LIMIT });

  return {
    txId,
    receiver: receiverAddress,
    energyAmount: priceEstimate.energyAmount,
    trxAmount: priceEstimate.trxAmount,
    totalPrepayment: priceEstimate.totalPrepayment,
    durationSeconds,
  };
}

/**
 * Return/cancel energy rental.
 *
 * Validations:
 * 1. Must have active rental to the receiver
 * 2. endOrderType determines caller perspective (renter or receiver)
 */
export async function returnEnergyRental(
  privateKey: string,
  counterpartyAddress: string,
  endOrderType: "renter" | "receiver" = "renter",
  network = "mainnet",
) {
  const tronWeb = getWallet(privateKey, network);
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
  const contract = tronWeb.contract(ENERGY_MARKET_ABI, addrs.strx.market);

  const methodName = endOrderType === "receiver" ? "returnResourceByReceiver" : "returnResource";
  // For returnResource: first param is the counterparty address
  const targetAddress = counterpartyAddress;

  const txId = await contract.methods[methodName](
    targetAddress,
    stakeAmountSun.toString(),
    1,
  ).send({ feeLimit: DEFAULT_FEE_LIMIT });

  return {
    txId,
    renter,
    receiver,
    returnedTrxAmount: rentInfo.rentBalance,
    refundedDeposit: rentInfo.securityDeposit,
  };
}
