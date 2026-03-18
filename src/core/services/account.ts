import { getTronWeb } from "./clients.js";
import { getJustLendAddresses, getAllJTokens, getJTokenInfo, getApiHost, type JTokenInfo } from "../chains.js";
import { JTOKEN_ABI, COMPTROLLER_ABI, PRICE_ORACLE_ABI, TRC20_ABI } from "../abis.js";

const MANTISSA = 1e18;

export interface AccountPosition {
  jTokenAddress: string;
  symbol: string;
  underlyingSymbol: string;
  /** jToken balance (raw) */
  jTokenBalance: string;
  /** Supply balance in underlying token units */
  supplyBalance: string;
  /** Borrow balance in underlying token units */
  borrowBalance: string;
  /** Whether this market is used as collateral */
  isCollateral: boolean;
  /** Exchange rate at time of query */
  exchangeRate: string;
  /** Underlying price in USD */
  underlyingPriceUSD: string;
  /** Supply value in USD */
  supplyValueUSD: string;
  /** Borrow value in USD */
  borrowValueUSD: string;
}

export interface AccountSummary {
  address: string;
  network: string;
  positions: AccountPosition[];
  /** Total supply value across all markets (USD) */
  totalSupplyUSD: string;
  /** Total borrow value across all markets (USD) */
  totalBorrowUSD: string;
  /** Available liquidity before liquidation (USD) — 0 means at risk */
  liquidityUSD: string;
  /** Shortfall — if > 0, account is undercollateralized and can be liquidated */
  shortfallUSD: string;
  /** Health factor: liquidity ratio. >1 = safe, <1 = liquidatable */
  healthFactor: string;
  /** Net APY estimate (weighted average of supply APY minus borrow APY) */
  collateralMarkets: string[];
  /** Block number at time of query */
  blockNumber: number;
  /** Block timestamp at time of query */
  blockTimestamp: number;
  /** ISO timestamp for human readability */
  lastUpdated: string;
}

function formatUnits(raw: bigint, decimals: number): string {
  const divisor = BigInt(10) ** BigInt(decimals);
  const integer = raw / divisor;
  const remainder = raw % divisor;

  if (remainder === 0n) return integer.toString();

  const fracFull = remainder.toString().padStart(decimals, "0");
  const intNum = Number(integer);
  const maxFrac = intNum > 1e6 ? 2 : intNum > 1 ? 6 : decimals;
  const frac = fracFull.slice(0, maxFrac).replace(/0+$/, "");

  return frac ? `${integer}.${frac}` : integer.toString();
}

// ============================================================================
// PRICE ORACLE FALLBACK HELPERS (Injected to fix Nile testnet $0 collateral bug)
// ============================================================================

async function fetchPriceFromAPI(underlyingSymbol: string, underlyingDecimals: number, network: string): Promise<number> {
  const tryFetch = async (targetNetwork: string) => {
    const host = targetNetwork === "nile" ? "https://nileapi.justlend.org" : "https://labc.ablesdxd.link";
    const resp = await fetch(`${host}/justlend/markets`);
    const data = await resp.json();
    if (data.code !== 0 || !data.data || !data.data.jtokenList) return 0;

    const market = data.data.jtokenList.find((m: any) =>
      m.collateralSymbol.toUpperCase() === underlyingSymbol.toUpperCase()
    );
    if (!market) return 0;

    const depositedUSD = Number(market.depositedUSD || 0);
    const totalSupplyRaw = Number(market.totalSupply || 0);
    const exchangeRate = Number(market.exchangeRate || 0);

    if (depositedUSD === 0 || totalSupplyRaw === 0 || exchangeRate === 0) return 0;
    const underlyingRaw = (totalSupplyRaw * exchangeRate) / 1e18;
    const underlyingAmount = underlyingRaw / (10 ** underlyingDecimals);
    return depositedUSD / underlyingAmount;
  };

  try {
    const price = await tryFetch(network);
    if (price > 0) return price;
  } catch (err) { }

  if (network === "nile") {
    try {
      const mainnetPrice = await tryFetch("mainnet");
      if (mainnetPrice > 0) return mainnetPrice;
    } catch (err) { }
  }
  return 0;
}

