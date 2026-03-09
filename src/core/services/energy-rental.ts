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
import { ENERGY_MARKET_ABI } from "../abis.js";
import { waitForTransaction } from "./transactions.js";
import { checkResourceSufficiency } from "./lending.js";

const TRX_PRECISION = 1e6;
const TOKEN_PRECISION = 1e18;
const DEFAULT_FEE_LIMIT = 200_000_000; // 200 TRX
const FETCH_TIMEOUT_MS = 15_000;

const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function validateTronAddress(address: string, label = "address"): string {
  if (!TRON_ADDRESS_RE.test(address)) {
    throw new Error(`Invalid TRON ${label} format`);
  }
  return address;
}

function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
 */
export async function getEnergyRentalDashboard(network = "mainnet") {
  const apiHost = getApiHost(network);
  const resp = await fetchWithTimeout(`${apiHost}/strx/dashboard`);
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
 *
 * Key differences from new rental calculation:
 * - Uses totalTrxAmount (existing + new) for prepayment and fee
 * - Subtracts existing security deposit from total prepayment
 * - Rate is queried based on new/incremental TRX amount only
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
 * Get user's rental orders from the API.
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
  // Always pass both renter and receiver to get complete results,
  // since self-rental orders (renter === receiver) only appear in
  // the renter-side `orders` list from the API.
  const params = new URLSearchParams({
    rentType: "1",
    orderBy: "0",
    page: String(page),
    pageSize: String(pageSize),
    renter: address,
    receiver: address,
  });

  const resp = await fetchWithTimeout(`${apiHost}/strx/rent/allOrderList?${params}`);
  const json = await resp.json();
  if (json.code !== 0) throw new Error(`Order list API error: ${json.code}`);

  const data = json.data;
  const renterOrders: any[] = data.orders || [];
  const receiverOrders: any[] = data.receiverOrders || [];

  // Self-rental orders (renter === receiver) appear only in renterOrders,
  // but should also be visible when querying as "receiver".
  const selfRentalOrders = renterOrders.filter((o: any) => o.renter === o.receiver);

  if (type === "renter") {
    return { total: data.total || 0, receiverTotal: 0, orders: renterOrders, receiverOrders: [] };
  }
  if (type === "receiver") {
    // Merge receiverOrders with self-rental orders from the renter side
    const merged = [...receiverOrders, ...selfRentalOrders];
    return { total: 0, receiverTotal: merged.length, orders: [], receiverOrders: merged };
  }
  // "all" — include self-rental orders in receiverOrders as well
  const mergedReceiverOrders = [...receiverOrders, ...selfRentalOrders];
  return {
    total: data.total || 0,
    receiverTotal: mergedReceiverOrders.length,
    orders: renterOrders,
    receiverOrders: mergedReceiverOrders,
  };
}

/**
 * Get on-chain rental info for a renter-receiver pair.
 */
