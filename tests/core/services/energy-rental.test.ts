/**
 * Tests for energy-rental.ts.
 *
 * Read-only tests make real API/RPC calls to mainnet (rate-limited without TRONGRID_API_KEY).
 * Write tests are skipped unless TRON_PRIVATE_KEY is set AND TEST_ENERGY_RENTAL=1.
 */
import { describe, it, expect } from "vitest";
import {
  getEnergyRentalDashboard,
  getEnergyRentalParams,
  getRentalRate,
  calculateRentalPrice,
  getUserRentalOrders,
  getRentInfo,
  getReturnRentalInfo,
  rentEnergy,
  returnEnergyRental,
} from "../../../src/core/services/energy-rental.js";
import { skipOn429 } from "../../helpers.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A known address with rental activity (JustLend contract itself is fine for reads)
const TEST_ADDRESS = "TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5";

const ALLOW_WRITE = Boolean(
  process.env.TRON_PRIVATE_KEY && process.env.TEST_ENERGY_RENTAL === "1",
);

// ============================================================================
// Module Exports
// ============================================================================

describe("energy-rental module exports", () => {
  it("getEnergyRentalDashboard is a function", () => {
    expect(typeof getEnergyRentalDashboard).toBe("function");
  });

  it("getEnergyRentalParams is a function", () => {
    expect(typeof getEnergyRentalParams).toBe("function");
  });

  it("getRentalRate is a function", () => {
    expect(typeof getRentalRate).toBe("function");
  });

  it("calculateRentalPrice is a function", () => {
    expect(typeof calculateRentalPrice).toBe("function");
  });

  it("getUserRentalOrders is a function", () => {
    expect(typeof getUserRentalOrders).toBe("function");
  });

  it("getRentInfo is a function", () => {
    expect(typeof getRentInfo).toBe("function");
  });

  it("getReturnRentalInfo is a function", () => {
    expect(typeof getReturnRentalInfo).toBe("function");
  });

  it("rentEnergy is a function", () => {
    expect(typeof rentEnergy).toBe("function");
  });

  it("returnEnergyRental is a function", () => {
    expect(typeof returnEnergyRental).toBe("function");
  });
});

// ============================================================================
// API Read Tests (Integration — needs network)
// ============================================================================

describe("getEnergyRentalDashboard (Mainnet)", () => {
  it("should return dashboard data with required fields", skipOn429(async () => {
    const data = await getEnergyRentalDashboard("mainnet");

    expect(data).toBeDefined();
    expect(Number(data.trxPrice)).toBeGreaterThan(0);
    expect(data.exchangeRate).toBeDefined();
    expect(Number(data.totalApy)).toBeGreaterThanOrEqual(0);
    expect(Number(data.energyStakePerTrx)).toBeGreaterThan(0);
    expect(data.sTrx1Trx).toBeDefined();
    expect(data.trx1sTrx).toBeDefined();
    console.log(`Dashboard: TRX price=$${data.trxPrice}, APY=${data.totalApy}%, energyPerTRX=${data.energyStakePerTrx}`);
  }), 30_000);
});

describe("getEnergyRentalParams (Mainnet)", () => {
  it("should return on-chain rental parameters", skipOn429(async () => {
    await delay(2000);
    const params = await getEnergyRentalParams("mainnet");

    expect(params).toBeDefined();
    expect(typeof params.liquidateThreshold).toBe("number");
    expect(params.liquidateThreshold).toBeGreaterThan(0);
    expect(typeof params.feeRatio).toBe("number");
    expect(params.feeRatio).toBeGreaterThan(0);
    expect(typeof params.minFee).toBe("number");
    expect(params.minFee).toBeGreaterThan(0);
    expect(typeof params.totalDelegated).toBe("number");
    expect(typeof params.totalFrozen).toBe("number");
    expect(typeof params.maxRentable).toBe("number");
    expect(typeof params.rentPaused).toBe("boolean");
    expect(typeof params.usageChargeRatio).toBe("number");
    console.log(`Params: threshold=${params.liquidateThreshold}s, feeRatio=${params.feeRatio}, minFee=${params.minFee} TRX, paused=${params.rentPaused}`);
  }), 30_000);
});

