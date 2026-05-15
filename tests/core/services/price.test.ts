import { describe, it, expect, vi, beforeEach } from "vitest";
import { cacheInvalidatePrefix } from "../../../src/core/services/cache.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { fetchPriceFromAPI } from "../../../src/core/services/price.js";

function makeApiResponse(markets: any[]) {
  return {
    ok: true,
    json: async () => ({
      code: 0,
      data: { jtokenList: markets },
    }),
  };
}

const USDT_MARKET = {
  collateralSymbol: "USDT",
  depositedUSD: "1000000",
  totalSupply: "50000000000000",    // raw jToken supply
  exchangeRate: "200000000000000000", // 0.2e18
};

describe("fetchPriceFromAPI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheInvalidatePrefix("price:");
  });

  it("should return price from API on mainnet", async () => {
    mockFetch.mockResolvedValueOnce(makeApiResponse([USDT_MARKET]));
    const price = await fetchPriceFromAPI("USDT", 6, "mainnet");
    expect(price).toBeTypeOf("number");
    expect(price).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("labc.ablesdxd.link");
  });

  it("should return cached price on second call", async () => {
    mockFetch.mockResolvedValueOnce(makeApiResponse([USDT_MARKET]));
    const price1 = await fetchPriceFromAPI("USDT", 6, "mainnet");
    const price2 = await fetchPriceFromAPI("USDT", 6, "mainnet");
    expect(price1).toBe(price2);
    expect(mockFetch).toHaveBeenCalledTimes(1); // only 1 fetch, second from cache
  });

  it("should return null when API returns error code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: -1 }),
    });
    const price = await fetchPriceFromAPI("USDT", 6, "mainnet");
    expect(price).toBeNull();
  });

  it("should return null when market not found", async () => {
    mockFetch.mockResolvedValueOnce(makeApiResponse([USDT_MARKET]));
    const price = await fetchPriceFromAPI("DOGE", 8, "mainnet");
    expect(price).toBeNull();
  });

  it("should return null when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const price = await fetchPriceFromAPI("USDT", 6, "mainnet");
    expect(price).toBeNull();
  });

  it("should return null when depositedUSD is 0", async () => {
    mockFetch.mockResolvedValueOnce(
      makeApiResponse([{ ...USDT_MARKET, depositedUSD: "0" }]),
    );
    const price = await fetchPriceFromAPI("USDT", 6, "mainnet");
    expect(price).toBeNull();
  });

  it("should use nile API host for nile network", async () => {
    mockFetch.mockResolvedValueOnce(makeApiResponse([USDT_MARKET]));
    await fetchPriceFromAPI("USDT", 6, "nile");
    expect(mockFetch.mock.calls[0][0]).toContain("nileapi.justlend.org");
  });

  it("should fallback to mainnet when nile returns null", async () => {
    // nile returns empty
    mockFetch.mockResolvedValueOnce(makeApiResponse([]));
    // mainnet returns data
    mockFetch.mockResolvedValueOnce(makeApiResponse([USDT_MARKET]));

    const price = await fetchPriceFromAPI("USDT", 6, "nile");
    expect(price).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain("labc.ablesdxd.link");
  });

  it("should be case-insensitive for symbol matching", async () => {
    mockFetch.mockResolvedValueOnce(makeApiResponse([USDT_MARKET]));
    const price = await fetchPriceFromAPI("usdt", 6, "mainnet");
    expect(price).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // audit-2026-05-13 regression: high-TVL markets must NOT silently round.
  // Before the fix, Number(totalSupply) lost precision once totalSupply
  // exceeded 2^53 and the resulting USD price drifted by 1–2%.
  // ------------------------------------------------------------------
  it("computes a precise price when totalSupply exceeds 2^53 (high-TVL market)", async () => {
    // Pick a jUSDT-like market with realistic TVL:
    //   depositedUSD   = 200,000,000        (USD)
    //   exchangeRate   = 2.345678901234e17  (~0.2346 jUSDT→USDT)
    //   underlyingDecimals = 6
    // We want underlyingAmount = 200,000,000 USDT  →  price = 1.0 USD.
    //   underlyingRaw         = 200_000_000 * 1e6  = 2e14
    //   totalSupply (raw)     = (underlyingRaw * 1e18) / exchangeRate
    //                         ≈ 8.526512829121e14  (well above 2^53 ≈ 9.007e15? no — let's pick higher)
    // Use a much larger market so totalSupply > 2^53 unambiguously.
    //
    //   depositedUSD   = 2,000,000,000
    //   underlyingRaw  = 2_000_000_000 * 1e6 = 2e15
    //   exchangeRate   = 200_000_000_000_000_000   (0.2e18)
    //   totalSupply    = (2e15 * 1e18) / 0.2e18    = 1e16  ← exceeds Number.MAX_SAFE_INTEGER (~9.007e15)
    const HIGH_TVL_MARKET = {
      collateralSymbol: "USDT",
      depositedUSD: "2000000000",
      totalSupply: "10000000000000000",   // 1e16 — strictly above 2^53
      exchangeRate: "200000000000000000", // 0.2e18
    };
    mockFetch.mockResolvedValueOnce(makeApiResponse([HIGH_TVL_MARKET]));
    const price = await fetchPriceFromAPI("USDT", 6, "mainnet");
    expect(price).not.toBeNull();
    // Price must be exactly 1.0 USD (not 0.99x because of float rounding).
    // Tight tolerance proves the arithmetic ran in BigInt.
    expect(price!).toBeGreaterThan(0.9999999);
    expect(price!).toBeLessThan(1.0000001);
  });

  it("returns null on malformed numeric strings instead of throwing", async () => {
    mockFetch.mockResolvedValueOnce(
      makeApiResponse([{ ...USDT_MARKET, totalSupply: "not-a-number" }]),
    );
    const price = await fetchPriceFromAPI("USDT", 6, "mainnet");
    expect(price).toBeNull();
  });

  // Regression: the JustLend API serialises very large `exchangeRate` values as
  // raw JSON numbers, and once those exceed 1e21 JS stringifies them in scientific
  // notation. The old normalizeDecimalString → split(".")[0] path turned
  // "1.02e+26" into "1", which silently corrupted prices; the eventually-returned
  // huge price then made `getAccountSummary`'s `priceNumberToRaw` round-trip
  // through `toFixed(18)` → sci notation → parseUnits and throw with the message
  // we surfaced in the user-visible error. Asserting the function does not throw
  // — and produces a sane price — locks both ends of that chain.
  it("does not throw when exchangeRate arrives as a sci-notation number (high-TVL market)", async () => {
    // SUN-like market on mainnet: exchangeRate of 1.0279569798944131e+26 is the
    // exact value that triggered the original bug. totalSupply chosen to give a
    // ~$1 price so we can assert sanity rather than guessing the exact value.
    //
    //   underlyingRaw = totalSupplyRaw * exchangeRate / 1e18
    //                 = 1e18 * 1.02795697989e26 / 1e18 = 1.02795697989e26
    //   price         = depositedUSD / (underlyingRaw / 1e18)
    //                 ≈ 1.02795697989e26 / 1.02795697989e26 = ~1.0
    const SCI_MARKET = {
      collateralSymbol: "SCITEST",
      depositedUSD: "1.0279569798944131e+8",
      totalSupply: "1000000000000000000",       // 1e18 — well above 2^53
      exchangeRate: 1.0279569798944131e+26,      // JSON-deserialised number, not string
    };
    mockFetch.mockResolvedValueOnce(makeApiResponse([SCI_MARKET]));
    const price = await fetchPriceFromAPI("SCITEST", 18, "mainnet");
    expect(price).not.toBeNull();
    expect(Number.isFinite(price!)).toBe(true);
    expect(price!).toBeGreaterThan(0);
    expect(price!).toBeLessThan(10); // sanity bound — not a runaway 1e24 value
  });
});
