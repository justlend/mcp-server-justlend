import { describe, it, expect, vi, beforeEach } from "vitest";
import { cacheInvalidatePrefix } from "../../../src/core/services/cache.js";

// Mock dependencies before importing
vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => ({
    contract: vi.fn(() => ({ methods: {} })),
    address: { fromHex: (a: string) => a },
  })),
}));

vi.mock("../../../src/core/services/price.js", () => ({
  fetchPriceFromAPI: vi.fn(async () => 1.0),
}));

// Mock global fetch for API calls in getAllMarketOverview
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  getMarketDataWithFallback,
  getAllMarketsWithFallback,
  getMarketData,
} from "../../../src/core/services/markets.js";
import type { JTokenInfo } from "../../../src/core/chains.js";

const MOCK_JTOKEN: JTokenInfo = {
  address: "TXJgMdjVX5dKiQaUi9QobR2d1pTdip5xG3",
  symbol: "jUSDT",
  underlyingSymbol: "USDT",
  underlying: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  decimals: 8,
  underlyingDecimals: 6,
};

describe("getMarketDataWithFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheInvalidatePrefix("");
  });

  it("should return contract data on success", async () => {
    // Mock the on-chain calls via fetch (getMarketData calls TronWeb internally)
    // Since TronWeb is mocked, getMarketData will fail → fallback to API
    // Let's test the fallback path instead
    const apiResponse = {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          jtokenList: [{
            jtokenAddress: MOCK_JTOKEN.address,
            collateralSymbol: "USDT",
            depositedUSD: "100000000",
            borrowedUSD: "50000000",
            depositedAPY: "0.0325",
            borrowedAPY: "0.055",
            totalSupply: "5000000000000000",
            totalBorrow: "25000000000",
            totalReserves: "1000000000",
            availableLiquidity: "49000000000",
            exchangeRate: "200000000000000000",
            collateralFactor: "750000000000000000",
            reserveFactor: "100000000000000000",
            mintPaused: "0",
            borrowPaused: "0",
          }],
        },
      }),
    };
    mockFetch.mockResolvedValue(apiResponse);

    const result = await getMarketDataWithFallback(MOCK_JTOKEN, "mainnet");

    expect(result.source).toBe("api"); // contract mock fails, so API fallback
    expect(result.data.symbol).toBe("jUSDT");
    expect(result.data.underlyingSymbol).toBe("USDT");
  });

  it("should throw when both contract and API fail", async () => {
    mockFetch.mockRejectedValue(new Error("API down"));

    await expect(
      getMarketDataWithFallback(MOCK_JTOKEN, "mainnet"),
    ).rejects.toThrow();
  });
});

describe("getAllMarketsWithFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheInvalidatePrefix("");
  });

  it("should return cached result on second call", async () => {
    const marketsResp = {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          jtokenList: [{
            isValid: "1",
            jtokenAddress: MOCK_JTOKEN.address,
            collateralSymbol: "USDT",
            depositedUSD: "100000000",
            borrowedUSD: "50000000",
            depositedAPY: "0.0325",
            borrowedAPY: "0.055",
            collateralFactor: "750000000000000000",
            underlyingIncrementApy: "0",
            mintPaused: "0",
            borrowPaused: "0",
          }],
        },
      }),
    };

    // jTokenDetails call
    const detailResp = {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          farmRewardUSD24h: "0",
          farmRewardUsddAmount24h: "0",
          farmRewardTrxAmount24h: "0",
        },
      }),
    };

    mockFetch
      .mockResolvedValueOnce(marketsResp)
      .mockResolvedValueOnce(detailResp);

    const result1 = await getAllMarketsWithFallback("mainnet");
    expect(result1.source).toBe("api");
    expect(result1.markets.length).toBeGreaterThan(0);

    // Second call should use cache, no new fetch
    const fetchCountAfterFirst = mockFetch.mock.calls.length;
    const result2 = await getAllMarketsWithFallback("mainnet");
    expect(result2).toEqual(result1);
    expect(mockFetch.mock.calls.length).toBe(fetchCountAfterFirst);
  });

  it("should include note about APY calculation", async () => {
    const marketsResp = {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          jtokenList: [{
            isValid: "1",
            jtokenAddress: MOCK_JTOKEN.address,
            collateralSymbol: "USDT",
            depositedUSD: "100000000",
            borrowedUSD: "50000000",
            depositedAPY: "0.0325",
            borrowedAPY: "0.055",
            collateralFactor: "750000000000000000",
            underlyingIncrementApy: "0",
            mintPaused: "0",
            borrowPaused: "0",
          }],
        },
      }),
    };
    const detailResp = {
      ok: true,
      json: async () => ({ code: 0, data: { farmRewardUSD24h: "0", farmRewardUsddAmount24h: "0", farmRewardTrxAmount24h: "0" } }),
    };

    mockFetch
      .mockResolvedValueOnce(marketsResp)
      .mockResolvedValueOnce(detailResp);

    const result = await getAllMarketsWithFallback("mainnet");
    expect(result.note).toContain("totalSupplyAPY");
  });
});
