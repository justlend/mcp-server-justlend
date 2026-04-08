/**
 * JustLend V1 Market Data Services
 */

import { getTronWeb } from "./clients.js";
import { getJustLendAddresses, getAllJTokens, getApiHost, type JTokenInfo } from "../chains.js";
import { JTOKEN_ABI, COMPTROLLER_ABI, PRICE_ORACLE_ABI } from "../abis.js";
import { fetchPriceFromAPI } from "./price.js";
import { cacheGet, cacheSet } from "./cache.js";

const BLOCKS_PER_YEAR = 10_512_000;
const MARKETS_TTL_MS = 60_000; // 60s
const MANTISSA = 1e18;

export interface MarketData {
  symbol: string;
  underlyingSymbol: string;
  jTokenAddress: string;
  underlyingAddress: string;
  supplyAPY: number;
  borrowAPY: number;
  totalSupply: string;
  totalBorrows: string;
  totalReserves: string;
  availableLiquidity: string;
  exchangeRate: string;
  collateralFactor: number;
  reserveFactor: number;
  isListed: boolean;
  mintPaused: boolean;
  borrowPaused: boolean;
  underlyingPriceUSD: string;
  utilizationRate: number;
}

function rateToAPY(ratePerBlock: bigint): number {
  const rate = Number(ratePerBlock) / MANTISSA;
  const apy = (Math.pow(1 + rate, BLOCKS_PER_YEAR) - 1) * 100;
  return Math.round(apy * 100) / 100;
}

function formatUnits(raw: bigint, decimals: number): string {
  const divisor = 10 ** decimals;
  const value = Number(raw) / divisor;
  if (value > 1e6) return value.toFixed(2);
  if (value > 1) return value.toFixed(6);
  return value.toFixed(decimals);
}


/**
 * Get full market data for a single jToken market (V1).
 */
