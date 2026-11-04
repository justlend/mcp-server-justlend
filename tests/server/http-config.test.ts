import { describe, expect, it } from "vitest";
import { readHttpNumericConfig } from "../../src/server/http-config.js";

describe("HTTP numeric configuration", () => {
  it("keeps bounded defaults for unset or empty configuration", () => {
    expect(readHttpNumericConfig({ MCP_MAX_SESSIONS: " ", PORT: "" })).toEqual({
      port: 3001, maxSessions: 100, sessionTimeoutMs: 1_800_000,
      rateLimitPerMin: 120, sseRateLimitPerMin: 10,
    });
  });

  it("accepts positive integers and surrounding whitespace", () => {
    expect(readHttpNumericConfig({ PORT: "65535", MCP_MAX_SESSIONS: " 1 ", MCP_SESSION_TIMEOUT_MS: "2500", MCP_RATE_LIMIT_PER_MIN: "20", MCP_SSE_RATE_LIMIT_PER_MIN: "3" })).toEqual({
      port: 65535, maxSessions: 1, sessionTimeoutMs: 2500,
      rateLimitPerMin: 20, sseRateLimitPerMin: 3,
    });
  });

  for (const name of ["PORT", "MCP_MAX_SESSIONS", "MCP_SESSION_TIMEOUT_MS", "MCP_RATE_LIMIT_PER_MIN", "MCP_SSE_RATE_LIMIT_PER_MIN"]) {
    it.each(["NaN", "Infinity", "oops", "0", "-1", "1.5", "1e3", "12abc", "9007199254740992"])(
      `rejects ${name}=%s rather than disabling a safety boundary`, (value) => {
        expect(() => readHttpNumericConfig({ [name]: value })).toThrow(`${name} must be a positive integer`);
      },
    );
  }

  it("rejects ports outside the TCP range", () => {
    expect(() => readHttpNumericConfig({ PORT: "65536" })).toThrow(/PORT/);
  });

  it("does not echo accidentally supplied sensitive configuration", () => {
    const secret = "audit-canary-do-not-log";
    try { readHttpNumericConfig({ MCP_MAX_SESSIONS: secret }); } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      return;
    }
    throw new Error("Invalid configuration unexpectedly accepted");
  });
});
