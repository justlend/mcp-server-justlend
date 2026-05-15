/**
 * Regression tests for the audit-2026-05-13 approve-flow tightening.
 *
 * Goal: prove that the new pre-network validation in approveUnderlying /
 * approveJSTForVoting refuses to silently grant unlimited allowance when the
 * caller omits `amount`. The throw happens before any TronWeb / signing call,
 * so these tests stay pure-logic and need no network.
 */
import { describe, it, expect } from "vitest";
import { approveUnderlying } from "../../../src/core/services/lending.js";
import { approveJSTForVoting } from "../../../src/core/services/voting.js";

describe("approveUnderlying — amount required", () => {
  it("throws a clear error when amount is undefined", async () => {
    // @ts-expect-error — intentionally calling without the now-required amount.
    await expect(approveUnderlying("jUSDT")).rejects.toThrow(
      /requires an explicit amount/,
    );
  });

  it("throws a clear error when amount is the empty string", async () => {
    await expect(approveUnderlying("jUSDT", "")).rejects.toThrow(
      /requires an explicit amount/,
    );
  });

  it("rejects approval on a native-TRX market before checking amount", async () => {
    // jTRX has no `underlying` — the function must reject this entire concept,
    // independent of the amount the caller passes.
    await expect(approveUnderlying("jTRX", "100")).rejects.toThrow(
      /native TRX — no approval needed/,
    );
  });
});

describe("approveJSTForVoting — amount required", () => {
  it("throws a clear error when amount is undefined", async () => {
    // @ts-expect-error — intentionally calling without the now-required amount.
    await expect(approveJSTForVoting()).rejects.toThrow(
      /requires an explicit amount/,
    );
  });

  it("throws a clear error when amount is the empty string", async () => {
    await expect(approveJSTForVoting("")).rejects.toThrow(
      /requires an explicit amount/,
    );
  });
});