describe("getRentalRate (Mainnet)", () => {
  it("should return rental rate for a given TRX amount", skipOn429(async () => {
    await delay(2000);
    const rate = await getRentalRate(10000, "mainnet");

    expect(rate).toBeDefined();
    expect(typeof rate.rentalRate).toBe("number");
    expect(typeof rate.stableRate).toBe("number");
    expect(typeof rate.effectiveRate).toBe("number");
    expect(rate.effectiveRate).toBeGreaterThan(0);
    expect(rate.effectiveRate).toBe(Math.max(rate.rentalRate, rate.stableRate));
    console.log(`Rate: rental=${rate.rentalRate}, stable=${rate.stableRate}, effective=${rate.effectiveRate}`);
  }), 30_000);
});

describe("calculateRentalPrice (Mainnet)", () => {
  it("should calculate rental cost for 300k energy, 7 days", skipOn429(async () => {
    await delay(3000);
    const estimate = await calculateRentalPrice(300000, 7 * 86400, "mainnet");

    expect(estimate).toBeDefined();
    expect(estimate.energyAmount).toBe(300000);
    expect(estimate.durationSeconds).toBe(604800);
    expect(typeof estimate.trxAmount).toBe("number");
    expect(estimate.trxAmount).toBeGreaterThan(0);
    expect(typeof estimate.rate).toBe("number");
    expect(estimate.rate).toBeGreaterThan(0);
    expect(typeof estimate.fee).toBe("number");
    expect(estimate.fee).toBeGreaterThan(0);
    expect(typeof estimate.totalPrepayment).toBe("number");
    expect(estimate.totalPrepayment).toBeGreaterThan(0);
    expect(typeof estimate.securityDeposit).toBe("number");
    expect(typeof estimate.dailyRentalCost).toBe("number");
    console.log(`Price: ${estimate.trxAmount} TRX, prepayment=${estimate.totalPrepayment.toFixed(2)} TRX, daily=${estimate.dailyRentalCost.toFixed(2)} TRX`);
  }), 30_000);
});

describe("getUserRentalOrders (Mainnet)", () => {
  it("should return order list structure", skipOn429(async () => {
    await delay(2000);
    const data = await getUserRentalOrders(TEST_ADDRESS, "all", 0, 5, "mainnet");

    expect(data).toBeDefined();
    // May have orders or not, but structure should be correct
    if (data.orders) {
      expect(data.orders).toBeInstanceOf(Array);
    }
    if (data.total !== undefined) {
      expect(typeof data.total).toBe("number");
    }
    console.log(`Orders: ${data.total || 0} total`);
  }), 30_000);
});

describe("getRentInfo (Mainnet)", () => {
  it("should return rent info for a renter-receiver pair", skipOn429(async () => {
    await delay(2000);
    const info = await getRentInfo(TEST_ADDRESS, TEST_ADDRESS, "mainnet");

    expect(info).toBeDefined();
    expect(typeof info.securityDeposit).toBe("number");
    expect(typeof info.rentBalance).toBe("number");
    expect(typeof info.hasActiveRental).toBe("boolean");
    console.log(`RentInfo: deposit=${info.securityDeposit}, balance=${info.rentBalance}, active=${info.hasActiveRental}`);
  }), 30_000);
});

// ============================================================================
// Write Tests (skipped by default)
// ============================================================================

describe("rentEnergy (write — skipped by default)", () => {
  it.skipIf(!ALLOW_WRITE)(
    "should rent energy and return tx hash",
    async () => {
      const privateKey = process.env.TRON_PRIVATE_KEY!;
      // Rent minimal energy for 1 day on nile testnet
      const result = await rentEnergy(
        privateKey,
        process.env.TEST_RECEIVER_ADDRESS || TEST_ADDRESS,
        100000,
        86400,
        "nile",
      );
      expect(result.txId).toBeDefined();
      expect(typeof result.txId).toBe("string");
      console.log(`Rent TX: ${result.txId}`);
    },
    120_000,
  );
});

describe("returnEnergyRental (write — skipped by default)", () => {
  it.skipIf(!ALLOW_WRITE)(
    "should return energy rental and return tx hash",
    async () => {
      const privateKey = process.env.TRON_PRIVATE_KEY!;
      const result = await returnEnergyRental(
        privateKey,
        process.env.TEST_RECEIVER_ADDRESS || TEST_ADDRESS,
        "renter",
        "nile",
      );
      expect(result.txId).toBeDefined();
      expect(typeof result.txId).toBe("string");
      console.log(`Return TX: ${result.txId}`);
    },
    120_000,
  );
});
