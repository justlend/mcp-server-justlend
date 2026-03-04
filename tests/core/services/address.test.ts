/**
 * Unit tests for address.ts — pure functions, no network calls.
 */
import { describe, it, expect } from "vitest";
import {
  toHexAddress,
  toBase58Address,
  isBase58,
  isHex,
  resolveAddress,
} from "../../../src/core/services/address.js";

// Known mainnet addresses in both formats
const BASE58 = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const HEX_41 = "410000000000000000000000000000000000000000"; // TRON zero address (41…)
const USDT_BASE58 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

describe("toHexAddress", () => {
  it("converts a Base58 address to hex", () => {
    const hex = toHexAddress(BASE58);
    expect(hex).toMatch(/^41[0-9a-fA-F]{40}$/);
  });

  it("returns a hex address unchanged", () => {
    const hex = toHexAddress(BASE58);
    expect(toHexAddress(hex)).toBe(hex);
  });

  it("converts USDT Base58 to hex", () => {
    const hex = toHexAddress(USDT_BASE58);
    expect(hex.startsWith("41")).toBe(true);
  });
});

describe("toBase58Address", () => {
  it("converts a 41-prefixed hex address to Base58", () => {
    const hex = toHexAddress(BASE58);
    const back = toBase58Address(hex);
    expect(back).toBe(BASE58);
  });

  it("returns a Base58 address unchanged", () => {
    expect(toBase58Address(BASE58)).toBe(BASE58);
  });

  it("round-trips USDT address", () => {
    const hex = toHexAddress(USDT_BASE58);
    const back = toBase58Address(hex);
    expect(back).toBe(USDT_BASE58);
  });
});

describe("isBase58", () => {
  it("returns true for a valid Base58 TRON address", () => {
    expect(isBase58(BASE58)).toBe(true);
  });

  it("returns false for a hex address", () => {
    const hex = toHexAddress(BASE58);
    expect(isBase58(hex)).toBe(false);
  });

  it("returns false for a random string", () => {
    expect(isBase58("not-an-address")).toBe(false);
  });

  it("returns false for an ETH-style address", () => {
    expect(isBase58("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false);
  });
});

describe("isHex", () => {
  it("returns true for a valid 41-prefixed hex address", () => {
    const hex = toHexAddress(BASE58);
    expect(isHex(hex)).toBe(true);
  });

  it("returns false for a Base58 address", () => {
    expect(isHex(BASE58)).toBe(false);
  });

  it("returns false for a random string", () => {
    expect(isHex("zzzz")).toBe(false);
  });
});

describe("resolveAddress", () => {
  it("returns the address unchanged if it is a valid TRON address", async () => {
    const resolved = await resolveAddress(BASE58);
    expect(resolved).toBe(BASE58);
  });

  it("throws for an invalid address / unsupported name", async () => {
    await expect(resolveAddress("invalid.tron")).rejects.toThrow(
      "Invalid address or unsupported name service",
    );
  });

  it("throws for an empty string", async () => {
    await expect(resolveAddress("")).rejects.toThrow();
  });
});
