import { getTronWeb } from "./clients.js";
import { getJustLendAddresses, getAllJTokens, getJTokenInfo, type JTokenInfo } from "../chains.js";
import { JTOKEN_ABI, COMPTROLLER_ABI, PRICE_ORACLE_ABI, TRC20_ABI } from "../abis.js";

const MANTISSA = 1e18;

// JustLend API endpoints
const JUSTLEND_API_ENDPOINTS = {
  mainnet: "https://labc.ablesdxd.link",
  nile: "https://nileapi.justlend.org",
};

function getApiHost(network: string): string {
  const n = network.toLowerCase();
  if (n === "mainnet" || n === "tron" || n === "trx") return JUSTLEND_API_ENDPOINTS.mainnet;
  if (n === "nile" || n === "testnet") return JUSTLEND_API_ENDPOINTS.nile;
  return JUSTLEND_API_ENDPOINTS.mainnet;
}

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
}

function formatUnits(raw: bigint, decimals: number): string {
  const divisor = BigInt(10) ** BigInt(decimals);
  const integer = raw / divisor;
  const remainder = raw % divisor;

  if (remainder === 0n) return integer.toString();

  const fracFull = remainder.toString().padStart(decimals, "0");
  // integer part is safe to cast to Number (no fractional digits)
  const intNum = Number(integer);
  const maxFrac = intNum > 1e6 ? 2 : intNum > 1 ? 6 : decimals;
  const frac = fracFull.slice(0, maxFrac).replace(/0+$/, "");

  return frac ? `${integer}.${frac}` : integer.toString();
}

/**
 * Get a user's full position across all JustLend markets.
 */
export async function getAccountSummary(userAddress: string, network = "mainnet"): Promise<AccountSummary> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);
  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const jTokens = getAllJTokens(network);

  // Get collateral markets for user
  const assetsIn: string[] = await comptroller.methods.getAssetsIn(userAddress).call();
  const collateralSet = new Set(assetsIn.map((a: string) => a.toLowerCase()));

  // Get account liquidity
  const [error, liquidity, shortfall] = await comptroller.methods.getAccountLiquidity(userAddress).call()
    .then((r: any) => [BigInt(r.err || r[0]), BigInt(r.liquidity || r[1]), BigInt(r.shortfall || r[2])]);

  // Get oracle for prices
  let oracle: any;
  try {
    oracle = tronWeb.contract(PRICE_ORACLE_ABI, addresses.priceOracle);
  } catch {
    oracle = null;
  }

  // Fetch position for each market
  const positionPromises = jTokens.map(async (info): Promise<AccountPosition | null> => {
    try {
      const jToken = tronWeb.contract(JTOKEN_ABI, info.address);
      const snapshot = await jToken.methods.getAccountSnapshot(userAddress).call();

      const jTokenBalance = BigInt(snapshot[1] ?? snapshot.jTokenBalance ?? 0);
      const borrowBalance = BigInt(snapshot[2] ?? snapshot.borrowBalance ?? 0);
      const exchangeRateMantissa = BigInt(snapshot[3] ?? snapshot.exchangeRateMantissa ?? 0);

      // If no position, skip
      if (jTokenBalance === 0n && borrowBalance === 0n) return null;

      // Supply balance = jTokenBalance * exchangeRate / 1e18
      const supplyBalance = jTokenBalance * exchangeRateMantissa / BigInt(1e18);

      // Get price
      let priceRaw = 0n;
      if (oracle) {
        try {
          priceRaw = BigInt(await oracle.methods.getUnderlyingPrice(info.address).call());
        } catch { /* ignore */ }
      }
      const priceScale = 10 ** (36 - info.underlyingDecimals);
      const priceUSD = Number(priceRaw) / priceScale;

      const supplyValueUSD = Number(supplyBalance) / 10 ** info.underlyingDecimals * priceUSD;
      const borrowValueUSD = Number(borrowBalance) / 10 ** info.underlyingDecimals * priceUSD;

      return {
        jTokenAddress: info.address,
        symbol: info.symbol,
        underlyingSymbol: info.underlyingSymbol,
        jTokenBalance: formatUnits(jTokenBalance, info.decimals),
        supplyBalance: formatUnits(supplyBalance, info.underlyingDecimals),
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
  });

  const results = await Promise.all(positionPromises);
  const positions = results.filter((p): p is AccountPosition => p !== null);

  const totalSupplyUSD = positions.reduce((sum, p) => sum + parseFloat(p.supplyValueUSD), 0);
  const totalBorrowUSD = positions.reduce((sum, p) => sum + parseFloat(p.borrowValueUSD), 0);

  // Health factor = totalCollateralValue / totalBorrowValue
  // More precisely: (totalCollateral * weighted avg collateralFactor) / totalBorrow
  // We use liquidity/shortfall from Comptroller as the definitive source
  const liquidityUSD = Number(liquidity) / MANTISSA;
  const shortfallUSD = Number(shortfall) / MANTISSA;

  let healthFactor = "∞";
  if (totalBorrowUSD > 0) {
    if (shortfallUSD > 0) {
      healthFactor = (totalSupplyUSD / (totalSupplyUSD + shortfallUSD)).toFixed(4);
    } else {
      // Safe: health > 1
      healthFactor = ((totalSupplyUSD + liquidityUSD) / totalSupplyUSD).toFixed(4);
    }
  }

  return {
    address: userAddress,
    network,
    positions,
    totalSupplyUSD: totalSupplyUSD.toFixed(2),
    totalBorrowUSD: totalBorrowUSD.toFixed(2),
    liquidityUSD: liquidityUSD.toFixed(2),
    shortfallUSD: shortfallUSD.toFixed(2),
    healthFactor,
    collateralMarkets: assetsIn,
  };
}

/**
 * Check if user has approved enough underlying tokens for a jToken market.
 */
export async function checkAllowance(
  userAddress: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ allowance: string; hasApproval: boolean; underlyingAddress: string; jTokenAddress: string }> {
  const tronWeb = getTronWeb(network);
  const info = getJTokenInfo(jTokenSymbol, network);
  if (!info) throw new Error(`Unknown jToken: ${jTokenSymbol}`);
  if (!info.underlying) throw new Error(`${jTokenSymbol} is native TRX — no approval needed`);

  const token = tronWeb.contract(TRC20_ABI, info.underlying);
  const raw = await token.methods.allowance(userAddress, info.address).call();
  const allowance = BigInt(raw);

  return {
    allowance: formatUnits(allowance, info.underlyingDecimals),
    hasApproval: allowance > 0n,
    underlyingAddress: info.underlying,
    jTokenAddress: info.address,
  };
}

/**
 * Get TRX balance for an address as a formatted string (TRX units).
 * For a richer return value use getTRXBalance from balance.ts.
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
 * Returns user's lending positions, balances, mining rewards, etc.
 */
export async function getAccountDataFromAPI(address: string, network = "mainnet"): Promise<any> {
  const host = getApiHost(network);
  const url = `${host}/justlend/account?addr=${address}`;

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
