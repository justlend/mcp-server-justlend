import { TronWeb } from "tronweb";

/**
 * Convert a Base58 TRON address to its hex representation.
 * If already hex, returns as-is.
 */
export function toHexAddress(address: string): string {
  if (address.startsWith("T")) {
    return TronWeb.address.toHex(address);
  }
  return address;
}

/**
 * Convert a hex TRON address to its Base58 representation.
 * If already Base58, returns as-is.
 */
export function toBase58Address(address: string): string {
  if (address.startsWith("41")) {
    return TronWeb.address.fromHex(address);
  }
  if (address.startsWith("0x")) {
    return TronWeb.address.fromHex(address);
  }
  return address;
}

/**
 * Compare two TRON addresses for equality, normalizing Base58/hex to hex first.
 * Base58 is case-sensitive, so a naive `toLowerCase()` compare is fragile (and
 * never matches a Base58 value against a hex one). This normalizes both sides
 * via `toHexAddress` before comparing.
 */
export function addressesEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    return toHexAddress(a).toLowerCase() === toHexAddress(b).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Returns true if the address is a valid TRON Base58 address (starts with 'T').
 */
export function isBase58(address: string): boolean {
  return address.startsWith("T") && TronWeb.isAddress(address);
}

/**
 * Returns true if the address is a valid TRON hex address (41... or 0x...).
 */
export function isHex(address: string): boolean {
  if (address.startsWith("T")) return false;

  let clean = address;
  if (address.startsWith("0x")) {
    clean = address.substring(2);
  }
  if (clean.length === 40) {
    clean = "41" + clean;
  }
  return TronWeb.isAddress(clean);
}

/**
 * Returns true for any supported TRON address encoding (Base58 or hex).
 */
export function isValidTronAddress(address: string): boolean {
  return isBase58(address) || isHex(address);
}

/**
 * Resolve a TRON address or name to its canonical address.
 * Currently supports direct addresses only (no name service).
 */
export const resolveAddress = async (nameOrAddress: string, _network?: string): Promise<string> => {
  if (isValidTronAddress(nameOrAddress)) {
    return nameOrAddress;
  }
  throw new Error(`Invalid address or unsupported name service: ${nameOrAddress}`);
};
