/**
 * Tests for transfer.ts.
 *
 * All write functions (transferTRX, transferTRC20, approveTRC20) require
 * a private key and would spend real funds on mainnet.
 * They are skipped unless TRON_PRIVATE_KEY is set AND TEST_TRANSFER=1 is set
 * to prevent accidental fund movement during CI.
 */
import { describe, it, expect } from "vitest";
import {
  transferTRX,
  transferTRC20,
  approveTRC20,
} from "../../../src/core/services/transfer.js";

const ALLOW_WRITE = Boolean(process.env.TRON_PRIVATE_KEY && process.env.TEST_TRANSFER === "1");
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
      const privateKey = process.env.TRON_PRIVATE_KEY!;
      // Sending 1 TRX to the burn address
      const txHash = await transferTRX(
        privateKey,
        "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
        "1",
        "nile",
      );
      expect(typeof txHash).toBe("string");
      expect(txHash.length).toBeGreaterThan(0);
      console.log(`Transfer TX: ${txHash}`);
    },
    60_000,
  );
});

describe("approveTRC20 (write — skipped by default)", () => {
  it.skipIf(!ALLOW_WRITE)(
    "should approve a spender and return a tx hash",
    async () => {
      const privateKey = process.env.TRON_PRIVATE_KEY!;
      // Approve 0 to a known spender (safe test)
      const txHash = await approveTRC20(
        USDT_ADDRESS,
        "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
        "0",
        privateKey,
        "nile",
      );
      expect(typeof txHash).toBe("string");
      console.log(`Approve TX: ${txHash}`);
    },
    60_000,
  );
});
