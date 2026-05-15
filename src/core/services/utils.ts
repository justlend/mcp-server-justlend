import { TronWeb } from "tronweb";

/**
 * Expand a scientific-notation decimal string to a plain decimal string.
 * Returns the input unchanged when no exponent is present.
 *
 * Needed because the JustLend API serialises very large numbers (e.g. high-TVL
 * `exchangeRate` values) as JSON numbers; once they exceed 1e21 the JS string
 * forms switch to scientific notation, which `BigInt(...)` and `parseUnits(...)`
 * both reject. `Number.prototype.toFixed(18)` has the same behavior for values
 * ≥ 1e21, so any code path that round-trips through `toFixed` ends up here too.
 */
export function expandScientificNotation(value: string): string {
  const trimmed = value.trim();
  if (!/[eE]/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!m) return trimmed;
  const [, sign, intPart, fracPart = "", expStr] = m;
  const exp = parseInt(expStr, 10);
  const digits = intPart + fracPart;
  const decimalPos = intPart.length + exp;
  if (decimalPos <= 0) {
    return `${sign}0.${"0".repeat(-decimalPos)}${digits}`;
  }
  if (decimalPos >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalPos - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalPos)}.${digits.slice(decimalPos)}`;
}

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
    let trimmed = value.trim();
    if (/[eE]/.test(trimmed)) {
      trimmed = expandScientificNotation(trimmed);
    }
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
