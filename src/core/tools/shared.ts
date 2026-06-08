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
