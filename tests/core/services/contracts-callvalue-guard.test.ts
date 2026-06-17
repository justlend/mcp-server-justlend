import { describe, it, expect } from "vitest";
import { callValueToSafeNumber } from "../../../src/core/services/contracts.js";

// Number.MAX_SAFE_INTEGER = 9_007_199_254_740_991 ≈ 9.007e15 sun ≈ 9 billion TRX.
// Past this value the `Number()` cast required by TronWeb silently truncates.

describe("callValueToSafeNumber", () => {
  it("accepts zero", () => {
    expect(callValueToSafeNumber(0)).toBe(0);
    expect(callValueToSafeNumber("0")).toBe(0);
    expect(callValueToSafeNumber(0n)).toBe(0);
  });

  it("accepts values up to and including MAX_SAFE_INTEGER", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(callValueToSafeNumber(max)).toBe(max);
    expect(callValueToSafeNumber(max.toString())).toBe(max);
    expect(callValueToSafeNumber(BigInt(max))).toBe(max);
  });

  it("rejects values one past MAX_SAFE_INTEGER", () => {
    const tooBig = "9007199254740992"; // MAX_SAFE_INTEGER + 1
    expect(() => callValueToSafeNumber(tooBig)).toThrow(/callValue exceeds the safe SDK limit/);
    expect(() => callValueToSafeNumber(BigInt(tooBig))).toThrow(/callValue exceeds the safe SDK limit/);
  });

  it("rejects values far past MAX_SAFE_INTEGER (e.g. 10 billion TRX in sun)", () => {
    const tenBillionTrxSun = "10000000000000000"; // 1e16 sun
    expect(() => callValueToSafeNumber(tenBillionTrxSun)).toThrow(/callValue exceeds the safe SDK limit/);
  });

  it("rejects negative values", () => {
    expect(() => callValueToSafeNumber(-1)).toThrow(/callValue cannot be negative/);
    expect(() => callValueToSafeNumber("-1000000")).toThrow(/callValue cannot be negative/);
  });

  it("error message mentions the offending value", () => {
    const tooBig = "123456789012345678";
    expect(() => callValueToSafeNumber(tooBig)).toThrow(new RegExp(tooBig));
  });
});