export async function getMarketData(jTokenInfo: JTokenInfo, network = "mainnet"): Promise<MarketData> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);

  const jToken = tronWeb.contract(JTOKEN_ABI, jTokenInfo.address);
  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);

  const [
    supplyRatePerBlock,
    borrowRatePerBlock,
    totalSupplyRaw,
    totalBorrowsRaw,
    totalReservesRaw,
    cashRaw,
    exchangeRateRaw,
    reserveFactorRaw,
    marketInfo,
    mintPaused,
    borrowPaused,
    oracleAddressHex
  ] = await Promise.all([
    jToken.methods.supplyRatePerBlock().call(),
    jToken.methods.borrowRatePerBlock().call(),
    jToken.methods.totalSupply().call(),
    jToken.methods.totalBorrows().call(),
    jToken.methods.totalReserves().call(),
    jToken.methods.getCash().call(),
    jToken.methods.exchangeRateStored().call(),
    jToken.methods.reserveFactorMantissa().call(),
    comptroller.methods.markets(jTokenInfo.address).call(),
    comptroller.methods.mintGuardianPaused(jTokenInfo.address).call(),
    comptroller.methods.borrowGuardianPaused(jTokenInfo.address).call(),
    comptroller.methods.oracle().call(),
  ]);

  let underlyingPriceRaw = 0n;
  let priceUSD = 0;

  try {
    const realOracleAddress = tronWeb.address.fromHex(oracleAddressHex);
    const oracle = tronWeb.contract(PRICE_ORACLE_ABI, realOracleAddress);
    underlyingPriceRaw = BigInt(await oracle.methods.getUnderlyingPrice(jTokenInfo.address).call());
  } catch (err: any) {
    // 链上报错静默，交由下游 API 兜底
  }

  // 价格决策：如果是测试网或者是0，强制走 API 兜底
  if (underlyingPriceRaw > 0n && network === "mainnet") {
    const priceScale = 10 ** (36 - jTokenInfo.underlyingDecimals);
    priceUSD = Number(underlyingPriceRaw) / priceScale;
  } else {
    // 传入 UnderlyingSymbol 进行跨网查找
    const apiPrice = await fetchPriceFromAPI(jTokenInfo.underlyingSymbol, jTokenInfo.underlyingDecimals, network);
    if (apiPrice === null) {
      throw new Error(`[Price Exception] Failed to fetch price for ${jTokenInfo.underlyingSymbol} from API`);
    }
    priceUSD = apiPrice;
  }

  // 💡 价格为 0 时强制抛出异常！
  if (priceUSD === 0) {
    throw new Error(`[Price Exception] Final computed price for ${jTokenInfo.symbol} is 0. This is considered an anomaly. Oracle raw: ${underlyingPriceRaw}`);
  }

  const supplyAPY = rateToAPY(BigInt(supplyRatePerBlock));
  const borrowAPY = rateToAPY(BigInt(borrowRatePerBlock));
  const totalBorrowsBig = BigInt(totalBorrowsRaw);
  const cashBig = BigInt(cashRaw);
  const totalSupplyBig = BigInt(totalSupplyRaw);
  const totalReservesBig = BigInt(totalReservesRaw);
  const denominator = cashBig + totalBorrowsBig - totalReservesBig;
  const utilizationRate = denominator > 0n ? Math.round(Number(totalBorrowsBig * 10000n / denominator)) / 100 : 0;
  const collateralFactor = Number(BigInt(marketInfo.collateralFactorMantissa)) / MANTISSA * 100;
  const reserveFactor = Number(BigInt(reserveFactorRaw)) / MANTISSA * 100;
  const exchangeRateNum = Number(BigInt(exchangeRateRaw)) / MANTISSA;

  return {
    symbol: jTokenInfo.symbol,
    underlyingSymbol: jTokenInfo.underlyingSymbol,
    jTokenAddress: jTokenInfo.address,
    underlyingAddress: jTokenInfo.underlying,
    supplyAPY,
    borrowAPY,
    totalSupply: formatUnits(totalSupplyBig, jTokenInfo.decimals),
    totalBorrows: formatUnits(totalBorrowsBig, jTokenInfo.underlyingDecimals),
    totalReserves: formatUnits(totalReservesBig, jTokenInfo.underlyingDecimals),
    availableLiquidity: formatUnits(cashBig, jTokenInfo.underlyingDecimals),
    exchangeRate: exchangeRateNum.toFixed(10),
    collateralFactor: Math.round(collateralFactor * 100) / 100,
    reserveFactor: Math.round(reserveFactor * 100) / 100,
    isListed: Boolean(marketInfo.isListed),
    mintPaused: Boolean(mintPaused),
    borrowPaused: Boolean(borrowPaused),
    underlyingPriceUSD: priceUSD.toFixed(6),
    utilizationRate,
  };
}

/**
 * Fetch single market data from API by jToken address, mapped to MarketData interface.
 */
async function getMarketDataFromAPIByToken(jTokenInfo: JTokenInfo, network = "mainnet"): Promise<MarketData> {
  const host = getApiHost(network);
  const resp = await fetch(`${host}/justlend/markets`);
  if (!resp.ok) throw new Error(`Markets API failed: ${resp.status}`);
  const json = await resp.json();
  if (json.code !== 0 || !json.data?.jtokenList) throw new Error("Invalid API response");

  const m = json.data.jtokenList.find(
    (item: any) => item.jtokenAddress?.toLowerCase() === jTokenInfo.address.toLowerCase(),
  );
  if (!m) throw new Error(`Market ${jTokenInfo.symbol} not found in API`);

  const depositedUSD = parseFloat(m.depositedUSD || "0");
  const borrowedUSD = parseFloat(m.borrowedUSD || "0");
  const totalSupplyRaw = parseFloat(m.totalSupply || "0");
  const exchangeRate = parseFloat(m.exchangeRate || "0");
  const underlyingAmount = totalSupplyRaw > 0 && exchangeRate > 0
    ? (totalSupplyRaw * exchangeRate) / 1e18 / (10 ** jTokenInfo.underlyingDecimals)
    : 0;
  const priceUSD = underlyingAmount > 0 ? depositedUSD / underlyingAmount : 0;
  const utilizationRate = depositedUSD > 0 ? Math.round(borrowedUSD / depositedUSD * 10000) / 100 : 0;

  return {
    symbol: jTokenInfo.symbol,
    underlyingSymbol: jTokenInfo.underlyingSymbol,
    jTokenAddress: jTokenInfo.address,
    underlyingAddress: jTokenInfo.underlying,
    supplyAPY: Math.round(parseFloat(m.depositedAPY || "0") * 100 * 100) / 100,
    borrowAPY: Math.round(parseFloat(m.borrowedAPY || "0") * 100 * 100) / 100,
    totalSupply: totalSupplyRaw.toString(),
    totalBorrows: m.totalBorrow || "0",
    totalReserves: m.totalReserves || "0",
    availableLiquidity: m.availableLiquidity || "0",
    exchangeRate: exchangeRate.toFixed(10),
    collateralFactor: Math.round(parseFloat(m.collateralFactor || "0") / 1e16 * 100) / 100,
    reserveFactor: Math.round(parseFloat(m.reserveFactor || "0") / 1e16 * 100) / 100,
    isListed: true,
    mintPaused: m.mintPaused === "1" || m.mintPaused === 1,
    borrowPaused: m.borrowPaused === "1" || m.borrowPaused === 1,
    underlyingPriceUSD: priceUSD.toFixed(6),
    utilizationRate,
  };
}

