import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetChainParameters = vi.fn();

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => ({
    trx: {
      getChainParameters: mockGetChainParameters,
    },
  })),
}));

import {
  clearResourcePriceCache,
  getResourcePrices,
} from "../../../src/core/services/resource-prices.js";

describe("resource prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearResourcePriceCache();
  });

  it("reads live chain parameters and caches them per network", async () => {
    mockGetChainParameters.mockResolvedValueOnce([
      { key: "getEnergyFee", value: 321 },
      { key: "getTransactionFee", value: 999 },
      { key: "getFreeNetLimit", value: 777 },
    ]);

    const first = await getResourcePrices("mainnet");
    const second = await getResourcePrices("mainnet");

    expect(first).toEqual({
      energyPriceSun: 321,
      bandwidthPriceSun: 999,
      freeBandwidthPerDay: 777,
      sunPerTRX: 1_000_000,
      source: "chain",
    });
    expect(second).toEqual(first);
    expect(mockGetChainParameters).toHaveBeenCalledTimes(1);
  });

  it("falls back to shared defaults when live parameters are unavailable", async () => {
    mockGetChainParameters.mockRejectedValueOnce(new Error("rpc unavailable"));

    await expect(getResourcePrices("nile")).resolves.toEqual({
      energyPriceSun: 420,
      bandwidthPriceSun: 1000,
      freeBandwidthPerDay: 600,
      sunPerTRX: 1_000_000,
      source: "fallback",
    });
  });
});