async function getAssetPriceUSD(tronWeb: any, oracleAddress: string, assetAddress: string, assetInfo: JTokenInfo, network: string): Promise<number> {
  let priceRaw = 0n;
  let priceUSD = 0;

  try {
    const oracle = tronWeb.contract(PRICE_ORACLE_ABI, oracleAddress);
    priceRaw = BigInt(await oracle.methods.getUnderlyingPrice(assetAddress).call());
  } catch (err) { }

  // 💡 Nile 测试网或者是0，强制走 API 兜底
  if (priceRaw > 0n && network === "mainnet") {
    const decimals = assetInfo.underlyingDecimals;
    priceUSD = Number(priceRaw) / (10 ** (36 - decimals));
  } else {
    priceUSD = await fetchPriceFromAPI(assetInfo.underlyingSymbol, assetInfo.underlyingDecimals, network);
  }
  return priceUSD;
}

// ============================================================================
// ACCOUNT SUMMARY
// ============================================================================

/**
 * Get a user's full position across all JustLend markets.
 */
export async function getAccountSummary(userAddress: string, network = "mainnet"): Promise<AccountSummary> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);
  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const jTokens = getAllJTokens(network);

  // 💡 核心修复 1：获取资产并从 Hex 转换回 Base58
  const assetsInRaw: string[] = await comptroller.methods.getAssetsIn(userAddress).call();
  const assetsIn = assetsInRaw.map(a => tronWeb.address.fromHex(a));
  const collateralSet = new Set(assetsIn.map((a: string) => a.toLowerCase()));

  // Get account liquidity
  const [error, liquidity, shortfall] = await comptroller.methods.getAccountLiquidity(userAddress).call()
    .then((r: any) => [BigInt(r.err || r[0]), BigInt(r.liquidity || r[1]), BigInt(r.shortfall || r[2])]);

  // 💡 核心修复 2：动态获取真正的 Oracle 地址
  let realOracleAddress = addresses.priceOracle;
  try {
    const oracleHex = await comptroller.methods.oracle().call();
    realOracleAddress = tronWeb.address.fromHex(oracleHex);
  } catch (e) { }

  // Fetch position for each market in batches to avoid TronGrid rate limiting (429).
  const BATCH_SIZE = 3;
  const BATCH_DELAY_MS = 1000;

  async function fetchPosition(info: JTokenInfo): Promise<AccountPosition | null> {
    try {
      const jToken = tronWeb.contract(JTOKEN_ABI, info.address);
      const snapshot = await jToken.methods.getAccountSnapshot(userAddress).call();

      const jTokenBalance = BigInt(snapshot[1] ?? snapshot.jTokenBalance ?? 0);
      const borrowBalance = BigInt(snapshot[2] ?? snapshot.borrowBalance ?? 0);
      const exchangeRateMantissa = BigInt(snapshot[3] ?? snapshot.exchangeRateMantissa ?? 0);

      // If no position, skip
      if (jTokenBalance === 0n && borrowBalance === 0n) return null;

      // Supply balance = jTokenBalance * exchangeRate / 1e18
      const supplyBalanceRaw = jTokenBalance * exchangeRateMantissa / BigInt(1e18);

      // 💡 核心修复 3：使用兜底函数精准获取美元单价
      const priceUSD = await getAssetPriceUSD(tronWeb, realOracleAddress, info.address, info, network);

      const supplyBalanceHuman = Number(supplyBalanceRaw) / 10 ** info.underlyingDecimals;
      const borrowBalanceHuman = Number(borrowBalance) / 10 ** info.underlyingDecimals;

      const supplyValueUSD = supplyBalanceHuman * priceUSD;
      const borrowValueUSD = borrowBalanceHuman * priceUSD;

      return {
        jTokenAddress: info.address,
        symbol: info.symbol,
        underlyingSymbol: info.underlyingSymbol,
        jTokenBalance: formatUnits(jTokenBalance, info.decimals),
        supplyBalance: formatUnits(supplyBalanceRaw, info.underlyingDecimals),
        borrowBalance: formatUnits(borrowBalance, info.underlyingDecimals),
        isCollateral: collateralSet.has(info.address.toLowerCase()),
        exchangeRate: (Number(exchangeRateMantissa) / 1e18).toFixed(10),
        underlyingPriceUSD: priceUSD.toFixed(6),
        supplyValueUSD: supplyValueUSD.toFixed(2),
        borrowValueUSD: borrowValueUSD.toFixed(2),
      };
    } catch {
      return null;
    }
  }

  const allResults: (AccountPosition | null)[] = [];
  for (let i = 0; i < jTokens.length; i += BATCH_SIZE) {
    const batch = jTokens.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(fetchPosition));
    allResults.push(...batchResults);
    if (i + BATCH_SIZE < jTokens.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  const positions = allResults.filter((p): p is AccountPosition => p !== null);

  const totalSupplyUSD = positions.reduce((sum, p) => sum + parseFloat(p.supplyValueUSD), 0);
  const totalBorrowUSD = positions.reduce((sum, p) => sum + parseFloat(p.borrowValueUSD), 0);

  const liquidityUSD = Number(liquidity) / MANTISSA;
  const shortfallUSD = Number(shortfall) / MANTISSA;

  let healthFactor = "∞";
  if (totalBorrowUSD > 0) {
    if (shortfallUSD > 0) {
      // 出现资不抵债缺口：(总借款 - 缺口) / 总借款
      healthFactor = ((totalBorrowUSD - shortfallUSD) / totalBorrowUSD).toFixed(4);
    } else {
      // 安全状态：(可用流动性 + 总借款) / 总借款
      healthFactor = ((liquidityUSD + totalBorrowUSD) / totalBorrowUSD).toFixed(4);
    }
  }

  const currentBlock = await tronWeb.trx.getCurrentBlock();
  const blockNumber = currentBlock.block_header.raw_data.number;
  const blockTimestamp = currentBlock.block_header.raw_data.timestamp;

  return {
    address: userAddress,
    network,
    positions,
    totalSupplyUSD: totalSupplyUSD.toFixed(2),
    totalBorrowUSD: totalBorrowUSD.toFixed(2),
    liquidityUSD: liquidityUSD.toFixed(2),
    shortfallUSD: shortfallUSD.toFixed(2),
    healthFactor,
    collateralMarkets: assetsIn, // 返回真实的 base58 抵押池地址列表
    blockNumber,
    blockTimestamp,
    lastUpdated: new Date(blockTimestamp).toISOString(),
  };
}

