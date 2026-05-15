/**
 * Regression test for the audit-2026-05-13 voting fix.
 *
 * Before the fix, `getUserVoteStatus` swallowed every per-proposal RPC
 * failure with `} catch (err) { }`. The caller could not distinguish
 * "user has not voted" from "we could not read the receipt".
 *
 * After the fix, failed pIds accumulate into `failedProposals: number[]`
 * and a tagged `console.warn` is emitted. The field is omitted when the
 * full scan succeeds (no extra noise in the happy path).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Build a fake governor contract whose per-call behaviour the test controls.
const proposalCountCall = vi.fn();
const getReceiptCall = vi.fn();
const stateCall = vi.fn();

const fakeContract = {
  methods: {
    proposalCount: () => ({ call: proposalCountCall }),
    getReceipt: (..._args: any[]) => ({ call: () => getReceiptCall(..._args) }),
    state: (pId: number) => ({ call: () => stateCall(pId) }),
  },
};

const mockTronWeb = {
  contract: vi.fn(() => fakeContract),
};

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => mockTronWeb),
}));

import { getUserVoteStatus } from "../../../src/core/services/voting.js";

const USER = "TUserAddressForVotingTestsXXXXXXXX";

describe("getUserVoteStatus — audit-2026-05-13 failedProposals surface", () => {
  beforeEach(() => {
    proposalCountCall.mockReset();
    getReceiptCall.mockReset();
    stateCall.mockReset();
  });

  it("omits failedProposals on a clean scan", async () => {
    // 3 proposals, user has voted on none — receipt resolves but hasVoted=false.
    proposalCountCall.mockResolvedValue(3n);
    getReceiptCall.mockResolvedValue({ hasVoted: false, support: 0, votes: 0n });

    const result = await getUserVoteStatus(USER, "mainnet");

    expect(result.statusList).toEqual([]);
    expect(result.votedProposals).toEqual([]);
    expect(result.withdrawableProposals).toEqual([]);
    expect(result.failedProposals).toBeUndefined();
  });

  it("collects the pIds whose receipt call rejects", async () => {
    proposalCountCall.mockResolvedValue(5n);
    // Make pId=4 and pId=2 fail; the rest report "no vote".
    getReceiptCall.mockImplementation(async (pId: number, _addr: string) => {
      if (pId === 4 || pId === 2) {
        throw new Error(`RPC unavailable for proposal ${pId}`);
      }
      return { hasVoted: false, support: 0, votes: 0n };
    });

    // Silence the diagnostic warn so the test output stays clean.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getUserVoteStatus(USER, "mainnet");

    expect(result.statusList).toEqual([]);
    expect(result.failedProposals).toBeDefined();
    expect(result.failedProposals!.sort((a, b) => a - b)).toEqual([2, 4]);

    // The fix also logs each failure exactly once.
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0][0]).toMatch(/Failed receipt fetch for proposal/);
    warnSpy.mockRestore();
  });

  it("returns valid votes alongside failed pIds", async () => {
    proposalCountCall.mockResolvedValue(3n);

    // pId=3: user voted FOR with 1e18 raw → 1 "vote unit"
    // pId=2: RPC fails
    // pId=1: user has not voted
    getReceiptCall.mockImplementation(async (pId: number, _addr: string) => {
      if (pId === 3) return { hasVoted: true, support: 1, votes: 10n ** 18n };
      if (pId === 2) throw new Error("transient node hiccup");
      return { hasVoted: false, support: 0, votes: 0n };
    });
    stateCall.mockImplementation(async (pId: number) => {
      // 2 = Defeated  →  canWithdraw must be true (state !== 1 = Active)
      return pId === 3 ? 2 : 1;
    });

    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getUserVoteStatus(USER, "mainnet");

    expect(result.votedProposals).toEqual([3]);
    expect(result.statusList).toHaveLength(1);
    expect(result.statusList[0].proposalId).toBe(3);
    expect(result.statusList[0].forVotes).not.toBe("0");
    expect(result.statusList[0].canWithdraw).toBe(true);
    expect(result.failedProposals).toEqual([2]);
  });
});
