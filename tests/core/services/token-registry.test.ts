import { describe, expect, it } from "vitest";

import { resolveKnownToken } from "../../../src/core/services/tokens.js";

describe("resolveKnownToken", () => {
  it("resolves underlying symbols to their TRC20 contract addresses", () => {
    expect(resolveKnownToken("USDT", "mainnet")).toEqual({
      input: "USDT",
      address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      symbol: "USDT",
      decimals: 6,
      resolution: "symbol",
    });
  });

  it("resolves symbols without requiring a jToken prefix", () => {
    expect(resolveKnownToken("wstUSDT", "mainnet")).toEqual({
      input: "wstUSDT",
      address: "TGkxzkDKyMeq2T7edKnyjZoFypyzjkkssq",
      symbol: "wstUSDT",
      decimals: 18,
      resolution: "symbol",
    });
  });

  it("returns null for unknown symbols", () => {
    expect(resolveKnownToken("DOGE", "mainnet")).toBeNull();
  });
});
