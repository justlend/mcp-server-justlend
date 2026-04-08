/**
 * Unit tests for strx-staking.ts fallback logic.
 * Mocks API and TronWeb to test API→on-chain fallback paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cacheInvalidatePrefix } from "../../../src/core/services/cache.js";

// Mock TronWeb client
const mockContractMethods = {
  exchangeRate: vi.fn(() => ({ call: vi.fn(async () => "1286202534587060889") })),
  totalSupply: vi.fn(() => ({ call: vi.fn(async () => "500000000000000000000000000") })),
  totalUnfreezable: vi.fn(() => ({ call: vi.fn(async () => "100000000000000") })),
  getUnfreezeDelayDays: vi.fn(() => ({ call: vi.fn(async () => "14") })),
  balanceOf: vi.fn(() => ({ call: vi.fn(async () => "1000000000000000000000") })),
  viewBalanceOfUnderlying: vi.fn(() => ({ call: vi.fn(async () => "1050000000") })),
};

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => ({
    contract: vi.fn(() => ({ methods: mockContractMethods })),
  })),
}));

vi.mock("../../../src/core/services/wallet.js", () => ({
  getSigningClient: vi.fn(),
}));

vi.mock("../../../src/core/services/lending.js", () => ({
  checkResourceSufficiency: vi.fn(async () => ({
    energyBurnTRX: "0", bandwidthBurnTRX: "0",
  })),
}));

vi.mock("../../../src/core/services/contracts.js", () => ({
  safeSend: vi.fn(async () => ({ txID: "mock_tx" })),
}));

// Mock fetch for API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { getStrxDashboard, getStrxStakeAccount } from "../../../src/core/services/strx-staking.js";

function makeApiOk(data: any) {
  return { ok: true, json: async () => ({ code: 0, data }) };
}

describe("getStrxDashboard fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheInvalidatePrefix("strx:");
  });

  it("should return API data when API is available", async () => {
    mockFetch.mockResolvedValueOnce(makeApiOk({
      trxPrice: 0.12,
      exchangeRate: "1050000000000000000",
      totalApy: 5.5,
      voteApy: 3.2,
      totalSupply: "500000000",
      totalUnfreezable: "100000000",
      unfreezeDelayDays: 14,
      energyStakePerTrx: 30,
      jstAmountRewardRentPerTrx: 0.01,
      jstPrice: 0.03,
    }));

    const result = await getStrxDashboard("mainnet");
    expect(result.trxPrice).toBe(0.12);
    expect(result.totalApy).toBe(5.5);
    expect(result.unfreezeDelayDays).toBe(14);
    expect(result).not.toHaveProperty("source");
  });

  it("should fallback to on-chain when API fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("API timeout"));

    const result = await getStrxDashboard("mainnet");
    expect(result.source).toBe("contract");
    expect(result.trxPrice).toBeNull();
    expect(result.totalApy).toBeNull();
    expect(result.exchangeRate).toBe("1286202534587060889");
    expect(result.unfreezeDelayDays).toBe(14);
    expect(result.sTrx1Trx).toBeDefined();
    expect(result.trx1sTrx).toBeDefined();
  });

  it("should fallback when API returns error code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: -1, message: "service unavailable" }),
    });

    const result = await getStrxDashboard("mainnet");
    expect(result.source).toBe("contract");
    expect(result.note).toContain("API down");
  });

  it("should cache API result", async () => {
    mockFetch.mockResolvedValueOnce(makeApiOk({
      trxPrice: 0.12,
      exchangeRate: "1050000000000000000",
      totalApy: 5.5,
      voteApy: 3.2,
      totalSupply: "500000000",
      totalUnfreezable: "100000000",
      unfreezeDelayDays: 14,
      energyStakePerTrx: 30,
      jstAmountRewardRentPerTrx: 0.01,
      jstPrice: 0.03,
    }));

    await getStrxDashboard("mainnet");
    const result2 = await getStrxDashboard("mainnet");
    expect(result2.trxPrice).toBe(0.12);
    expect(mockFetch).toHaveBeenCalledTimes(1); // cached
  });
});

describe("getStrxStakeAccount fallback", () => {
  const TEST_ADDR = "TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return API data when API is available", async () => {
    mockFetch.mockResolvedValueOnce(makeApiOk({
      accountSupply: 1000,
      accountIncome: 50,
      accountCanClaimAmount: 10,
      accountWithDrawAmount: 0,
      accountRentEnergyAmount: 0,
      roundDetails: [],
      rewardMap: { gainNew: 10 },
    }));

    const result = await getStrxStakeAccount(TEST_ADDR, "mainnet");
    expect(result.accountSupply).toBe(1000);
    expect(result.accountIncome).toBe(50);
    expect(result).not.toHaveProperty("source");
  });

  it("should fallback to on-chain when API fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("API timeout"));

    const result = await getStrxStakeAccount(TEST_ADDR, "mainnet");
    expect(result.source).toBe("contract");
    expect(result.accountSupply).toBeGreaterThanOrEqual(0);
    expect(result.strxBalance).toBeGreaterThanOrEqual(0);
    expect(result.accountIncome).toBeNull();
    expect(result.accountCanClaimAmount).toBeNull();
    expect(result.note).toContain("API down");
  });

  it("should fallback when API returns error code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: -1 }),
    });

    const result = await getStrxStakeAccount(TEST_ADDR, "mainnet");
    expect(result.source).toBe("contract");
  });

  it("should reject invalid address", async () => {
    await expect(
      getStrxStakeAccount("invalid", "mainnet"),
    ).rejects.toThrow("Invalid TRON");
  });
});
