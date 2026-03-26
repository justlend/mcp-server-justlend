/**
 * Tests for transfer.ts.
 *
 * All write functions (transferTRX, transferTRC20, approveTRC20) require
 * agent-wallet to be configured and would spend real funds on mainnet.
 * They are skipped unless TEST_TRANSFER=1 is set
 * to prevent accidental fund movement during CI.
 */
import { describe, it, expect } from "vitest";
import {
  transferTRX,
  transferTRC20,
  approveTRC20,
} from "../../../src/core/services/transfer.js";

const ALLOW_WRITE = process.env.TEST_TRANSFER === "1";
const USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

describe("transfer module exports", () => {
  it("transferTRX is a function", () => {
    expect(typeof transferTRX).toBe("function");
  });

  it("transferTRC20 is a function", () => {
    expect(typeof transferTRC20).toBe("function");
  });

  it("approveTRC20 is a function", () => {
    expect(typeof approveTRC20).toBe("function");
  });
});

describe("transferTRX (write — skipped by default)", () => {
  it.skipIf(!ALLOW_WRITE)(
    "should transfer TRX to a test address and return a tx hash",
    async () => {
      // Sending 1 TRX to the burn address
      const txHash = await transferTRX(
        "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
        "1",
        "nile",
      );
      expect(typeof txHash).toBe("string");
      expect(txHash.length).toBeGreaterThan(0);
      console.error(`Transfer TX: ${txHash}`);
    },
    60_000,
  );
});

describe("approveTRC20 (write — skipped by default)", () => {
  it.skipIf(!ALLOW_WRITE)(
    "should approve a spender and return a tx hash",
    async () => {
      // Approve 0 to a known spender (safe test)
      const txHash = await approveTRC20(
        USDT_ADDRESS,
        "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
        "0",
        "nile",
      );
      expect(typeof txHash).toBe("string");
      console.error(`Approve TX: ${txHash}`);
    },
    60_000,
  );
});
