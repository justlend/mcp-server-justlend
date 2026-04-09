import { getTronWeb } from "./clients.js";
import { getJustLendAddresses, getAllJTokens, getJTokenInfo, getApiHost, type JTokenInfo } from "../chains.js";
import { JTOKEN_ABI, COMPTROLLER_ABI, PRICE_ORACLE_ABI, TRC20_ABI } from "../abis.js";
import { fetchPriceFromAPI } from "./price.js";
import { multicall } from "./contracts.js";
import { MULTICALL3_BALANCE_ABI } from "./multicall-abi.js";
import { fetchWithTimeout, promiseWithTimeout } from "./http.js";
import { utils } from "./utils.js";
import {
  MANTISSA_18, USD_PRICE_SCALE, USD_VALUE_SCALE,
  divRound, formatScaled, formatDisplayUnits,
  formatUsdCents, formatRatio, priceNumberToRaw, amountToUsdCents,
} from "./bigint-math.js";

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
  const assetsInRaw: string[] = await promiseWithTimeout(
    comptroller.methods.getAssetsIn(userAddress).call(),
    undefined,
    "Timed out while loading collateral markets",
  );
  const assetsIn = assetsInRaw.map(a => tronWeb.address.fromHex(a));
  const collateralSet = new Set(assetsIn.map((a: string) => a.toLowerCase()));

  // Get account liquidity
  const [error, liquidity, shortfall] = await promiseWithTimeout(
    comptroller.methods.getAccountLiquidity(userAddress).call(),
    undefined,
    "Timed out while loading account liquidity",
  )
    .then((r: any) => [BigInt(r.err || r[0]), BigInt(r.liquidity || r[1]), BigInt(r.shortfall || r[2])]);

  // 💡 核心修复 2：动态获取真正的 Oracle 地址
  let realOracleAddress = addresses.priceOracle;
  try {
    const oracleHex = await promiseWithTimeout(
      comptroller.methods.oracle().call() as Promise<string>,
      undefined,
      "Timed out while loading oracle address",
    );
    realOracleAddress = tronWeb.address.fromHex(oracleHex);
  } catch (e) { }

  // Batch-fetch all snapshots + prices via Multicall3 (single RPC call).
  // Falls back to sequential calls if multicall address is not configured (e.g. Nile testnet).
  const multicallAddress = addresses.multicall3;

  // Build call array: snapshot calls first, then price calls
  const snapshotCalls = jTokens.map((info) => ({
    address: info.address,
    functionName: "getAccountSnapshot",
    args: [userAddress],
    abi: JTOKEN_ABI,
    allowFailure: true,
  }));

  const priceCalls = jTokens.map((info) => ({
    address: realOracleAddress,
    functionName: "getUnderlyingPrice",
    args: [info.address],
    abi: PRICE_ORACLE_ABI,
    allowFailure: true,
  }));

  const allCalls = [...snapshotCalls, ...priceCalls];
  const results = await multicall({ calls: allCalls, multicallAddress }, network);

  const snapshotResults = results.slice(0, jTokens.length);
  const priceResults = results.slice(jTokens.length);

  // Process results into positions
  const positions: AccountPosition[] = [];
  for (let i = 0; i < jTokens.length; i++) {
    const info = jTokens[i];
    const snapshotRes = snapshotResults[i];

    if (!snapshotRes.success) continue;

    const snapshot = snapshotRes.result;
    const jTokenBalance = BigInt(snapshot[1] ?? snapshot.jTokenBalance ?? 0);
    const borrowBalance = BigInt(snapshot[2] ?? snapshot.borrowBalance ?? 0);
    const exchangeRateMantissa = BigInt(snapshot[3] ?? snapshot.exchangeRateMantissa ?? 0);

    if (jTokenBalance === 0n && borrowBalance === 0n) continue;

    const supplyBalanceRaw = jTokenBalance * exchangeRateMantissa / BigInt(1e18);

    // Get price: try multicall result first, then API fallback
    let priceRaw = 0n;
    const priceRes = priceResults[i];
    if (priceRes.success) {
      const oraclePriceRaw = BigInt(priceRes.result?.toString() ?? "0");
      if (oraclePriceRaw > 0n && network === "mainnet") {
        priceRaw = oraclePriceRaw;
      }
    }
    if (priceRaw === 0n) {
      const fallbackPrice = await fetchPriceFromAPI(info.underlyingSymbol, info.underlyingDecimals, network) ?? 0;
      priceRaw = priceNumberToRaw(fallbackPrice, info.underlyingDecimals);
    }

    const supplyValueCents = amountToUsdCents(supplyBalanceRaw, priceRaw);
    const borrowValueCents = amountToUsdCents(borrowBalance, priceRaw);

    positions.push({
      jTokenAddress: info.address,
      symbol: info.symbol,
      underlyingSymbol: info.underlyingSymbol,
      jTokenBalance: formatDisplayUnits(jTokenBalance, info.decimals),
      supplyBalance: formatDisplayUnits(supplyBalanceRaw, info.underlyingDecimals),
      borrowBalance: formatDisplayUnits(borrowBalance, info.underlyingDecimals),
      isCollateral: collateralSet.has(info.address.toLowerCase()),
      exchangeRate: formatScaled(exchangeRateMantissa, 18, 10),
      underlyingPriceUSD: formatScaled(priceRaw, USD_PRICE_SCALE - info.underlyingDecimals, 6),
      supplyValueUSD: formatUsdCents(supplyValueCents),
      borrowValueUSD: formatUsdCents(borrowValueCents),
    });
  }

  const totalSupplyCents = positions.reduce((sum, p) => sum + utils.parseUnits(p.supplyValueUSD, 2), 0n);
  const totalBorrowCents = positions.reduce((sum, p) => sum + utils.parseUnits(p.borrowValueUSD, 2), 0n);

  const liquidityCents = divRound(liquidity * 100n, MANTISSA_18);
  const shortfallCents = divRound(shortfall * 100n, MANTISSA_18);

  let healthFactor = "∞";
  if (totalBorrowCents > 0n) {
    if (shortfallCents > 0n) {
      const adjustedBorrowCents = totalBorrowCents > shortfallCents ? totalBorrowCents - shortfallCents : 0n;
      healthFactor = formatRatio(adjustedBorrowCents, totalBorrowCents, 4);
    } else {
      healthFactor = formatRatio(liquidityCents + totalBorrowCents, totalBorrowCents, 4);
    }
  }

  const currentBlock = await tronWeb.trx.getCurrentBlock();
  const blockNumber = currentBlock.block_header.raw_data.number;
  const blockTimestamp = currentBlock.block_header.raw_data.timestamp;

  return {
    address: userAddress,
    network,
    positions,
    totalSupplyUSD: formatUsdCents(totalSupplyCents),
    totalBorrowUSD: formatUsdCents(totalBorrowCents),
    liquidityUSD: formatUsdCents(liquidityCents),
    shortfallUSD: formatUsdCents(shortfallCents),
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
  const raw = await promiseWithTimeout(
    token.methods.allowance(userAddress, info.address).call() as Promise<string>,
    undefined,
    "Timed out while loading token allowance",
  );
  const allowance = BigInt(raw);
  const formatted = formatDisplayUnits(allowance, info.underlyingDecimals);

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
  const balance = await promiseWithTimeout(
    tronWeb.trx.getBalance(address),
    undefined,
    "Timed out while loading TRX balance",
  );
  return formatDisplayUnits(BigInt(balance), 6);
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
    balance: formatDisplayUnits(BigInt(raw), dec),
    symbol: String(symbol),
    decimals: dec,
  };
}

