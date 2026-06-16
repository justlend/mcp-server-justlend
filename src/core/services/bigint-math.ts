/**
 * Shared BigInt math and formatting utilities for precision-safe
 * financial calculations across lending, account, and market modules.
 */
import { expandScientificNotation, utils } from "./utils.js";

// ============================================================================
// Constants
// ============================================================================

export const MANTISSA_18 = 10n ** 18n;
export const USD_PRICE_SCALE = 36;
export const USD_VALUE_SCALE = 10n ** 36n;

// ============================================================================
// Core math
// ============================================================================

export function pow10(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

/** Round-half-up integer division (handles negative numerators). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  return numerator >= 0n
    ? (numerator + denominator / 2n) / denominator
    : (numerator - denominator / 2n) / denominator;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format a BigInt value that has been scaled by `10^scale` into a
 * fixed-point string with `fractionDigits` decimal places.
 */
export function formatScaled(
  value: bigint,
  scale: number,
  fractionDigits: number,
  trimTrailingZeros = false,
): string {
  if (fractionDigits === 0) {
    return divRound(value, pow10(scale)).toString();
  }

  const rounded = divRound(value * pow10(fractionDigits), pow10(scale));
  const divisor = pow10(fractionDigits);
  const integer = rounded / divisor;
  const remainder = rounded % divisor;
  let fraction = remainder.toString().padStart(fractionDigits, "0");

  if (trimTrailingZeros) {
    fraction = fraction.replace(/0+$/, "");
  }

  return fraction ? `${integer}.${fraction}` : integer.toString();
}

/**
 * Human-friendly formatting: shows fewer decimals for large values,
 * more for small values. Precision-safe replacement for
 * `(Number(raw) / 10**decimals).toFixed(…)`.
 */
export function formatDisplayUnits(raw: bigint, decimals: number): string {
  const divisor = pow10(decimals);
  const integer = raw / divisor;
  const remainder = raw % divisor;

  if (remainder === 0n) return integer.toString();

  const fracFull = remainder.toString().padStart(decimals, "0");
  const maxFrac = integer >= 1_000_000n ? 2 : integer >= 1n ? 6 : decimals;
  const frac = fracFull.slice(0, maxFrac).replace(/0+$/, "");

  return frac ? `${integer}.${frac}` : integer.toString();
}

// ============================================================================
// Self-describing amounts (AI-Agent doc standard: raw + _unit + decimals + display)
// ============================================================================

/** A self-describing token/value amount for tool responses. */
export interface DescribedAmount {
  /** Raw integer value as a string (base units, e.g. Sun). `string` so values > 2^53 keep full precision. */
  raw: string;
  /** Number of decimal places to scale `raw` down to the display value. */
  decimals: number;
  /** Unit/symbol of the display value (e.g. "TRX", "USDT", "sTRX", "USD"). */
  _unit: string;
  /** Human-readable display value (decimals already applied). Do NOT scale again. */
  display: string;
}

/**
 * Build a self-describing amount object so AI agents never have to guess the
 * unit or re-apply decimals. Returns `{ raw, decimals, _unit, display }`.
 *
 * The standard self-description shape required by the AI-Agent doc standard:
 * any "raw ↔ display" numeric field should carry raw + `_unit` + `decimals` +
 * the human-readable display string together.
 */
export function describeAmount(
  raw: bigint | string | number,
  decimals: number,
  unit: string,
): DescribedAmount {
  const rawBig = typeof raw === "bigint" ? raw : BigInt(normalizeDecimalString(raw).split(".")[0] || "0");
  return {
    raw: rawBig.toString(),
    decimals,
    _unit: unit,
    display: formatDisplayUnits(rawBig, decimals),
  };
}

/**
 * Build a self-describing amount from an already-de-scaled **display** string
 * (e.g. `"5000.12"`) plus its `decimals` — for sources that only expose the
 * human-readable value (no raw base units). Reconstructs `raw` exactly via
 * string math (no float), so `display` round-trips the input.
 */
export function describeFromDisplay(
  display: string,
  decimals: number,
  unit: string,
): DescribedAmount {
  const s = normalizeDecimalString(display ?? "0").trim();
  const negative = s.startsWith("-");
  const body = negative ? s.slice(1) : s;
  const [intPart = "0", fracPart = ""] = body.split(".");
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  let rawBig = BigInt((intPart || "0") + (decimals > 0 ? frac : ""));
  if (negative) rawBig = -rawBig;
  return {
    raw: rawBig.toString(),
    decimals,
    _unit: unit,
    display: formatDisplayUnits(rawBig, decimals),
  };
}

// ============================================================================
// USD helpers
// ============================================================================

/** Format a cent-denominated BigInt as `"1234.56"`. */
export function formatUsdCents(cents: bigint): string {
  return formatScaled(cents, 2, 2);
}

/** Convert a raw token amount + raw oracle price into USD cents. */
export function amountToUsdCents(amountRaw: bigint, priceRaw: bigint): bigint {
  if (amountRaw === 0n || priceRaw === 0n) return 0n;
  return divRound(amountRaw * priceRaw * 100n, USD_VALUE_SCALE);
}

/** Format a raw oracle price as a 6-decimal USD string. */
export function formatPriceUSD(priceRaw: bigint, underlyingDecimals: number): string {
  return formatScaled(priceRaw, USD_PRICE_SCALE - underlyingDecimals, 6);
}

// ============================================================================
// Ratio helpers
// ============================================================================

/** Format `numerator / denominator` as a fixed-point string. */
export function formatRatio(numerator: bigint, denominator: bigint, fractionDigits: number): string {
  if (denominator === 0n) return "\u221E";
  const scaled = divRound(numerator * pow10(fractionDigits), denominator);
  return formatScaled(scaled, fractionDigits, fractionDigits);
}

/** Format `numerator / denominator` as a percentage string (×100). */
export function formatPercentRatio(numerator: bigint, denominator: bigint, fractionDigits = 2): string {
  if (denominator === 0n) return "\u221E";
  const scaledPercent = divRound(numerator * pow10(fractionDigits + 2), denominator);
  return formatScaled(scaledPercent, fractionDigits, fractionDigits);
}

// ============================================================================
// Conversion helpers
// ============================================================================

/** Convert a JS number price to a raw oracle-scale BigInt. */
export function priceNumberToRaw(priceUSD: number, underlyingDecimals: number): bigint {
  if (!Number.isFinite(priceUSD) || priceUSD <= 0) return 0n;
  const normalized = priceUSD.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
  return utils.parseUnits(normalized === "" ? "0" : normalized, USD_PRICE_SCALE - underlyingDecimals);
}

/**
 * Safely convert an unknown value (string | number) to a trimmed *plain* decimal
 * string. Strings already in scientific notation (e.g. `"1.02e+26"`) and numbers
 * whose `toFixed(18)` falls back to scientific notation (any |value| ≥ 1e21) are
 * expanded so downstream `.split(".")[0]` and `BigInt(...)` callers see digits.
 */
export function normalizeDecimalString(value: unknown): string {
  if (typeof value === "string") return expandScientificNotation(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return expandScientificNotation(value.toFixed(18))
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "");
  }
  return expandScientificNotation(String(value ?? "0"));
}

/** Build a human-readable collateral breakdown string. */
export function buildCollateralBreakdown(details: Array<{
  symbol: string;
  supplyValueCents: bigint;
  collateralFactorMantissa: bigint;
  adjustedValueCents: bigint;
  borrowBalanceCents: bigint;
}>): string {
  return details.map((detail) =>
    `${detail.symbol}: supply=$${formatUsdCents(detail.supplyValueCents)} \u00D7 CF ${formatScaled(detail.collateralFactorMantissa * 100n, 18, 0)}% = $${formatUsdCents(detail.adjustedValueCents)}` +
    (detail.borrowBalanceCents > 0n ? `, borrow=$${formatUsdCents(detail.borrowBalanceCents)}` : ""),
  ).join("; ");
}
