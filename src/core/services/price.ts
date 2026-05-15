/**
 * Shared price fetching utilities for JustLend services.
 */

import { cacheGet, cacheSet } from "./cache.js";
import { fetchWithTimeout } from "./http.js";
import { MANTISSA_18, divRound, normalizeDecimalString, pow10 } from "./bigint-math.js";
import { utils } from "./utils.js";

const PRICE_TTL_MS = 30_000; // 30s

/**
 * Fetch asset USD price from JustLend API using: depositedUSD / underlyingAmount.
 *
 * Returns `null` when the price cannot be determined (API failure, market not found, zero values).
 * Callers decide how to handle null (throw, return 0, etc.).
 *
 * On nile testnet, automatically falls back to mainnet API if the nile price is unavailable.
 * Results are cached for 30s per symbol+network.
 *
 * Internally computes the ratio in BigInt to avoid precision loss on high-TVL markets
 * where raw totalSupply already exceeds 2^53. Final conversion to `number` is only for
 * the API return type (~12 significant digits), which is fine for a USD price.
 */
export async function fetchPriceFromAPI(
  underlyingSymbol: string,
  underlyingDecimals: number,
  network: string,
): Promise<number | null> {
  const cacheKey = `price:${network}:${underlyingSymbol.toUpperCase()}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached !== undefined) return cached;

  const tryFetch = async (targetNetwork: string): Promise<number | null> => {
    const host = targetNetwork === "nile"
      ? "https://nileapi.justlend.org"
      : "https://labc.ablesdxd.link";

    const resp = await fetchWithTimeout(`${host}/justlend/markets`);
    const data = await resp.json();
    if (data.code !== 0 || !data.data || !data.data.jtokenList) return null;

    const market = data.data.jtokenList.find(
      (m: any) => m.collateralSymbol.toUpperCase() === underlyingSymbol.toUpperCase(),
    );
    if (!market) return null;

    const depositedUsdStr = normalizeDecimalString(market.depositedUSD || "0");
    let totalSupplyRaw: bigint;
    let exchangeRate: bigint;
    try {
      totalSupplyRaw = BigInt(normalizeDecimalString(market.totalSupply || "0").split(".")[0] || "0");
      exchangeRate = BigInt(normalizeDecimalString(market.exchangeRate || "0").split(".")[0] || "0");
    } catch {
      return null;
    }

    if (depositedUsdStr === "0" || totalSupplyRaw === 0n || exchangeRate === 0n) return null;

    // underlyingRaw is denominated in `underlyingDecimals` (e.g. 6 for USDT, 18 for ETH).
    const underlyingRaw = (totalSupplyRaw * exchangeRate) / MANTISSA_18;
    if (underlyingRaw === 0n) return null;

    // depositedUSD is a decimal USD string. Scale it by 1e18 so the divide is precise.
    const depositedUsdScaled = utils.parseUnits(depositedUsdStr, 18);

    // price = depositedUSD / (underlyingRaw / 10^decimals)
    //       = (depositedUSD * 10^decimals) / underlyingRaw, scaled by 1e18.
    const numerator = depositedUsdScaled * pow10(underlyingDecimals);
    const priceScaledBy1e18 = divRound(numerator, underlyingRaw);
    if (priceScaledBy1e18 === 0n) return null;

    // Convert back to a JS number for the existing API surface.
    // For USD prices well under 1e15, this fits comfortably in double precision.
    return Number(priceScaledBy1e18) / 1e18;
  };

  // Try current network first
  try {
    const price = await tryFetch(network);
    if (price !== null && price > 0) {
      cacheSet(cacheKey, price, PRICE_TTL_MS);
      return price;
    }
  } catch { /* fall through */ }

  // Nile fallback: try mainnet API
  if (network === "nile") {
    try {
      const mainnetPrice = await tryFetch("mainnet");
      if (mainnetPrice !== null && mainnetPrice > 0) {
        cacheSet(cacheKey, mainnetPrice, PRICE_TTL_MS);
        return mainnetPrice;
      }
    } catch { /* fall through */ }
  }

  return null;
}
