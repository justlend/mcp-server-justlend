import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/core/services/resource-prices.js", () => ({
  getResourcePrices: vi.fn(async () => ({
    energyPriceSun:    210,
    bandwidthPriceSun: 1000,
    sunPerTRX:         1_000_000,
  })),
}));
vi.mock("../../../src/core/services/lending.js", () => ({
  checkResourceSufficiency: vi.fn(async () => ({ warning: false })),
}));

import { estimateMoolahEnergy, MOOLAH_TYPICAL_RESOURCES } from "../../../src/core/services/moolah-estimate.js";

describe("estimateMoolahEnergy", () => {
  it("returns energy/bandwidth/TRX cost for each canonical operation", async () => {
    const ops = [
      "vault_deposit", "vault_withdraw", "vault_redeem", "approve_vault",
      "supply_collateral", "withdraw_collateral", "borrow", "repay", "approve_proxy",
      "liquidate", "approve_liquidator",
    ] as const;
    for (const op of ops) {
      const res = await estimateMoolahEnergy({ operation: op, isTRX: false, network: "mainnet" });
      expect(res.operation).toBe(op);
      expect(res.energy).toBeGreaterThan(0);
      expect(res.bandwidth).toBeGreaterThan(0);
      expect(res.source).toBe("typical");
      expect(parseFloat(res.estimatedTRXCost)).toBeGreaterThan(0);
    }
  });

  it("routes TRX variants to the cheaper TrxProviderProxy bucket", async () => {
    const trxDeposit = await estimateMoolahEnergy({ operation: "vault_deposit", isTRX: true });
    const trc20Deposit = await estimateMoolahEnergy({ operation: "vault_deposit", isTRX: false });
    expect(trxDeposit.energy).toBeLessThan(trc20Deposit.energy);

    const trxRepay = await estimateMoolahEnergy({ operation: "repay", isTRX: true });
    const trc20Repay = await estimateMoolahEnergy({ operation: "repay", isTRX: false });
    expect(trxRepay.energy).toBeLessThan(trc20Repay.energy);

    const trxCollat = await estimateMoolahEnergy({ operation: "supply_collateral", isTRX: true });
    const trc20Collat = await estimateMoolahEnergy({ operation: "supply_collateral", isTRX: false });
    expect(trxCollat.energy).toBeLessThan(trc20Collat.energy);
  });

  it("estimatedTRXCost matches the internal breakdown (3-decimal formatting allows rounding drift)", async () => {
    const res = await estimateMoolahEnergy({ operation: "borrow" });
    const energy    = parseFloat(res.costBreakdown.energyCostTRX);
    const bandwidth = parseFloat(res.costBreakdown.bandwidthCostTRX);
    const total     = parseFloat(res.estimatedTRXCost);
    // Allow 0.002 TRX tolerance for 3-decimal formatting
    expect(Math.abs(total - (energy + bandwidth))).toBeLessThanOrEqual(0.002);
  });

  it("typical table has 14 keys covering every route variant", () => {
    expect(Object.keys(MOOLAH_TYPICAL_RESOURCES).sort()).toEqual([
      "approve_liquidator",
      "approve_proxy",
      "approve_vault",
      "borrow",
      "liquidate",
      "repay_trc20",
      "repay_trx",
      "supply_collateral_trc20",
      "supply_collateral_trx",
      "vault_deposit_trc20",
      "vault_deposit_trx",
      "vault_redeem",
      "vault_withdraw",
      "withdraw_collateral",
    ]);
  });
});
