/**
 * Integration tests for balance.ts.
 * Makes real TRON mainnet RPC calls — requires network access.
 * Rate-limited without TRONGRID_API_KEY.
 */
import { describe, it, expect } from "vitest";
import {
  getTRXBalance,
  getTRC20Balance,
} from "../../../src/core/services/balance.js";
import { utils } from "../../../src/core/services/utils.js";
import { skipOn429 } from "../../helpers.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TEST_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

describe("getTRXBalance (Mainnet)", () => {
  it("should return a rich balance object", skipOn429(async () => {
    const result = await getTRXBalance(TEST_ADDRESS, "mainnet");

    expect(result).toBeDefined();
    expect(typeof result.wei).toBe("bigint");
    expect(result.wei).toBeGreaterThanOrEqual(0n);
    expect(typeof result.ether).toBe("string");
    expect(typeof result.formatted).toBe("string");
    expect(result.symbol).toBe("TRX");
    expect(result.decimals).toBe(6);
    expect(result.ether).toBe(result.formatted);
    console.error(`TRX Balance: ${result.formatted} TRX (${result.wei} Sun)`);
  }), 20_000);

  it("wei and ether should be consistent", skipOn429(async () => {
    await delay(1000);
    const result = await getTRXBalance(TEST_ADDRESS, "mainnet");
    expect(result.ether).toBe(utils.formatUnits(result.wei, 6));
  }), 20_000);

  it("should handle an address with zero balance", skipOn429(async () => {
    await delay(1000);
    const result = await getTRXBalance("TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW", "mainnet");
    expect(result.wei).toBeGreaterThanOrEqual(0n);
    expect(typeof result.formatted).toBe("string");
  }), 20_000);
});

describe("getTRC20Balance (Mainnet)", () => {
  it("should return USDT balance with token info", skipOn429(async () => {
    await delay(3000);
    const result = await getTRC20Balance(USDT_ADDRESS, TEST_ADDRESS, "mainnet");

    expect(result).toBeDefined();
    expect(typeof result.raw).toBe("bigint");
    expect(typeof result.formatted).toBe("string");
    expect(result.token).toBeDefined();
    expect(result.token.symbol).toBe("USDT");
    expect(result.token.decimals).toBe(6);
    expect(result.token.address).toBe(USDT_ADDRESS);
    console.error(`USDT Balance: ${result.formatted} USDT`);
  }), 20_000);

  it("should throw for an invalid token address", async () => {
    await delay(1000);
    await expect(
      getTRC20Balance("TInvalidAddressXXXXXXXXXXXXXXXXXXX", TEST_ADDRESS, "mainnet"),
    ).rejects.toThrow();
  }, 20_000);
});
