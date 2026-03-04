/**
 * Unit tests for utils.ts — pure functions, no network calls.
 */
import { describe, it, expect } from "vitest";
import { utils } from "../../../src/core/services/utils.js";

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
