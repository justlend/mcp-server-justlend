function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    // Do not echo a possibly sensitive value accidentally placed in this env.
    throw new Error(`${name} must be a positive integer between 1 and ${max}.`);
  }
  return parsed;
}

/** Validate all numeric HTTP settings before opening a listener or a session. */
export function readHttpNumericConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    port: positiveInteger(env, "PORT", 3001, 65535),
    maxSessions: positiveInteger(env, "MCP_MAX_SESSIONS", 100),
    sessionTimeoutMs: positiveInteger(env, "MCP_SESSION_TIMEOUT_MS", 1_800_000),
    rateLimitPerMin: positiveInteger(env, "MCP_RATE_LIMIT_PER_MIN", 120),
    sseRateLimitPerMin: positiveInteger(env, "MCP_SSE_RATE_LIMIT_PER_MIN", 10),
  };
}
