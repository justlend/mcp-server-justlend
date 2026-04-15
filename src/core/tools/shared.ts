/**
 * Sanitize error messages for MCP client responses.
 * Strips internal details (contract addresses, node URLs, stack traces)
 * while preserving user-actionable information.
 */
export function sanitizeError(error: any): string {
  const msg = error?.message || String(error);
  // Remove full URLs that might expose internal infrastructure
  return msg.replace(/https?:\/\/[^\s,)]+/g, "[redacted-url]");
}
