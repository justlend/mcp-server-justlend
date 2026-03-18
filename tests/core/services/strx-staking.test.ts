/**
 * Tests for strx-staking.ts.
 *
 * Read-only tests make real API/RPC calls to mainnet (rate-limited without TRONGRID_API_KEY).
 * Write tests are skipped unless TRON_PRIVATE_KEY is set AND TEST_STRX_STAKING=1.
 */
import { describe, it, expect } from "vitest";
import {
  getStrxDashboard,
  getStrxStakeAccount,
  getStrxBalance,
  stakeTrxToStrx,
  unstakeStrx,
  claimStrxRewards,
  checkWithdrawalEligibility,
} from "../../../src/core/services/strx-staking.js";
import { skipOn429 } from "../../helpers.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// sTRX proxy contract — valid address for balance queries
const STRX_PROXY = "TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5";
// A known address (zero balance is fine for structure tests)
const TEST_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

const ALLOW_WRITE = Boolean(
  process.env.TRON_PRIVATE_KEY && process.env.TEST_STRX_STAKING === "1",
);

// ============================================================================
// Module Exports
// ============================================================================

describe("strx-staking module exports", () => {
  it("getStrxDashboard is a function", () => {
    expect(typeof getStrxDashboard).toBe("function");
  });

  it("getStrxStakeAccount is a function", () => {
    expect(typeof getStrxStakeAccount).toBe("function");
  });

  it("getStrxBalance is a function", () => {
    expect(typeof getStrxBalance).toBe("function");
  });

  it("stakeTrxToStrx is a function", () => {
    expect(typeof stakeTrxToStrx).toBe("function");
  });

  it("unstakeStrx is a function", () => {
    expect(typeof unstakeStrx).toBe("function");
  });

  it("claimStrxRewards is a function", () => {
    expect(typeof claimStrxRewards).toBe("function");
  });

  it("checkWithdrawalEligibility is a function", () => {
    expect(typeof checkWithdrawalEligibility).toBe("function");
  });
});

// ============================================================================
// API Read Tests (Integration — needs network)
// ============================================================================

describe("getStrxDashboard (Mainnet)", () => {
  it("should return dashboard data with required fields", skipOn429(async () => {
    const data = await getStrxDashboard("mainnet");

    expect(data).toBeDefined();
    expect(Number(data.trxPrice)).toBeGreaterThan(0);
    expect(data.exchangeRate).toBeDefined();
    expect(Number(data.totalApy)).toBeGreaterThanOrEqual(0);
    expect(Number(data.voteApy)).toBeGreaterThanOrEqual(0);
    expect(data.totalSupply).toBeDefined();
    expect(Number(data.unfreezeDelayDays)).toBeGreaterThan(0);
    expect(Number(data.energyStakePerTrx)).toBeGreaterThan(0);
    expect(data.sTrx1Trx).toBeDefined();
    expect(data.trx1sTrx).toBeDefined();
    console.error(`sTRX Dashboard: price=$${data.trxPrice}, APY=${data.totalApy}%, delay=${data.unfreezeDelayDays}d`);
  }), 30_000);
});

describe("getStrxStakeAccount (Mainnet)", () => {
  it("should return account data with required fields", skipOn429(async () => {
    await delay(2000);
    const data = await getStrxStakeAccount(TEST_ADDRESS, "mainnet");

    expect(data).toBeDefined();
    // For any address, these fields should exist (may be 0 for non-stakers)
    expect(data.accountSupply).toBeDefined();
    expect(data.accountIncome).toBeDefined();
    expect(data.accountCanClaimAmount).toBeDefined();
    expect(data.accountWithDrawAmount).toBeDefined();
    console.error(`sTRX Account: supply=${data.accountSupply}, income=${data.accountIncome}, claimable=${data.accountCanClaimAmount}`);
  }), 30_000);
});

