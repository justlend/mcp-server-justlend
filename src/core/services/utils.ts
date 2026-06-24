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
   * Validate a TRC20 `decimals()` value before using it to scale amounts.
   * Rejects NaN / Infinity / non-integer / out-of-range (valid range [0, 38]),
   * so a malformed or malicious token contract can't poison `parseUnits`/`formatUnits`.
   */
  assertValidDecimals: (decimals: number, context = "token"): number => {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
      throw new Error(
        `Invalid ${context} decimals: ${decimals}. Expected an integer in [0, 38] — ` +
        `the token contract may be malformed. Pass a known token symbol or verify the address.`,
      );
    }
    return decimals;
  },

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
    // Reject a leading '-': a negative amount is never legitimate here and would
    // otherwise flow to the signing path as a negative bigint (two's-complement wrap
    // to a near-MAX_UINT256 value at ABI encoding — catastrophic for approve). The
    // regex omits the optional '-' so negatives fall into "Invalid numeric value",
    // mirroring the non-negative guard already enforced by toSafeCallValueNumber and
    // the v1 `amountString` tool schema.
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Invalid numeric value: "${value}"`);
    }
    const [integer, fraction = ""] = trimmed.split(".");
    // Reject silent truncation: if the value carries more fraction digits than the
    // token supports and any of the excess digits are non-zero, fail loudly instead
    // of quietly signing a smaller amount than the user intended.
    const excess = fraction.slice(decimals);
    if (/[^0]/.test(excess)) {
      throw new Error(`Too many decimal places in "${value}": token supports at most ${decimals} decimals`);
    }
    const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
    return BigInt(integer + padded);
  },
};
