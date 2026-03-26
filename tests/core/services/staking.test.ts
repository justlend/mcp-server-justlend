/**
 * Tests for staking.ts (Stake 2.0).
 *
 * All staking functions are state-changing and require agent-wallet to be configured.
 * They are skipped unless TEST_STAKING=1.
 */
import { describe, it, expect } from "vitest";
import {
  freezeBalanceV2,
  unfreezeBalanceV2,
  withdrawExpireUnfreeze,
} from "../../../src/core/services/staking.js";

const ALLOW_STAKING = process.env.TEST_STAKING === "1";

describe("staking module exports", () => {
  it("freezeBalanceV2 is a function", () => {
    expect(typeof freezeBalanceV2).toBe("function");
  });

  it("unfreezeBalanceV2 is a function", () => {
    expect(typeof unfreezeBalanceV2).toBe("function");
  });

  it("withdrawExpireUnfreeze is a function", () => {
    expect(typeof withdrawExpireUnfreeze).toBe("function");
  });
});

describe("freezeBalanceV2 (write — skipped by default)", () => {
  it.skipIf(!ALLOW_STAKING)(
    "should freeze TRX for BANDWIDTH and return a tx hash",
    async () => {
      // Freeze minimum 1 TRX (1,000,000 Sun)
      const txHash = await freezeBalanceV2("1000000", "BANDWIDTH", "nile");
      expect(typeof txHash).toBe("string");
      expect(txHash.length).toBeGreaterThan(0);
      console.error(`Freeze TX: ${txHash}`);
    },
    60_000,
  );

  it.skipIf(!ALLOW_STAKING)(
    "should freeze TRX for ENERGY and return a tx hash",
    async () => {
      const txHash = await freezeBalanceV2("1000000", "ENERGY", "nile");
      expect(typeof txHash).toBe("string");
      console.error(`Freeze ENERGY TX: ${txHash}`);
    },
    60_000,
  );
});

describe("unfreezeBalanceV2 (write — skipped by default)", () => {
  it.skipIf(!ALLOW_STAKING)(
    "should unfreeze TRX and return a tx hash",
    async () => {
      const txHash = await unfreezeBalanceV2("1000000", "BANDWIDTH", "nile");
      expect(typeof txHash).toBe("string");
      console.error(`Unfreeze TX: ${txHash}`);
    },
    60_000,
  );
});

describe("withdrawExpireUnfreeze (write — skipped by default)", () => {
  it.skipIf(!ALLOW_STAKING)(
    "should withdraw expired unfreeze and return a tx hash",
    async () => {
      const txHash = await withdrawExpireUnfreeze("nile");
      expect(typeof txHash).toBe("string");
      console.error(`Withdraw TX: ${txHash}`);
    },
    60_000,
  );
});
