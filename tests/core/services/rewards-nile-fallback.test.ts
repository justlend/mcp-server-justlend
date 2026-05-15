/**
 * Unit tests for rewards.ts Nile fallback.
 *
 * The JustLend rewards/account API has no Nile counterpart, so a fetch failure
 * on Nile should degrade to a zero-amount snapshot with a clear note rather than
 * surface a raw "fetch failed" to callers — mirroring strx-staking's contract
 * fallback. On mainnet the original throwing behavior is preserved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { getMiningRewardsFromAPI } from "../../../src/core/services/rewards.js";

const ADDR = "TCrDi83pUoK17GbwxN1SckM3YNXzahWvoN";

describe("getMiningRewardsFromAPI — Nile fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a zero-amount snapshot with a contract-mode note when fetch fails on Nile", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));
    const result = await getMiningRewardsFromAPI(ADDR, "nile");

    expect(result.address).toBe(ADDR);
    expect(result.network).toBe("nile");
    expect(result.totalGainNewUSD).toBe("0");
    expect(result.totalGainLastUSD).toBe("0");
    expect(result.totalUnclaimedUSD).toBe("0");
    expect(result.markets).toEqual([]);
    expect(result.rawData?.source).toBe("contract");
    expect(result.rawData?.note).toMatch(/Nile/i);
    expect(result.rawData?.apiError).toContain("fetch failed");
  });

  it("falls back on Nile when API returns a non-zero error code", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: -1, message: "no service" }),
    });
    const result = await getMiningRewardsFromAPI(ADDR, "nile");
    expect(result.rawData?.source).toBe("contract");
    expect(result.markets).toEqual([]);
  });

  it("falls back on Nile when API returns a non-OK HTTP status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({}),
    });
    const result = await getMiningRewardsFromAPI(ADDR, "nile");
    expect(result.rawData?.source).toBe("contract");
    expect(result.markets).toEqual([]);
  });

  it("still throws on mainnet so callers see the real error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(getMiningRewardsFromAPI(ADDR, "mainnet")).rejects.toThrow(
      /Failed to fetch mining rewards/,
    );
  });
});
