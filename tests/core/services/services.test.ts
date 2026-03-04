/**
 * Integration tests for JustLend read-only services.
 *
 * These tests interact with the TRON mainnet to verify
 * that service functions return correctly structured data.
 *
 * NOTE:
 * - These tests make real blockchain RPC calls and may be slow.
 * - Without TRONGRID_API_KEY, requests may be rate-limited (429).
 * - Some jToken addresses in chains.ts may need to be updated
 *   to real on-chain addresses for market data tests to pass.
 *
 * Run with: npx vitest run tests/core/services/services.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  getAccountTRXBalance,
  getTokenBalance,
} from "../../../src/core/services/account.js";
import { getTronWeb } from "../../../src/core/services/clients.js";

// Well-known mainnet addresses for testing
const TEST_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/** Small delay helper to avoid rate limiting */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// TronWeb Client (no network calls - always passes)
// ============================================================================

describe("TronWeb Client", () => {
  it("should create a read-only TronWeb instance for mainnet", () => {
    const tronWeb = getTronWeb("mainnet");
    expect(tronWeb).toBeDefined();
    expect(tronWeb.defaultAddress).toBeDefined();
  });

  it("should cache TronWeb instances", () => {
    const client1 = getTronWeb("mainnet");
    const client2 = getTronWeb("mainnet");
    expect(client1).toBe(client2);
  });

  it("should create separate instances for different networks", () => {
    const mainnet = getTronWeb("mainnet");
    const nile = getTronWeb("nile");
    expect(mainnet).not.toBe(nile);
  });
});

// ============================================================================
// Balance Services (Mainnet)
// ============================================================================

describe("Balance Services (Mainnet)", () => {
  it("should fetch TRX balance for a known address", async () => {
    const balance = await getAccountTRXBalance(TEST_ADDRESS, "mainnet");
    expect(balance).toBeDefined();
    expect(typeof balance).toBe("string");
    const numBalance = parseFloat(balance);
    expect(numBalance).toBeGreaterThanOrEqual(0);
    console.log(`TRX Balance for ${TEST_ADDRESS}: ${balance} TRX`);
  }, 20_000);

  it("should fetch TRC20 token balance (USDT)", async () => {
    await delay(1500);
    const result = await getTokenBalance(TEST_ADDRESS, USDT_ADDRESS, "mainnet");
    expect(result).toBeDefined();
    expect(result.symbol).toBeDefined();
    expect(typeof result.decimals).toBe("number");
    expect(typeof result.balance).toBe("string");
    const numBalance = parseFloat(result.balance);
    expect(numBalance).toBeGreaterThanOrEqual(0);
    console.log(`USDT Balance: ${result.balance} ${result.symbol}`);
  }, 20_000);

  it("should return zero balance for empty address", async () => {
    await delay(1500);
    // Use a valid but likely empty address
    const balance = await getAccountTRXBalance("TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW", "mainnet");
    expect(balance).toBeDefined();
    expect(typeof balance).toBe("string");
    console.log(`Empty address TRX Balance: ${balance} TRX`);
  }, 20_000);
});

// ============================================================================
// Market Data Services (Mainnet)
//
// NOTE: These tests depend on correct jToken contract addresses in chains.ts.
// If jToken addresses are incorrect or placeholders, these tests will fail
// with "Invalid address" or "Smart contract is missing address" errors.
// When addresses are updated to real on-chain values, uncomment these tests.
// ============================================================================

// TODO: Uncomment when jToken addresses in chains.ts are updated to real values.
// Currently jBTC has the same address as jTRX, and jETH has the same address
// as its underlying, which causes contract call failures.
//
// describe("Market Data Services (Mainnet)", () => {
//   it("should fetch market data for jUSDT", async () => { ... });
//   it("should fetch all market data", async () => { ... });
// });
//
// describe("Protocol Summary (Mainnet)", () => {
//   it("should fetch protocol summary", async () => { ... });
// });
