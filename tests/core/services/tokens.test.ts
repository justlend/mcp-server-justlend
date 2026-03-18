/**
 * Integration tests for tokens.ts.
 * Makes real TRON mainnet RPC calls — requires network access.
 *
 * NOTE: getTRC20TokenInfo makes 4 concurrent RPC calls.
 * Without TRONGRID_API_KEY the TronGrid free tier may return 429.
 * Set TRONGRID_API_KEY to run these tests reliably.
 *
 * Run: npx vitest run tests/core/services/tokens.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  getTRC20TokenInfo,
  getTRC721TokenMetadata,
  getTRC1155TokenURI,
} from "../../../src/core/services/tokens.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Skip a test if the error is a TronGrid 429 rate-limit. Re-throw otherwise. */
function skipOn429(error: any): void {
  const msg = String(error?.message ?? "");
  if (msg.includes("429")) {
    console.warn("⚠ Rate-limited by TronGrid (429) — set TRONGRID_API_KEY for reliable tests");
    return; // treat as soft skip
  }
  throw error;
}

const USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SUN_ADDRESS = "TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9";

describe("getTRC20TokenInfo (Mainnet)", () => {
  it("should return correct metadata for USDT", async () => {
    await delay(2000);
    try {
      const info = await getTRC20TokenInfo(USDT_ADDRESS, "mainnet");

      expect(info.name).toBeTruthy();
      expect(info.symbol).toBe("USDT");
      expect(info.decimals).toBe(6);
      expect(typeof info.totalSupply).toBe("bigint");
      expect(info.totalSupply).toBeGreaterThan(0n);
      expect(typeof info.formattedTotalSupply).toBe("string");
      console.error(
        `USDT: name=${info.name}, supply=${info.formattedTotalSupply}, decimals=${info.decimals}`,
      );
    } catch (e) {
      skipOn429(e);
    }
  }, 30_000);

  it("should return correct metadata for SUN token", async () => {
    await delay(3000);
    try {
      const info = await getTRC20TokenInfo(SUN_ADDRESS, "mainnet");

      expect(info.symbol).toBeTruthy();
      expect(typeof info.decimals).toBe("number");
      expect(info.totalSupply).toBeGreaterThan(0n);
      console.error(`SUN: symbol=${info.symbol}, decimals=${info.decimals}`);
    } catch (e) {
      skipOn429(e);
    }
  }, 30_000);

  it("should throw a descriptive error for an invalid contract address", async () => {
    await delay(2000);
    await expect(
      getTRC20TokenInfo("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", "mainnet"),
    ).rejects.toThrow("Failed to get TRC20 token info");
  }, 25_000);
});

describe("module exports", () => {
  it("getTRC721TokenMetadata is a function", () => {
    expect(typeof getTRC721TokenMetadata).toBe("function");
  });

  it("getTRC1155TokenURI is a function", () => {
    expect(typeof getTRC1155TokenURI).toBe("function");
  });
});