describe("getStrxBalance (Mainnet)", () => {
  it("should return sTRX balance with token info", skipOn429(async () => {
    await delay(2000);
    const balance = await getStrxBalance(TEST_ADDRESS, "mainnet");

    expect(balance).toBeDefined();
    expect(typeof balance.raw).toBe("bigint");
    expect(balance.raw).toBeGreaterThanOrEqual(0n);
    expect(typeof balance.formatted).toBe("string");
    expect(balance.symbol).toBe("sTRX");
    expect(balance.decimals).toBe(18);
    console.error(`sTRX Balance: ${balance.formatted} sTRX`);
  }), 30_000);

  it("should handle sTRX proxy contract address (self-balance)", skipOn429(async () => {
    await delay(2000);
    const balance = await getStrxBalance(STRX_PROXY, "mainnet");
    expect(balance).toBeDefined();
    expect(typeof balance.raw).toBe("bigint");
    console.error(`sTRX Proxy self-balance: ${balance.formatted} sTRX`);
  }), 30_000);
});

describe("checkWithdrawalEligibility (Mainnet)", () => {
  it("should return eligibility info with required fields", skipOn429(async () => {
    await delay(3000);
    const eligibility = await checkWithdrawalEligibility(TEST_ADDRESS, "mainnet");

    expect(eligibility).toBeDefined();
    expect(eligibility.address).toBe(TEST_ADDRESS);
    expect(typeof eligibility.hasStakedTrx).toBe("boolean");
    expect(typeof eligibility.stakedAmount).toBe("number");
    expect(typeof eligibility.totalIncome).toBe("number");
    expect(typeof eligibility.claimableRewards).toBe("number");
    expect(typeof eligibility.withdrawnAmount).toBe("number");
    expect(typeof eligibility.pendingUnstakeRounds).toBe("number");
    expect(typeof eligibility.completedUnstakeRounds).toBe("number");
    expect(typeof eligibility.hasCompletedWithdrawals).toBe("boolean");
    expect(typeof eligibility.unfreezeDelayDays).toBe("number");
    expect(eligibility.roundDetails).toBeInstanceOf(Array);
    console.error(`Eligibility: staked=${eligibility.hasStakedTrx}, pending=${eligibility.pendingUnstakeRounds}, completed=${eligibility.completedUnstakeRounds}`);
  }), 30_000);
});

// ============================================================================
// Write Tests (skipped by default)
// ============================================================================

describe("stakeTrxToStrx (write — skipped by default)", () => {
  it.skipIf(!ALLOW_WRITE)(
    "should stake TRX and return tx hash",
    async () => {
      const privateKey = process.env.TRON_PRIVATE_KEY!;
      // Stake minimum 1 TRX on nile testnet
      const result = await stakeTrxToStrx(privateKey, 1, "nile");
      expect(result.txId).toBeDefined();
      expect(typeof result.txId).toBe("string");
      expect(result.stakedTrx).toBe(1);
      console.error(`Stake TX: ${result.txId}`);
    },
    120_000,
  );
});

describe("unstakeStrx (write — skipped by default)", () => {
  it.skipIf(!ALLOW_WRITE)(
    "should unstake sTRX and return tx hash",
    async () => {
      const privateKey = process.env.TRON_PRIVATE_KEY!;
      const result = await unstakeStrx(privateKey, 0.5, "nile");
      expect(result.txId).toBeDefined();
      expect(typeof result.txId).toBe("string");
      expect(result.unstakedStrx).toBe(0.5);
      expect(result.note).toContain("unbonding");
      console.error(`Unstake TX: ${result.txId}`);
    },
    120_000,
  );
});

describe("claimStrxRewards (write — skipped by default)", () => {
  it.skipIf(!ALLOW_WRITE)(
    "should claim rewards and return tx hash",
    async () => {
      const privateKey = process.env.TRON_PRIVATE_KEY!;
      const result = await claimStrxRewards(privateKey, "nile");
      expect(result.txId).toBeDefined();
      expect(typeof result.txId).toBe("string");
      console.error(`Claim TX: ${result.txId}`);
    },
    120_000,
  );
});
