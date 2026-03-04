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
};
