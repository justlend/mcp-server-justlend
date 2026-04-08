/**
 * Shared price fetching utilities for JustLend services.
 */

import { cacheGet, cacheSet } from "./cache.js";

const PRICE_TTL_MS = 30_000; // 30s

/**
 * Fetch asset USD price from JustLend API using: depositedUSD / underlyingAmount.
 *
 * Returns `null` when the price cannot be determined (API failure, market not found, zero values).
 * Callers decide how to handle null (throw, return 0, etc.).
 *
 * On nile testnet, automatically falls back to mainnet API if the nile price is unavailable.
 * Results are cached for 30s per symbol+network.
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

    const resp = await fetch(`${host}/justlend/markets`);
    const data = await resp.json();
    if (data.code !== 0 || !data.data || !data.data.jtokenList) return null;

    const market = data.data.jtokenList.find(
      (m: any) => m.collateralSymbol.toUpperCase() === underlyingSymbol.toUpperCase(),
    );
    if (!market) return null;

    const depositedUSD = Number(market.depositedUSD || 0);
    const totalSupplyRaw = Number(market.totalSupply || 0);
    const exchangeRate = Number(market.exchangeRate || 0);

    if (depositedUSD === 0 || totalSupplyRaw === 0 || exchangeRate === 0) return null;

    const underlyingRaw = (totalSupplyRaw * exchangeRate) / 1e18;
    const underlyingAmount = underlyingRaw / (10 ** underlyingDecimals);
    return depositedUSD / underlyingAmount;
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
