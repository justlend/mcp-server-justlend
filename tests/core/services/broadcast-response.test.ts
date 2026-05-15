/**
 * Unit tests for resolveBroadcastResult (audit-2026-05-13).
 *
 * This helper is the single funnel that all `tronWeb.trx.sendRawTransaction`
 * call sites in contracts.ts / transfer.ts / staking.ts now go through.
 * Before the refactor each call site used `(broadcast as any).result/.message/.txid`
 * — losing type-safety on the field that decides whether the transaction is published.
 *
 * These tests document the contract:
 *   1. result=true + explicit txid → return that txid
 *   2. result=true + only transaction.txID → use it as fallback
 *   3. result=true + neither → throw (we won't return an empty string)
 *   4. result=false + hex-encoded message → decode to a readable string
 *   5. result=false + plain message → keep as-is
 *   6. result missing/false + no message → fall through to JSON dump
 */
import { describe, it, expect } from "vitest";
import { resolveBroadcastResult, type BroadcastResponse } from "../../../src/core/services/contracts.js";

describe("resolveBroadcastResult", () => {
  it("returns the explicit txid on a successful broadcast", () => {
    const broadcast: BroadcastResponse = { result: true, txid: "deadbeef" };
    expect(resolveBroadcastResult(broadcast)).toEqual({ txID: "deadbeef" });
  });

  it("falls back to transaction.txID when txid is missing", () => {
    const broadcast: BroadcastResponse = {
      result: true,
      transaction: { txID: "from-transaction-shape" },
    };
    expect(resolveBroadcastResult(broadcast)).toEqual({
      txID: "from-transaction-shape",
    });
  });

  it("falls back to the caller-supplied fallbackTxID when both are absent", () => {
    const broadcast: BroadcastResponse = { result: true };
    expect(resolveBroadcastResult(broadcast, "caller-side-id")).toEqual({
      txID: "caller-side-id",
    });
  });

  it("throws when result=true but no txID is anywhere", () => {
    const broadcast: BroadcastResponse = { result: true };
    // No fallback either — must not silently return an empty txid.
    expect(() => resolveBroadcastResult(broadcast)).toThrow(
      /Broadcast succeeded but no txID/,
    );
  });

  it("decodes a hex-encoded failure message", () => {
    // "REVERT" → 0x5245564552 54 — hex of the bytes.
    const hex = Buffer.from("REVERT contract paused", "utf8").toString("hex");
    const broadcast: BroadcastResponse = { result: false, message: hex };
    expect(() => resolveBroadcastResult(broadcast)).toThrow(
      /REVERT contract paused/,
    );
  });

  it("keeps a non-hex failure message verbatim", () => {
    const broadcast: BroadcastResponse = {
      result: false,
      message: "Network temporarily unavailable",
    };
    expect(() => resolveBroadcastResult(broadcast)).toThrow(
      /Network temporarily unavailable/,
    );
  });

  it("falls back to a JSON dump when result=false with no message", () => {
    const broadcast: BroadcastResponse = { result: false, code: "BAD_REQUEST" };
    expect(() => resolveBroadcastResult(broadcast)).toThrow(/BAD_REQUEST/);
  });

  it("treats missing result the same as result=false", () => {
    const broadcast: BroadcastResponse = { message: "no result flag at all" };
    expect(() => resolveBroadcastResult(broadcast)).toThrow(/no result flag at all/);
  });
});
