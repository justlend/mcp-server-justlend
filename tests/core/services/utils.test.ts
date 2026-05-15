/**
 * Unit tests for utils.ts — pure functions, no network calls.
 */
import { describe, it, expect } from "vitest";
import { utils, expandScientificNotation } from "../../../src/core/services/utils.js";

describe("utils.toSun", () => {
  it("converts 1 TRX to 1,000,000 Sun", () => {
    expect(utils.toSun(1)).toBe("1000000");
  });

  it("converts 0.5 TRX to 500,000 Sun", () => {
    expect(utils.toSun("0.5")).toBe("500000");
  });

  it("converts 0 TRX to 0 Sun", () => {
    expect(utils.toSun(0)).toBe("0");
  });

  it("converts a large amount", () => {
    expect(utils.toSun(1000)).toBe("1000000000");
  });
});

describe("utils.fromSun", () => {
  it("converts 1,000,000 Sun to 1 TRX", () => {
    expect(utils.fromSun(1_000_000)).toBe("1");
  });

  it("converts 500,000 Sun to 0.5 TRX", () => {
    expect(utils.fromSun(500_000)).toBe("0.5");
  });

  it("converts 0 Sun to 0 TRX", () => {
    expect(utils.fromSun(0)).toBe("0");
  });

  it("accepts bigint input", () => {
    expect(utils.fromSun(1_000_000n)).toBe("1");
  });

  it("accepts string input", () => {
    expect(utils.fromSun("2000000")).toBe("2");
  });

  it("round-trips with toSun", () => {
    const sun = utils.toSun(42);
    expect(utils.fromSun(sun)).toBe("42");
  });
});

describe("utils.formatBigInt", () => {
  it("stringifies a bigint", () => {
    expect(utils.formatBigInt(123n)).toBe("123");
  });

  it("stringifies a regular number", () => {
    expect(utils.formatBigInt(456)).toBe("456");
  });
});

describe("utils.formatJson", () => {
  it("serialises a plain object", () => {
    const result = utils.formatJson({ a: 1, b: "two" });
    expect(JSON.parse(result)).toEqual({ a: 1, b: "two" });
  });

  it("converts bigint values to strings", () => {
    const result = utils.formatJson({ amount: 1_000_000n });
    expect(JSON.parse(result)).toEqual({ amount: "1000000" });
  });

  it("handles nested bigints", () => {
    const result = utils.formatJson({ nested: { value: 99n } });
    expect(JSON.parse(result)).toEqual({ nested: { value: "99" } });
  });
});

describe("utils.hexToNumber", () => {
  it("converts 0xff to 255", () => {
    expect(utils.hexToNumber("ff")).toBe(255);
  });

  it("converts 0x0 to 0", () => {
    expect(utils.hexToNumber("0")).toBe(0);
  });

  it("converts a block number hex", () => {
    expect(utils.hexToNumber("1a")).toBe(26);
  });
});

describe("utils.numberToHex", () => {
  it("converts 255 to 0xff", () => {
    expect(utils.numberToHex(255)).toBe("0xff");
  });

  it("converts 0 to 0x0", () => {
    expect(utils.numberToHex(0)).toBe("0x0");
  });

  it("round-trips with hexToNumber", () => {
    const hex = utils.numberToHex(1234);
    expect(utils.hexToNumber(hex.replace("0x", ""))).toBe(1234);
  });
});

describe("utils.isAddress", () => {
  it("returns true for a valid TRON Base58 address", () => {
    expect(utils.isAddress("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb")).toBe(true);
  });

  it("returns false for a random string", () => {
    expect(utils.isAddress("not-an-address")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(utils.isAddress("")).toBe(false);
  });
});

describe("utils.formatNumber", () => {
  it("formats a number with comma separators", () => {
    const result = utils.formatNumber(1_000_000);
    expect(result).toContain("1");
    expect(result).toContain("000");
  });

  it("accepts a string input", () => {
    const result = utils.formatNumber("9999");
    expect(typeof result).toBe("string");
  });
});

describe("utils.formatUnits", () => {
  it("formats large values without Number precision loss", () => {
    expect(utils.formatUnits(900719925474099312345678901234n, 6)).toBe("900719925474099312345678.901234");
  });
});

describe("utils.parseUnits", () => {
  it("parses decimal strings into bigint precisely", () => {
    expect(utils.parseUnits("900719925474099312345678.901234", 6)).toBe(900719925474099312345678901234n);
  });

  // Regression: high-TVL JustLend exchangeRate values arrive as JS numbers ≥ 1e21,
  // which `.toString()` / `.toFixed(18)` render in scientific notation. The previous
  // parseUnits rejected those and threw "Invalid numeric value: \"3.88...e+24\"",
  // which propagated up through getAccountSummary as an opaque error.
  it("accepts positive scientific-notation strings", () => {
    expect(utils.parseUnits("3.88807391354968e+24", 0)).toBe(
      utils.parseUnits("3888073913549680000000000", 0),
    );
  });

  it("accepts unsigned-exponent scientific notation", () => {
    expect(utils.parseUnits("1.5e10", 0)).toBe(15_000_000_000n);
  });

  it("accepts negative-exponent scientific notation", () => {
    expect(utils.parseUnits("1.5e-3", 6)).toBe(1500n);
  });

  it("accepts negative-value scientific notation", () => {
    expect(utils.parseUnits("-2.5e3", 0)).toBe(-2500n);
  });

  it("still rejects garbage strings", () => {
    expect(() => utils.parseUnits("not-a-number", 0)).toThrow(/Invalid numeric value/);
  });
});

describe("expandScientificNotation", () => {
  it("returns plain decimals unchanged", () => {
    expect(expandScientificNotation("123.456")).toBe("123.456");
    expect(expandScientificNotation("-0")).toBe("-0");
  });

  it("expands large exponents", () => {
    expect(expandScientificNotation("1.0279569798944131e+26")).toBe("102795697989441310000000000");
  });

  it("expands small exponents into a leading 0.", () => {
    expect(expandScientificNotation("1.5e-3")).toBe("0.0015");
    expect(expandScientificNotation("9e-1")).toBe("0.9");
  });

  it("preserves sign on negative values", () => {
    expect(expandScientificNotation("-3.88e+24")).toBe("-3880000000000000000000000");
    expect(expandScientificNotation("-1e-2")).toBe("-0.01");
  });

  it("returns malformed scientific strings unchanged (parseUnits handles rejection)", () => {
    expect(expandScientificNotation("e10")).toBe("e10");
  });
});