/**
 * Get single market data with automatic fallback: on-chain first, API as fallback.
 */
export async function getMarketDataWithFallback(jTokenInfo: JTokenInfo, network = "mainnet") {
  try {
    const data = await getMarketData(jTokenInfo, network);
    return { data, source: "contract" as const };
  } catch {
    const data = await getMarketDataFromAPIByToken(jTokenInfo, network);
    return { data, source: "api" as const };
  }
}

/**
 * Get market data for all listed JustLend V1 markets.
 *
 * VERSION: V1 - Queries all V1 jToken markets
 */
export async function getAllMarketData(network = "mainnet"): Promise<MarketData[]> {
  const tokens = getAllJTokens(network);
  // Query sequentially to avoid RPC rate-limiting (especially on testnet nodes)
  const allResults: MarketData[] = [];
  for (const token of tokens) {
    try {
      const data = await getMarketData(token, network);
      allResults.push(data);
    } catch {
      // Skip markets that fail to query
    }
  }
  return allResults;
}

/**
 * Get protocol-level summary from V1 Comptroller.
 *
 * VERSION: V1 - Queries JustLend V1 Comptroller contract
 */
export async function getProtocolSummary(network = "mainnet") {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);
  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);

  const [closeFactor, liquidationIncentive, allMarkets, oracleAddress] = await Promise.all([
    comptroller.methods.closeFactorMantissa().call(),
    comptroller.methods.liquidationIncentiveMantissa().call(),
    comptroller.methods.getAllMarkets().call(),
    comptroller.methods.oracle().call(),
  ]);

  return {
    comptroller: addresses.comptroller,
    oracle: oracleAddress,
    closeFactor: `${(Number(BigInt(closeFactor)) / MANTISSA * 100).toFixed(1)}%`,
    liquidationIncentive: `${(Number(BigInt(liquidationIncentive)) / MANTISSA * 100).toFixed(1)}%`,
    totalMarkets: allMarkets.length,
    marketAddresses: allMarkets,
    network,
  };
}

/**
 * Get market data from JustLend V1 API (more stable than direct contract queries).
 * API returns comprehensive market data including APY, TVL, prices, etc.
 *
 * VERSION: V1 - Queries JustLend V1 API endpoints
 * API calculates data using same V1 contract logic but provides pre-computed results.
 */
