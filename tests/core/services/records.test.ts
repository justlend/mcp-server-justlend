import { describe, it, expect } from "vitest";
import {
  fetchLendingRecords,
  fetchStrxRecords,
  fetchVoteRecords,
  fetchEnergyRentalRecords,
  fetchLiquidationRecords,
  LENDING_ACTION_TYPES,
  STRX_OP_TYPES,
  VOTE_OP_TYPES,
  RENT_ACTION_TYPES,
} from "../../../src/core/services/records.js";
import { skipOn429 } from "../../helpers.js";

// Well-known Tron address that may or may not have activity; we only assert
// response shape, never content.
const PROBE_ADDR = "TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7";

describe("V1 records service (mainnet-only)", () => {
  it("action/op type constants cover every code used in the frontend", () => {
    // guards against accidental drift
    expect(Object.keys(LENDING_ACTION_TYPES)).toHaveLength(11);
    expect(Object.keys(STRX_OP_TYPES)).toHaveLength(5);
    expect(Object.keys(VOTE_OP_TYPES)).toHaveLength(6);
    expect(Object.keys(RENT_ACTION_TYPES)).toHaveLength(5);
  });

  it("fetchLendingRecords returns paginated envelope with actionName enrichment", skipOn429(async () => {
    const res = await fetchLendingRecords(PROBE_ADDR, 1, 2, "mainnet");
    expect(res).toHaveProperty("items");
    expect(res).toHaveProperty("pageNum");
    expect(res).toHaveProperty("pageSize");
    expect(res).toHaveProperty("totalCount");
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.totalCount).toBe("number");
    // If the probe address has records, every one must carry actionName
    for (const r of res.items) {
      expect(typeof r.actionName).toBe("string");
    }
  }));

  it("fetchStrxRecords returns paginated envelope", skipOn429(async () => {
    const res = await fetchStrxRecords(PROBE_ADDR, 1, 2, "mainnet");
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.totalCount).toBe("number");
    for (const r of res.items) {
      expect(typeof r.opName).toBe("string");
    }
  }));

  it("fetchVoteRecords returns paginated envelope", skipOn429(async () => {
    const res = await fetchVoteRecords(PROBE_ADDR, 1, 2, "mainnet");
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.totalCount).toBe("number");
  }));

  it("fetchEnergyRentalRecords returns paginated envelope", skipOn429(async () => {
    const res = await fetchEnergyRentalRecords(PROBE_ADDR, 1, 2, "mainnet");
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.totalCount).toBe("number");
  }));

  it("fetchLiquidationRecords returns paginated envelope (may include unReadCount)", skipOn429(async () => {
    const res = await fetchLiquidationRecords(PROBE_ADDR, 1, 2, "mainnet");
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.totalCount).toBe("number");
  }));

  it("fetchClaimableRewards returns a merkleRewards map (empty for contract addr is fine)", skipOn429(async () => {
    const { fetchClaimableRewards } = await import("../../../src/core/services/records.js");
    const res = await fetchClaimableRewards(PROBE_ADDR, "mainnet");
    expect(res).toHaveProperty("merkleRewards");
    expect(typeof res.merkleRewards).toBe("object");
  }));

  it("fetchClaimableRewards rejects nile network", async () => {
    const { fetchClaimableRewards } = await import("../../../src/core/services/records.js");
    await expect(fetchClaimableRewards(PROBE_ADDR, "nile")).rejects.toThrow(/only available on mainnet/i);
  });

  it("rejects nile network with a clear error", async () => {
    await expect(fetchLendingRecords(PROBE_ADDR, 1, 2, "nile")).rejects.toThrow(/only available on mainnet/i);
    await expect(fetchStrxRecords(PROBE_ADDR, 1, 2, "nile")).rejects.toThrow(/only available on mainnet/i);
    await expect(fetchVoteRecords(PROBE_ADDR, 1, 2, "nile")).rejects.toThrow(/only available on mainnet/i);
    await expect(fetchEnergyRentalRecords(PROBE_ADDR, 1, 2, "nile")).rejects.toThrow(/only available on mainnet/i);
    await expect(fetchLiquidationRecords(PROBE_ADDR, 1, 2, "nile")).rejects.toThrow(/only available on mainnet/i);
  });
});