export async function getRentInfo(
  renterAddress: string,
  receiverAddress: string,
  network = "mainnet",
) {
  validateTronAddress(renterAddress, "renter address");
  validateTronAddress(receiverAddress, "receiver address");
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
 * Get return rental info from the API and on-chain data.
 * Includes estimated TRX refund if the rental is returned now.
 */
export async function getReturnRentalInfo(
  renter: string,
  receiver: string,
  network = "mainnet",
) {
  validateTronAddress(renter, "renter address");
  validateTronAddress(receiver, "receiver address");
  const apiHost = getApiHost(network);
  const params = new URLSearchParams({ renter, receiver, rentType: "1" });

  const [apiResp, onChainInfo] = await Promise.all([
    fetchWithTimeout(`${apiHost}/strx/rent/quit?${params}`),
    getRentInfo(renter, receiver, network),
  ]);

  const json = await apiResp.json();
  const data = json.data || {};

  const securityDeposit = Number(data.securityDeposit || 0);
  const rentRemain = Number(data.rentRemain || 0);
  const usageRental = Number(data.usageRental || 0);
  const dailyRent = Number(data.dailyRent || 0);
  const rentAmount = Number(data.rentAmount || 0);
  const unrecoveredEnergyAmount = Number(data.unrecoveredEnergyAmount || 0);

  // Estimated refund = securityDeposit + rentRemain (remaining prepayment not yet consumed)
  const estimatedRefundTrx = (securityDeposit + rentRemain) / TRX_PRECISION;

  return {
    hasActiveRental: onChainInfo.hasActiveRental,
    delegatedTrx: onChainInfo.rentBalance,
    securityDeposit: securityDeposit / TRX_PRECISION,
    rentRemain: rentRemain / TRX_PRECISION,
    usageRental: usageRental / TRX_PRECISION,
    dailyRent: dailyRent / TRX_PRECISION,
    rentAmount: rentAmount / TRX_PRECISION,
    unrecoveredEnergyAmount,
    estimatedRefundTrx,
  };
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Rent energy for a receiver address.
 *
 * For new rentals, durationSeconds is required.
 * For renewals (existing active rental), durationSeconds is ignored —
 * the remaining duration from the existing order is used automatically.
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
  durationSeconds: number | undefined,
  network = "mainnet",
) {
  validateTronAddress(receiverAddress, "receiver address");

  // Check if this is a renewal (existing active rental)
  const tronWebForCheck = getWallet(privateKey, network);
  const walletAddress = tronWebForCheck.defaultAddress.base58 as string;
  const existingRental = await getRentInfo(walletAddress, receiverAddress, network);
  const isRenewal = existingRental.hasActiveRental;

  let priceEstimate: RentalPriceEstimate;

  if (isRenewal) {
    // For renewals, get existing order remaining duration
    const orders = await getUserRentalOrders(walletAddress, "renter", 0, 50, network);
    const matchingOrder = orders.orders.find(
      (o: any) => o.receiver === receiverAddress && o.renter === walletAddress,
    );
    if (!matchingOrder || !matchingOrder.canRentSeconds) {
      throw new Error("Active rental found but could not retrieve remaining duration from order");
    }
    const remainingSeconds = Number(matchingOrder.canRentSeconds);
    if (remainingSeconds <= 0) {
      throw new Error("Existing rental has no remaining duration. Please create a new rental instead.");
    }

    // Use renewal calculation: accounts for existing deposit and TRX
    priceEstimate = await calculateRenewalPrice(
      energyAmount,
      existingRental.rentBalance,
      existingRental.securityDeposit,
      remainingSeconds,
      0, // no additional duration for pure energy renewal
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
  const balanceSun = await tronWebForCheck.trx.getBalance(walletAddress);
  const balanceTrx = Number(balanceSun) / TRX_PRECISION;

  // Typical rent_energy tx: ~69k energy, ~383 bandwidth
  const RENT_ENERGY_ESTIMATE = 70000;
  const RENT_BANDWIDTH_ESTIMATE = 400;
  const resourceCheck = await checkResourceSufficiency(walletAddress, RENT_ENERGY_ESTIMATE, RENT_BANDWIDTH_ESTIMATE, network);
  const gasTrx = parseFloat(resourceCheck.energyBurnTRX) + parseFloat(resourceCheck.bandwidthBurnTRX);

  const totalNeeded = priceEstimate.totalPrepayment + gasTrx;
  if (balanceTrx < totalNeeded) {
    throw new Error(
      `Insufficient TRX balance for energy rental. Need ~${totalNeeded.toFixed(2)} TRX (prepayment: ${priceEstimate.totalPrepayment.toFixed(2)} TRX + gas: ${gasTrx.toFixed(2)} TRX)`,
    );
  }

  const addrs = getJustLendAddresses(network);
  const stakeAmountSun = BigInt(Math.floor(priceEstimate.trxAmount * TRX_PRECISION));
  const prepaymentSun = BigInt(Math.ceil(priceEstimate.totalPrepayment * TRX_PRECISION));

  const rentContract = tronWebForCheck.contract(ENERGY_MARKET_ABI, addrs.strx.market);
  const txId = await rentContract.methods
    .rentResource(receiverAddress, stakeAmountSun.toString(), 1)
    .send({ callValue: prepaymentSun.toString(), feeLimit: DEFAULT_FEE_LIMIT });

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
  validateTronAddress(counterpartyAddress, "counterparty address");
  if (endOrderType !== "renter" && endOrderType !== "receiver") {
    throw new Error("endOrderType must be 'renter' or 'receiver'");
  }
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

  // Parse ReturnResource event from transaction logs for actual refunded amounts
  // ReturnResource(address indexed renter, address indexed receiver,
  //   uint256 subedAmount, uint256 resourceType, uint256 usageRental,
  //   uint256 subedSecurityDeposit, uint256 amount, uint256 securityDeposit, uint256 rentIndex)
  let actualSubedAmount = rentInfo.rentBalance;
  let actualSubedSecurityDeposit = rentInfo.securityDeposit;
  let actualUsageRental = 0;

  try {
    const txInfo = await waitForTransaction(txId, network);
    if (txInfo.log && txInfo.log.length > 0) {
      // ReturnResource event topic: keccak256 of the event signature
      const RETURN_RESOURCE_TOPIC =
        tronWeb.sha3(
          "ReturnResource(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
        )?.replace(/^0x/, "");

      for (const log of txInfo.log) {
        const topics = log.topics || [];
        if (topics.length > 0 && topics[0] === RETURN_RESOURCE_TOPIC) {
          const data = log.data || "";
          // data layout (each 64 hex chars = 32 bytes):
          // [0..64]   subedAmount
          // [64..128] resourceType
          // [128..192] usageRental
          // [192..256] subedSecurityDeposit
          // [256..320] amount
          // [320..384] securityDeposit
          // [384..448] rentIndex
          // 安全剥离 0x 前缀
          const cleanData = data.replace(/^0x/, "");
          // 基于 cleanData 进行切片
          actualSubedAmount = Number(BigInt("0x" + cleanData.slice(0, 64))) / TRX_PRECISION;
          actualUsageRental = Number(BigInt("0x" + cleanData.slice(128, 192))) / TRX_PRECISION;
          actualSubedSecurityDeposit = Number(BigInt("0x" + cleanData.slice(192, 256))) / TRX_PRECISION;
          break;
        }
      }
    }
  } catch {
    // If we can't parse the event, fall back to pre-tx estimates
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
