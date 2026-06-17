import { describe, it, expect } from "vitest";
import { describeAmount, describeFromDisplay } from "../../../src/core/services/bigint-math.js";

describe("describeAmount", () => {
  it("builds a self-describing amount from raw base units", () => {
    expect(describeAmount(5000000000n, 6, "USDT")).toEqual({
      raw: "5000000000",
      decimals: 6,
      _unit: "USDT",
      display: "5000",
    });
  });

  it("accepts a raw string and keeps full precision", () => {
    expect(describeAmount("1000000000000000000000", 18, "sTRX")).toEqual({
      raw: "1000000000000000000000",
      decimals: 18,
      _unit: "sTRX",
      display: "1000",
    });
  });
});

describe("describeFromDisplay", () => {
  it("reconstructs raw exactly from a de-scaled display string", () => {
    expect(describeFromDisplay("5000.12", 6, "USDT")).toEqual({
      raw: "5000120000",
      decimals: 6,
      _unit: "USDT",
      display: "5000.12",
    });
  });

  it("pads fractional digits up to decimals", () => {
    expect(describeFromDisplay("1.5", 8, "jTRX")).toEqual({
      raw: "150000000",
      decimals: 8,
      _unit: "jTRX",
      display: "1.5",
    });
  });

  it("handles integer-only and zero-decimals inputs", () => {
    expect(describeFromDisplay("100", 6, "TRX").raw).toBe("100000000");
    expect(describeFromDisplay("42", 0, "ENERGY")).toEqual({
      raw: "42",
      decimals: 0,
      _unit: "ENERGY",
      display: "42",
    });
  });

  it("truncates fractional digits beyond decimals (round-trips its own display)", () => {
    const d = describeFromDisplay("1.23456789", 6, "USDT");
    expect(d.raw).toBe("1234567");
    expect(describeFromDisplay(d.display, 6, "USDT").raw).toBe(d.raw);
  });
});
