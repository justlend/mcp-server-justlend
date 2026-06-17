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

/**
 * Classify a (sanitized) error message into a machine-readable `errorCode`
 * and an actionable self-heal `hint`. The hints mirror the recovery the
 * service layer already implies in its messages, but surfaced as a separate
 * field so an agent can act without parsing prose. Returns `{}` when nothing
 * matches (the raw `error` text is still returned by `toolError`).
 */
export function classifyError(message: string): { errorCode?: string; hint?: string } {
  const m = message.toLowerCase();
  if (/allowance/.test(m) && /approve/.test(m))
    return {
      errorCode: "insufficient_allowance",
      hint: "Raise the allowance first (e.g. approve_underlying for lending, or approve_for_votes for governance), then retry.",
    };
  if (/insufficient/.test(m) && /balance/.test(m))
    return {
      errorCode: "insufficient_balance",
      hint: "Lower the amount or fund the wallet; confirm the spendable balance with get_trx_balance / get_token_balance first.",
    };
  if (/no (active )?wallet|wallet (is )?not (configured|initialized|connected)|no wallet configured/.test(m))
    return {
      errorCode: "wallet_not_configured",
      hint: "Configure a wallet first: import_wallet (agent mode) or connect_wallet (browser mode), then set_active_wallet.",
    };
  if (/revert|execution reverted|reverted/.test(m))
    return {
      errorCode: "execution_reverted",
      hint: "The contract reverted. Check pre-conditions (allowance, collateral/health, market paused) and simulate the operation before broadcasting.",
    };
  if (/not found|unknown market|unsupported market|no such market|invalid market/.test(m))
    return {
      errorCode: "market_not_found",
      hint: "Verify the market symbol or address against get_supported_markets.",
    };
  if (/invalid address|not a valid.*address|bad address/.test(m))
    return {
      errorCode: "invalid_address",
      hint: "Use a Base58 TRON address (starts with 'T', 34 chars).",
    };
  return {};
}

/**
 * Build a structured, agent-friendly error result. Emits JSON text with
 * `error` plus, when recognized, a machine-readable `errorCode` and an
 * actionable `hint` — so an agent can self-heal instead of parsing the
 * message. `isError: true` is preserved for MCP clients.
 */
export function toolError(error: any) {
  const message = sanitizeError(error);
  const { errorCode, hint } = classifyError(message);
  const payload: { error: string; errorCode?: string; hint?: string } = { error: message };
  if (errorCode) payload.errorCode = errorCode;
  if (hint) payload.hint = hint;
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}
