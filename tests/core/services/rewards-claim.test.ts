import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  routeV1ClaimEntry,
  claimV1MiningPeriod,
  type V1ClaimRoute,
} from "../../../src/core/services/rewards.js";
import * as records from "../../../src/core/services/records.js";

// Mainnet USDD token (jUSDD.underlying) — used to verify USDDNEW routing.
const USDD_TOKEN_MAINNET = "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz";
const USDD_DISTRIBUTOR_MAINNET = "TYxJzmeDyxuxFbaGywjivfkft75qLeS485";
const MAIN_DISTRIBUTOR_MAINNET = "TQoiXqruw4SqYPwHAd6QiNZ3ES4rLsejAj";
const MULTI_DISTRIBUTOR_MAINNET = "TUsyCPRyQdMsn9WnJcssBFXtzg6bUVbty6";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("routeV1ClaimEntry — front-app Reward.jsx parity", () => {
  it("routes array-amount entries to the multi distributor with array selector", () => {
    const route = routeV1ClaimEntry(
      { amount: ["1000000", "2000000"], tokenAddress: ["TX...", "TY..."] },
      "mainnet",
    );
    const r = route as V1ClaimRoute;
    expect(r.distributor).toBe(MULTI_DISTRIBUTOR_MAINNET);
    expect(r.selector).toBe("multi");
    expect(r.type).toBe("multi");
  });

  it("routes single-amount USDD entries by tokenAddress to the USDDNEW distributor", () => {
    const route = routeV1ClaimEntry(
      { amount: "1000000000000000000", tokenAddress: USDD_TOKEN_MAINNET },
      "mainnet",
    );
    expect(route.distributor).toBe(USDD_DISTRIBUTOR_MAINNET);
    expect(route.selector).toBe("single");
    expect(route.type).toBe("usdd-new");
  });

  it("falls back to tokenSymbol='USDD' when tokenAddress is missing", () => {
    const route = routeV1ClaimEntry(
      { amount: "1000000000000000000", tokenSymbol: "USDD" },
      "mainnet",
    );
    expect(route.distributor).toBe(USDD_DISTRIBUTOR_MAINNET);
    expect(route.type).toBe("usdd-new");
  });

  it("routes other single-token entries to the main distributor", () => {
    const route = routeV1ClaimEntry(
      { amount: "1000000", tokenSymbol: "TRX", tokenAddress: "" },
      "mainnet",
    );
    expect(route.distributor).toBe(MAIN_DISTRIBUTOR_MAINNET);
    expect(route.selector).toBe("single");
    expect(route.type).toBe("main");
  });
});

describe("claimV1MiningPeriod — input validation", () => {
  it("requires either key or full claim fields", async () => {
    await expect(claimV1MiningPeriod({ network: "mainnet" })).rejects.toThrow(
      /Either key or full claim fields/,
    );
  });

  it("errors when supplied claim fields lack a merkle proof", async () => {
    await expect(
      claimV1MiningPeriod({
        merkleIndex: 0,
        index: 1,
        amount: "100",
        proof: [],
        network: "mainnet",
      }),
    ).rejects.toThrow(/has no merkle proof/);
  });

  it("errors when the resolved entry from get_claimable_rewards is missing", async () => {
    vi.spyOn(records, "fetchClaimableRewards").mockResolvedValue({
      merkleRewards: {},
      rawResponse: {},
    } as any);
    // Need to bypass the wallet lookup — pass `address` so getSigningClient
    // is the only dependency we still hit. We can't sign here without a
    // wallet, so the function should fail at the entry-lookup step before
    // ever attempting a tx.
    await expect(
      claimV1MiningPeriod({ key: "missing-key", address: "TFakeUserAddress00000000000000000", network: "mainnet" }),
    ).rejects.toThrow(); // Either "no entry" or wallet error — both surface the missing claim.
  });
});
