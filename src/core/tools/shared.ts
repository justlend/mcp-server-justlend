import { z } from "zod";

/**
 * Base58 TRON address: starts with `T`, 34 characters total.
 * Mirrors `TRON_ADDRESS_RE` already enforced at the service layer
 * (see `core/services/energy-rental.ts`).
 */
export const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const DECIMAL_AMOUNT_RE = /^\d+(\.\d+)?$/;
const DECIMAL_OR_MAX_RE = /^(\d+(\.\d+)?|max)$/;

/**
 * Reusable Zod schema builders so every tool input that takes a TRON address
 * or a human-readable amount validates the same way — and so the generated
 * `mcp-api-list.md` exposes the format constraint (regex) to offline agents.
 */
export const tronAddress = (description: string) =>
  z
    .string()
    .regex(TRON_ADDRESS_RE, "Must be a Base58 TRON address (starts with 'T', 34 chars)")
    .describe(description);

/** Non-negative decimal string, e.g. "1" or "10.5". */
export const amountString = (description: string) =>
  z
    .string()
    .regex(DECIMAL_AMOUNT_RE, "Must be a non-negative decimal string, e.g. '1' or '10.5'")
    .describe(description);

/** Non-negative decimal string, or the literal "max" (full-balance sentinel). */
export const amountOrMaxString = (description: string) =>
  z
    .string()
    .regex(DECIMAL_OR_MAX_RE, "Must be a non-negative decimal string (e.g. '100') or 'max'")
    .describe(description);

/**
 * Sanitize error messages for MCP client responses.
 *
 * Currently this only redacts full URLs (http/https) from the error message,
 * which may otherwise expose internal node/RPC infrastructure.
 *
 * NOTE: contract addresses and stack traces are intentionally NOT stripped —
 * on TRON, contract/wallet addresses are public on-chain data, and the
 * underlying SDKs generally surface a single-line `error.message` rather than
 * a full stack trace. If richer redaction is ever required (e.g. filesystem
 * paths, stack frames), extend this function accordingly.
 */
export function sanitizeError(error: any): string {
  const msg = error?.message || String(error);
  // Remove full URLs that might expose internal infrastructure
  return msg.replace(/https?:\/\/[^\s,)]+/g, "[redacted-url]");
}
