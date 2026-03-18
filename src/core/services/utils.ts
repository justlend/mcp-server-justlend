import { TronWeb } from "tronweb";

/**
 * Utility functions for formatting and converting TRON values.
 * 1 TRX = 1,000,000 SUN
 */
export const utils = {
  /** Convert TRX to Sun (smallest unit). */
  toSun: (trx: number | string): string => {
    return TronWeb.toSun(trx as any).toString();
  },

  /** Convert Sun to TRX. */
  fromSun: (sun: number | string | bigint): string => {
    return TronWeb.fromSun(sun.toString() as any).toString();
  },

  /** Stringify a bigint or number. */
  formatBigInt: (value: bigint | number): string => value.toString(),

  /** JSON-serialize an object, converting BigInts to strings. */
  formatJson: (obj: unknown): string =>
    JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2),

  /** Format a number with locale comma separators. */
  formatNumber: (value: number | string): string => Number(value).toLocaleString(),

  /** Convert a hex string to a decimal number. */
  hexToNumber: (hex: string): number => parseInt(hex, 16),

  /** Convert a decimal number to a hex string (0x-prefixed). */
  numberToHex: (num: number): string => "0x" + num.toString(16),

  /** Check whether a string is a valid TRON address. */
  isAddress: (address: string): boolean => TronWeb.isAddress(address),

  /**
   * Format a raw BigInt/string amount into a human-readable decimal string.
   * Inverse of parseUnits. Example: formatUnits("1500000000000000000", 18) => "1.5"
   */
  formatUnits: (value: string | bigint, decimals: number): string => {
    const s = value.toString();
    if (decimals === 0) return s;
    const padded = s.padStart(decimals + 1, "0");
    const intPart = padded.slice(0, padded.length - decimals);
    const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  },

  /**
   * Parse a human-readable decimal string into a BigInt of the smallest unit.
   * Uses pure string manipulation to avoid IEEE-754 floating-point precision loss.
   * Example: parseUnits("1.5", 18) => 1500000000000000000n
   */
  parseUnits: (value: string, decimals: number): bigint => {
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Invalid numeric value: "${value}"`);
    }
    const negative = trimmed.startsWith("-");
    const abs = negative ? trimmed.slice(1) : trimmed;
    const [integer, fraction = ""] = abs.split(".");
    const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
    const raw = BigInt(integer + padded);
    return negative ? -raw : raw;
  },
};