/**
 * Check if user has approved enough underlying tokens for a jToken market.
 */
export async function checkAllowance(
  userAddress: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ allowance: string; allowanceRaw: string; allowanceUnit: string; decimals: number; hasApproval: boolean; allowanceNote: string; underlyingAddress: string; jTokenAddress: string }> {
  const tronWeb = getTronWeb(network);
  const info = getJTokenInfo(jTokenSymbol, network);
  if (!info) throw new Error(`Unknown jToken: ${jTokenSymbol}`);
  if (!info.underlying) throw new Error(`${jTokenSymbol} is native TRX — no approval needed`);

  const token = tronWeb.contract(TRC20_ABI, info.underlying);
  const raw = await token.methods.allowance(userAddress, info.address).call();
  const allowance = BigInt(raw);
  const formatted = formatUnits(allowance, info.underlyingDecimals);

  return {
    allowance: formatted,
    allowanceRaw: allowance.toString(),
    allowanceUnit: info.underlyingSymbol,
    decimals: info.underlyingDecimals,
    hasApproval: allowance > 0n,
    allowanceNote: `Allowance is ${formatted} ${info.underlyingSymbol} (human-readable, decimals already applied). Compare directly with the amount you want to supply/repay.`,
    underlyingAddress: info.underlying,
    jTokenAddress: info.address,
  };
}

/**
 * Get TRX balance for an address as a formatted string (TRX units).
 */
export async function getAccountTRXBalance(address: string, network = "mainnet"): Promise<string> {
  const tronWeb = getTronWeb(network);
  const balance = await tronWeb.trx.getBalance(address);
  return (Number(balance) / 1e6).toFixed(6);
}

/**
 * Get TRC20 token balance for an address.
 */
export async function getTokenBalance(address: string, tokenAddress: string, network = "mainnet"): Promise<{ balance: string; symbol: string; decimals: number }> {
  const tronWeb = getTronWeb(network);
  const token = tronWeb.contract(TRC20_ABI, tokenAddress);
  const [raw, symbol, decimals] = await Promise.all([
    token.methods.balanceOf(address).call(),
    token.methods.symbol().call(),
    token.methods.decimals().call(),
  ]);
  const dec = Number(decimals);
  return {
    balance: formatUnits(BigInt(raw), dec),
    symbol: String(symbol),
    decimals: dec,
  };
}

/**
 * Get user account data from JustLend API (more stable and comprehensive).
 */
export async function getAccountDataFromAPI(address: string, network = "mainnet"): Promise<any> {
  const host = getApiHost(network);
  const url = `${host}/justlend/account?addr=${encodeURIComponent(address)}`;

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
    throw new Error(`Failed to fetch account data from API: ${error instanceof Error ? error.message : String(error)}`);
  }
}