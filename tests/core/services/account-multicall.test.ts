/**
 * Unit tests for getAccountSummary multicall logic.
 * Mocks TronWeb, multicall, and price API to test orchestration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Comptroller mock methods
const mockGetAssetsIn = vi.fn(async () => []);
const mockGetAccountLiquidity = vi.fn(async () => ({ 0: 0, 1: "1000000000000000000", 2: 0, err: 0, liquidity: "1000000000000000000", shortfall: 0 }));
const mockOracle = vi.fn(async () => "414f...oracle");
const mockGetAllMarkets = vi.fn(async () => []);

const mockComptrollerMethods = {
  getAssetsIn: vi.fn(() => ({ call: mockGetAssetsIn })),
  getAccountLiquidity: vi.fn(() => ({ call: mockGetAccountLiquidity })),
  oracle: vi.fn(() => ({ call: mockOracle })),
  getAllMarkets: vi.fn(() => ({ call: mockGetAllMarkets })),
};

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => ({
    contract: vi.fn(() => ({ methods: mockComptrollerMethods })),
    address: { fromHex: (a: string) => a },
    trx: {
      getCurrentBlock: vi.fn(async () => ({
        block_header: { raw_data: { number: 12345678, timestamp: 1700000000000 } },
      })),
    },
  })),
}));

// Mock chains to return a small set of jTokens
vi.mock("../../../src/core/chains.js", async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    getAllJTokens: vi.fn(() => [
      {
        address: "TjToken1",
        symbol: "jUSDT",
        underlyingSymbol: "USDT",
        underlying: "TUnderlying1",
        decimals: 8,
        underlyingDecimals: 6,
      },
      {
        address: "TjToken2",
        symbol: "jTRX",
        underlyingSymbol: "TRX",
        underlying: "",
        decimals: 8,
        underlyingDecimals: 6,
      },
    ]),
    getJustLendAddresses: vi.fn(() => ({
      comptroller: "TComptroller",
      priceOracle: "TOracle",
    })),
  };
});

// Mock multicall
const mockMulticall = vi.fn();
vi.mock("../../../src/core/services/contracts.js", () => ({
  multicall: (...args: any[]) => mockMulticall(...args),
}));

// Mock price API
const mockFetchPriceFromAPI = vi.fn();
vi.mock("../../../src/core/services/price.js", () => ({
  fetchPriceFromAPI: (...args: any[]) => mockFetchPriceFromAPI(...args),
}));

import { getAccountSummary } from "../../../src/core/services/account.js";

describe("getAccountSummary (multicall)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssetsIn.mockResolvedValue([]);
    mockGetAccountLiquidity.mockResolvedValue({ 0: 0, 1: "0", 2: "0", err: 0, liquidity: "0", shortfall: "0" });
    mockFetchPriceFromAPI.mockResolvedValue(1.0);
  });

  it("should return empty positions when no balances", async () => {
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
    ]);

    const summary = await getAccountSummary("TTestUser123456789012345678901234", "mainnet");
    expect(summary.positions).toHaveLength(0);
    expect(summary.totalSupplyUSD).toBe("0.00");
    expect(summary.totalBorrowUSD).toBe("0.00");
    expect(summary.healthFactor).toBe("∞");
  });

  it("should build position from multicall snapshot", async () => {
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: { 0: 0, 1: "50000000000", 2: 0, 3: "200000000000000000" } },
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
    ]);
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: "1000000000000000000000000000000" },
    ]);

    const summary = await getAccountSummary("TTestUser123456789012345678901234", "mainnet");
    expect(summary.positions).toHaveLength(1);
    expect(summary.positions[0].symbol).toBe("jUSDT");
    expect(parseFloat(summary.positions[0].supplyValueUSD)).toBeGreaterThan(0);
  });

  it("should skip markets where snapshot call failed", async () => {
    mockMulticall.mockResolvedValueOnce([
      { success: false, error: "call failed" },
      { success: true, result: { 0: 0, 1: "100000000000", 2: 0, 3: "200000000000000000" } },
    ]);
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: "100000000000000000000000000000" },
    ]);

    const summary = await getAccountSummary("TTestUser123456789012345678901234", "mainnet");
    // Only jTRX should appear (jUSDT snapshot failed)
    expect(summary.positions).toHaveLength(1);
    expect(summary.positions[0].symbol).toBe("jTRX");
  });

  it("should fallback to price API when oracle returns 0", async () => {
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: { 0: 0, 1: "50000000000", 2: 0, 3: "200000000000000000" } },
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
    ]);
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: "0" },
    ]);

    mockFetchPriceFromAPI.mockResolvedValueOnce(1.0);

    const summary = await getAccountSummary("TTestUser123456789012345678901234", "mainnet");
    expect(summary.positions).toHaveLength(1);
    expect(mockFetchPriceFromAPI).toHaveBeenCalledWith("USDT", 6, "mainnet");
  });

  it("should fallback to price API when price call fails", async () => {
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: { 0: 0, 1: "50000000000", 2: 0, 3: "200000000000000000" } },
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
    ]);
    mockMulticall.mockResolvedValueOnce([
      { success: false, error: "price call failed" },
    ]);

    mockFetchPriceFromAPI.mockResolvedValueOnce(1.0);

    const summary = await getAccountSummary("TTestUser123456789012345678901234", "mainnet");
    expect(summary.positions).toHaveLength(1);
    expect(mockFetchPriceFromAPI).toHaveBeenCalled();
  });

  it("should include block info in summary", async () => {
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
    ]);

    const summary = await getAccountSummary("TTestUser123456789012345678901234", "mainnet");
    expect(summary.blockNumber).toBe(12345678);
    expect(summary.lastUpdated).toBeDefined();
    expect(summary.address).toBe("TTestUser123456789012345678901234");
    expect(summary.network).toBe("mainnet");
  });

  it("should preserve precision for large positions above MAX_SAFE_INTEGER", async () => {
    mockGetAccountLiquidity.mockResolvedValueOnce({
      0: 0,
      1: "9007199254740993123456789000000000000",
      2: "0",
      err: 0,
      liquidity: "9007199254740993123456789000000000000",
      shortfall: "0",
    });
    mockMulticall.mockResolvedValueOnce([
      {
        success: true,
        result: {
          0: 0,
          1: "900719925474099312345678901234",
          2: "123456789",
          3: "1000000000000000000",
        },
      },
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
    ]);
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: "1000000000000000000000000000000" },
    ]);

    const summary = await getAccountSummary("TTestUser123456789012345678901234", "mainnet");

    expect(summary.positions).toHaveLength(1);
    expect(summary.positions[0].supplyBalance).toBe("900719925474099312345678.9");
    expect(summary.positions[0].borrowBalance).toBe("123.456789");
    expect(summary.positions[0].supplyValueUSD).toBe("900719925474099312345678.90");
    expect(summary.positions[0].borrowValueUSD).toBe("123.46");
    expect(summary.totalSupplyUSD).toBe("900719925474099312345678.90");
    expect(summary.totalBorrowUSD).toBe("123.46");
    expect(summary.liquidityUSD).toBe("9007199254740993123.46");
    expect(summary.healthFactor).toBe("72956417096557534.8041");
  });

  it("should pass multicall calls with correct structure", async () => {
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: { 0: 0, 1: "50000000000", 2: 0, 3: "200000000000000000" } },
      { success: true, result: { 0: 0, 1: 0, 2: 0, 3: "200000000000000000" } },
    ]);
    mockMulticall.mockResolvedValueOnce([
      { success: true, result: "0" },
    ]);

    await getAccountSummary("TTestUser123456789012345678901234", "mainnet");

    expect(mockMulticall).toHaveBeenCalledTimes(2);
    const snapshotBatch = mockMulticall.mock.calls[0][0];
    const priceBatch = mockMulticall.mock.calls[1][0];
    expect(snapshotBatch.calls).toHaveLength(2);
    expect(snapshotBatch.calls[0].functionName).toBe("getAccountSnapshot");
    expect(snapshotBatch.calls[1].functionName).toBe("getAccountSnapshot");
    expect(priceBatch.calls).toHaveLength(1);
    expect(priceBatch.calls[0].functionName).toBe("getUnderlyingPrice");
  });
});
