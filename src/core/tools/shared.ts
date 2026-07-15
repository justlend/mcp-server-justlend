import { z } from "zod";

/**
 * Base58 TRON address: starts with `T`, 34 characters total.
 * Mirrors `TRON_ADDRESS_RE` already enforced at the service layer
 * (see `core/services/energy-rental.ts`).
 */
export const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const DECIMAL_AMOUNT_RE = /^\d+(\.\d+)?$/;
const DECIMAL_OR_MAX_RE = /^(\d+(\.\d+)?|max)$/;
const RAW_UNITS_RE = /^\d+$/;

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
 * Non-negative integer string in raw (smallest) units — no decimal point, no sign.
 * For parameters that are already in raw on-chain units (e.g. Moolah liquidation
 * `seizedAssets` / `repaidShares`, which are passed straight to `BigInt(...)`).
 * Rejects a leading '-' at the tool boundary so a negative bigint can never reach
 * ABI encoding (two's-complement wrap to a huge uint256).
 */
export const rawUnitsString = (description: string) =>
  z
    .string()
    .regex(RAW_UNITS_RE, "Must be a non-negative integer string in raw units, e.g. '1000000'")
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

/**
 * Classify a (sanitized) error message into a machine-readable `errorCode`
 * and an actionable self-heal `hint`. The hints mirror the recovery the
 * service layer already implies in its messages, but surfaced as a separate
 * field so an agent can act without parsing prose. Returns `{}` when nothing
 * matches (the raw `error` text is still returned by `toolError`).
 */
export function classifyError(message: string): { errorCode?: string; hint?: string; retryable?: boolean } {
  const m = message.toLowerCase();
  if (/allowance/.test(m) && /approve/.test(m))
    return {
      errorCode: "insufficient_allowance",
      retryable: false,
      hint: "Raise the allowance first (e.g. approve_underlying for lending, or approve_for_votes for governance), then retry.",
    };
  if (/insufficient/.test(m) && /balance/.test(m))
    return {
      errorCode: "insufficient_balance",
      retryable: false,
      hint: "Lower the amount or fund the wallet; confirm the spendable balance with get_trx_balance / get_token_balance first.",
    };
  if (/no (active )?wallet|wallet (is )?not (configured|initialized|connected)|no wallet configured/.test(m))
    return {
      errorCode: "wallet_not_configured",
      retryable: false,
      hint: "Configure a wallet first: import_wallet (agent mode) or connect_wallet (browser mode), then set_active_wallet.",
    };
  if (/revert|execution reverted|reverted/.test(m))
    return {
      errorCode: "execution_reverted",
      retryable: false,
      hint: "The contract reverted. Check pre-conditions (allowance, collateral/health, market paused) and simulate the operation before broadcasting.",
    };
  if (/not found|unknown market|unsupported market|no such market|invalid market/.test(m))
    return {
      errorCode: "market_not_found",
      retryable: false,
      hint: "Verify the market symbol or address against get_supported_markets.",
    };
  if (/invalid\b.{0,24}\baddress|not a valid.*address|bad address/.test(m))
    return {
      errorCode: "invalid_address",
      retryable: false,
      hint: "Use a Base58 TRON address (starts with 'T', 34 chars).",
    };
  if (/timeout|timed out|econnreset|econnrefused|etimedout|fetch failed|network error|socket hang up|rate.?limit|too many requests|server[ _]?busy|\b50[23]\b|\b429\b/.test(m))
    return {
      errorCode: "transient",
      retryable: true,
      hint: "Transient network/RPC error — retry read-only calls after a short backoff. Never blindly re-broadcast a write that may already have landed; re-query state first.",
    };
  return {};
}

/**
 * Build a structured, agent-friendly error result. Emits JSON text with
 * `error` plus, when recognized, a machine-readable `errorCode`, a boolean
 * `retryable` (whether the agent may safely retry), and an actionable `hint` —
 * so an agent can self-heal / branch without parsing prose. `isError: true` is
 * preserved for MCP clients.
 */
export function toolError(error: any) {
  const message = sanitizeError(error);
  const { errorCode, hint, retryable } = classifyError(message);
  const payload: { error: string; errorCode?: string; retryable?: boolean; hint?: string } = { error: message };
  if (errorCode) payload.errorCode = errorCode;
  if (retryable !== undefined) payload.retryable = retryable;
  if (hint) payload.hint = hint;
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}