export interface TokenBalance {
  symbol: string;
  tokenAddress: string;
  balance: string;
  decimals: number;
  error?: boolean;
}

/**
 * Batch-fetch TRC20 token balances for a single wallet using Multicall3's
 * walletTokensBalance method (one RPC call for all tokens).
 * Falls back to parallel balanceOf calls when no multicall3 address is configured.
 */
export async function getWalletTokensBalance(
  walletAddress: string,
  tokens: Array<{ address: string; symbol: string; decimals: number }>,
  network = "mainnet",
): Promise<TokenBalance[]> {
  if (tokens.length === 0) return [];

  const addresses = getJustLendAddresses(network);
  const multicall3Address = addresses.multicall3;

  const tronWeb = getTronWeb(network);

  if (multicall3Address) {
    try {
      const contract = tronWeb.contract(MULTICALL3_BALANCE_ABI, multicall3Address);
      const tokenAddresses = tokens.map((t) => t.address);
      const result = await promiseWithTimeout<any>(
        (contract as any).walletTokensBalance(tokenAddresses, walletAddress).call(),
        undefined,
        "Timed out while loading wallet token balances",
      );

      // Result is [balances: uint256[], errors: bool[]]
      const rawBalances: bigint[] = Array.isArray(result[0]) ? result[0] : result.balances;
      const errors: boolean[] = Array.isArray(result[1]) ? result[1] : result.errors;

      return tokens.map((token, i) => ({
        symbol: token.symbol,
        tokenAddress: token.address,
        balance: errors[i] ? "0" : formatDisplayUnits(BigInt(rawBalances[i] ?? 0), token.decimals),
        decimals: token.decimals,
        error: errors[i] ? true : undefined,
      }));
    } catch {
      // fall through to sequential fallback
    }
  }

  // Fallback: parallel balanceOf calls
  const results = await Promise.allSettled(
    tokens.map((token) => {
      const contract = tronWeb.contract(TRC20_ABI, token.address);
      return contract.methods.balanceOf(walletAddress).call();
    }),
  );

  return tokens.map((token, i) => {
    const r = results[i];
    const raw = r.status === "fulfilled" ? BigInt(r.value ?? 0) : 0n;
    return {
      symbol: token.symbol,
      tokenAddress: token.address,
      balance: formatDisplayUnits(raw, token.decimals),
      decimals: token.decimals,
      error: r.status === "rejected" || undefined,
    };
  });
}

/**
 * Get user account data from JustLend API (more stable and comprehensive).
 */
export async function getAccountDataFromAPI(address: string, network = "mainnet"): Promise<any> {
  const host = getApiHost(network);
  const url = `${host}/justlend/account?addr=${encodeURIComponent(address)}`;

  try {
    const response = await fetchWithTimeout(url);
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