export async function getMarketDataFromAPI(network = "mainnet"): Promise<any> {
  const host = getApiHost(network);
  const url = `${host}/justlend/markets`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`API returned error code: ${data.code}`);
    }

    return data.data;
  } catch (error) {
    throw new Error(`Failed to fetch market data from API: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Fetch jToken details from API (includes mining reward data).
 */
async function getJTokenDetailFromAPI(jtokenAddr: string, network = "mainnet"): Promise<any> {
  const host = getApiHost(network);
  const url = `${host}/justlend/markets/jtokenDetails?jtokenAddr=${encodeURIComponent(jtokenAddr)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data.code === 0 ? data.data : null;
  } catch {
    return null;
  }
}

export interface MarketOverview {
  symbol: string;
  underlyingSymbol: string;
  jTokenAddress: string;
  underlyingAddress: string;
  /** Base supply APY from lending interest */
  supplyAPY: string;
  /** Borrow APY */
  borrowAPY: string;
  /** Total deposited value in USD */
  depositedUSD: string;
  /** Total borrowed value in USD */
  borrowedUSD: string;
  /** Collateral factor percentage */
  collateralFactor: string;
  /** Underlying asset increment APY (e.g. sTRX staking yield, wstUSDT staking yield) */
  underlyingIncrementAPY: string;
  /** Mining reward USD per day (from supply mining programs) */
  miningRewardUSD24h: number;
  /** Mining APY calculated from daily rewards and TVL */
  miningAPY: string;
  /** Mining reward breakdown */
  miningRewardDetail: string;
  /** Whether supply is paused */
  mintPaused: boolean;
  /** Whether borrow is paused */
  borrowPaused: boolean;
  /** Total APY = supplyAPY + underlyingIncrementAPY + miningAPY */
  totalSupplyAPY: string;
}

/**
 * Get all market data with mining rewards from API.
 * Combines markets list API with jToken details API to get mining APY.
 * This is the recommended method for comprehensive market overview.
 */
export async function getAllMarketOverview(network = "mainnet"): Promise<MarketOverview[]> {
  const host = getApiHost(network);

  // Fetch markets list
  const marketsResp = await fetch(`${host}/justlend/markets`);
  if (!marketsResp.ok) throw new Error(`Markets API failed: ${marketsResp.status}`);
  const marketsData = await marketsResp.json();
  if (marketsData.code !== 0) throw new Error(`Markets API error: ${marketsData.code}`);

  const jtokenList: any[] = marketsData.data?.jtokenList || [];
  if (jtokenList.length === 0) throw new Error("No markets returned from API");

  // Filter active markets (isValid=1)
  const activeMarkets = jtokenList.filter((m: any) => m.isValid === "1" || m.isValid === 1);

  // Fetch jToken details for each market (includes mining data)
  const detailPromises = activeMarkets.map((m: any) =>
    getJTokenDetailFromAPI(m.jtokenAddress, network),
  );
  const details = await Promise.all(detailPromises);

  return activeMarkets.map((m: any, i: number) => {
    const detail = details[i];

    const depositedUSD = parseFloat(m.depositedUSD || "0");
    const supplyAPY = parseFloat(m.depositedAPY || "0") * 100;
    const borrowAPY = parseFloat(m.borrowedAPY || "0") * 100;
    const underlyingIncrementAPY = parseFloat(m.underlyingIncrementApy || "0") * 100;

    // Mining data from jToken details API
    const farmRewardUSD24h = detail ? parseFloat(detail.farmRewardUSD24h || "0") : 0;
    const farmRewardUsdd = detail ? parseFloat(detail.farmRewardUsddAmount24h || "0") : 0;
    const farmRewardTrx = detail ? parseFloat(detail.farmRewardTrxAmount24h || "0") : 0;

    // Calculate mining APY: (daily_reward_USD * 365) / TVL * 100
    const miningAPY = depositedUSD > 0 ? (farmRewardUSD24h * 365 / depositedUSD) * 100 : 0;

    // Build mining reward detail string
    let miningDetail = "";
    if (farmRewardUsdd > 0 && farmRewardTrx > 0) {
      miningDetail = `${farmRewardUsdd.toFixed(2)} USDD + ${farmRewardTrx.toFixed(2)} TRX per day ($${farmRewardUSD24h.toFixed(2)}/day)`;
    } else if (farmRewardUsdd > 0) {
      miningDetail = `${farmRewardUsdd.toFixed(2)} USDD per day ($${farmRewardUSD24h.toFixed(2)}/day)`;
    } else if (farmRewardTrx > 0) {
      miningDetail = `${farmRewardTrx.toFixed(2)} TRX per day ($${farmRewardUSD24h.toFixed(2)}/day)`;
    } else if (farmRewardUSD24h > 0) {
      miningDetail = `$${farmRewardUSD24h.toFixed(2)}/day in mining rewards`;
    }

    const totalAPY = supplyAPY + underlyingIncrementAPY + miningAPY;

    return {
      symbol: `j${m.collateralSymbol}`,
      underlyingSymbol: m.collateralSymbol,
      jTokenAddress: m.jtokenAddress,
      underlyingAddress: m.collateralAddress,
      supplyAPY: `${supplyAPY.toFixed(4)}%`,
      borrowAPY: `${borrowAPY.toFixed(4)}%`,
      depositedUSD: `$${depositedUSD.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      borrowedUSD: `$${parseFloat(m.borrowedUSD || "0").toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      collateralFactor: `${(parseFloat(m.collateralFactor || "0") / 1e16).toFixed(0)}%`,
      underlyingIncrementAPY: underlyingIncrementAPY > 0 ? `${underlyingIncrementAPY.toFixed(4)}%` : "-",
      miningRewardUSD24h: farmRewardUSD24h,
      miningAPY: miningAPY > 0 ? `${miningAPY.toFixed(4)}%` : "-",
      miningRewardDetail: miningDetail || "-",
      mintPaused: m.mintPaused === "1" || m.mintPaused === 1,
      borrowPaused: m.borrowPaused === "1" || m.borrowPaused === 1,
      totalSupplyAPY: `${totalAPY.toFixed(4)}%`,
    };
  });
}

/**
 * Get all markets with automatic fallback: API first, on-chain contract queries as fallback.
 * This is the recommended entry point for getting market overview data.
 */
export async function getAllMarketsWithFallback(network = "mainnet") {
  const cacheKey = `markets:all:${network}`;
  const cached = cacheGet<{ markets: any[]; source: string; note: string }>(cacheKey);
  if (cached) return cached;

  let result: { markets: any[]; source: string; note: string };
  try {
    const markets = await getAllMarketOverview(network);
    result = {
      markets,
      source: "api" as const,
      note: "totalSupplyAPY = supplyAPY + underlyingIncrementAPY + miningAPY. miningAPY is calculated from daily mining rewards and TVL. underlyingIncrementAPY is the staking yield for wrapped/staked assets (e.g. sTRX ~5.88%, wstUSDT ~1.63%).",
    };
  } catch {
    // API unavailable (e.g. Nile testnet), fallback to on-chain contract queries
    const markets = await getAllMarketData(network);
    result = {
      markets,
      source: "contract" as const,
      note: "Data queried directly from on-chain contracts (API unavailable). Mining rewards and underlying staking APY are not included.",
    };
  }
  cacheSet(cacheKey, result, MARKETS_TTL_MS);
  return result;
}

/**
 * Get market dashboard data from JustLend V1 API.
 * Includes protocol-level statistics like total supply, total borrow, etc.
 *
 * VERSION: V1 - Queries JustLend V1 API
 */
export async function getMarketDashboardFromAPI(network = "mainnet"): Promise<any> {
  const host = getApiHost(network);
  const url = `${host}/justlend/markets/dashboard`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`API returned error code: ${data.code}`);
    }

    return data.data;
  } catch (error) {
    throw new Error(`Failed to fetch dashboard data from API: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get detailed jToken information from JustLend V1 API.
 * @param jtokenAddr - jToken contract address (V1)
 *
 * VERSION: V1 - Queries JustLend V1 API for jToken details
 */
export async function getJTokenDetailsFromAPI(jtokenAddr: string, network = "mainnet"): Promise<any> {
  const host = getApiHost(network);
  const url = `${host}/justlend/markets/jtokenDetails?jtokenAddr=${encodeURIComponent(jtokenAddr)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`API returned error code: ${data.code}`);
    }

    return data.data;
  } catch (error) {
    throw new Error(`Failed to fetch jToken details from API: ${error instanceof Error ? error.message : String(error)}`);
  }
}