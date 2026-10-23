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

import { getStrxDashboard, getStrxStakeAccount, checkWithdrawalEligibility, claimStrxRewards } from "../../../src/core/services/strx-staking.js";
import { getSigningClient } from "../../../src/core/services/wallet.js";
import { safeSend } from "../../../src/core/services/contracts.js";
import { STRX_ELIGIBILITY_RESULT_SCHEMA } from "../../../src/core/tools/structured-output.js";

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
    expect(result.accountSupply).toBe("1050");
    expect(result.strxBalance).toBe("1000");
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

describe("sTRX eligibility and claim decisions", () => {
  const address = "TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5";
  const account = { accountSupply: "1000", accountIncome: "50", accountCanClaimAmount: "10", accountWithDrawAmount: "0", roundDetails: [] };
  const dashboard = { exchangeRate: "1050000000000000000", unfreezeDelayDays: 14 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    cacheInvalidatePrefix("strx:");
    vi.mocked(getSigningClient).mockResolvedValue({
      defaultAddress: { base58: address }, contract: vi.fn(),
    } as any);
  });

  it("keeps contract fallback amounts and rounds unknown and propagates provenance", async () => {
    mockFetch.mockRejectedValue(new Error("API timeout"));
    const result = await checkWithdrawalEligibility(address);
    expect(result).toMatchObject({
      stakedAmount: 1050, hasStakedTrx: true, totalIncome: null,
      claimableRewards: null, withdrawnAmount: null, roundDetails: null,
      pendingUnstakeRounds: null, completedUnstakeRounds: null, hasCompletedWithdrawals: null,
      claimEligibility: "unknown", source: "contract", dashboardSource: "contract", dataStatus: "partial",
    });
    expect(result.note).toContain("API down");
    expect(result.unknownFields).toContain("roundDetails");
    expect(STRX_ELIGIBILITY_RESULT_SCHEMA.safeParse(result).success).toBe(true);
  });

  it("distinguishes known zero and an empty queue from missing data", async () => {
    mockFetch.mockResolvedValueOnce(makeApiOk({ ...account, accountCanClaimAmount: "0" }))
      .mockResolvedValueOnce(makeApiOk(dashboard));
    const result = await checkWithdrawalEligibility(address);
    expect(result).toMatchObject({ claimableRewards: 0, claimEligibility: "ineligible", roundDetails: [],
      pendingUnstakeRounds: 0, completedUnstakeRounds: 0, hasCompletedWithdrawals: false,
      dataStatus: "complete", source: "api", dashboardSource: "api", unknownFields: [] });
    expect(STRX_ELIGIBILITY_RESULT_SCHEMA.safeParse(result).success).toBe(true);
  });

  it("keeps positive API eligibility when only the dashboard is degraded", async () => {
    mockFetch.mockResolvedValueOnce(makeApiOk({ ...account,
      roundDetails: [{ endTimestamp: Date.now() - 1000 }, { endTimestamp: Date.now() + 60_000 }] }))
      .mockRejectedValueOnce(new Error("API timeout"));
    const result = await checkWithdrawalEligibility(address);
    expect(result).toMatchObject({ claimEligibility: "eligible", claimableRewards: 10,
      pendingUnstakeRounds: 1, completedUnstakeRounds: 1, hasCompletedWithdrawals: true,
      source: "api", dashboardSource: "contract" });
    expect(result.note).toContain("APY, price, and reward data unavailable");
    expect(STRX_ELIGIBILITY_RESULT_SCHEMA.safeParse(result).success).toBe(true);
  });

  it.each([null, undefined, "", " ", "bad", "NaN", "Infinity", -1, false, {}, "9".repeat(400)])(
    "does not submit a claim for unavailable or invalid amount %j", async (amount) => {
      mockFetch.mockResolvedValueOnce(makeApiOk({ ...account, accountCanClaimAmount: amount }));
      await expect(claimStrxRewards()).rejects.toThrow("claim availability is unknown");
      expect(safeSend).not.toHaveBeenCalled();
    },
  );

  it("does not submit a claim during API fallback", async () => {
    mockFetch.mockRejectedValue(new Error("API timeout"));
    await expect(claimStrxRewards()).rejects.toThrow("claim availability is unknown");
    expect(safeSend).not.toHaveBeenCalled();
  });

  it("rejects a confirmed zero separately from unavailable data", async () => {
    mockFetch.mockResolvedValueOnce(makeApiOk({ ...account, accountCanClaimAmount: "0" }));
    await expect(claimStrxRewards()).rejects.toThrow("No claimable staking rewards");
    expect(safeSend).not.toHaveBeenCalled();
  });

  it("uses claimAll once for a known positive amount (mocked, no network write)", async () => {
    mockFetch.mockResolvedValueOnce(makeApiOk(account));
    expect(await claimStrxRewards()).toMatchObject({ txId: "mock_tx", claimedAmount: "10" });
    expect(safeSend).toHaveBeenCalledTimes(1);
    expect(safeSend).toHaveBeenCalledWith(expect.objectContaining({ functionName: "claimAll" }), "mainnet");
  });

  it("does not infer zero amounts or an empty queue from malformed API fields", async () => {
    mockFetch.mockResolvedValueOnce(makeApiOk({ accountCanClaimAmount: "bad", roundDetails: [{}] }))
      .mockResolvedValueOnce(makeApiOk(dashboard));
    const result = await checkWithdrawalEligibility(address);
    expect(result).toMatchObject({ hasStakedTrx: null, stakedAmount: null, totalIncome: null,
      claimableRewards: null, withdrawnAmount: null, roundDetails: null, claimEligibility: "unknown", dataStatus: "partial" });
    expect(STRX_ELIGIBILITY_RESULT_SCHEMA.safeParse(result).success).toBe(true);
  });
});
