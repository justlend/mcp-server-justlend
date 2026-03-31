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
});
