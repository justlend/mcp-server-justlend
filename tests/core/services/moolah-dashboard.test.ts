import { describe, it, expect } from "vitest";
import { getMoolahDashboard } from "../../../src/core/services/moolah-dashboard.js";
import { skipOn429 } from "../../helpers.js";

// Dashboard composition — mainnet read-only. Verifies the flattened shape
// matches the consumer contract used by the MCP tool layer.

describe("getMoolahDashboard (mainnet)", () => {
  it("returns vaults/markets arrays with totals", skipOn429(async () => {
    const dash = await getMoolahDashboard({ vaultPageSize: 2, marketPageSize: 2, network: "mainnet" });
    expect(Array.isArray(dash.vaults)).toBe(true);
    expect(Array.isArray(dash.markets)).toBe(true);
    expect(typeof dash.totalVaults).toBe("number");
    expect(typeof dash.totalMarkets).toBe("number");
    expect(dash.totalVaults >= dash.vaults.length).toBe(true);
    expect(dash.totalMarkets >= dash.markets.length).toBe(true);
  }));

  it("respects page size caps", skipOn429(async () => {
    const dash = await getMoolahDashboard({ vaultPageSize: 2, marketPageSize: 2, network: "mainnet" });
    expect(dash.vaults.length).toBeLessThanOrEqual(2);
    expect(dash.markets.length).toBeLessThanOrEqual(2);
  }));
});
