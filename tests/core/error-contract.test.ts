import { describe, it, expect } from "vitest";
import { classifyError, toolError } from "../../src/core/tools/shared.js";

describe("error contract — classifyError / toolError retryable", () => {
  it("keeps wallet imports in the user's terminal and private keys out of MCP", () => {
    const result = classifyError("No wallet configured");
    expect(result).toMatchObject({ errorCode: "wallet_not_configured", retryable: false });
    expect(result.hint).not.toContain("import_wallet");
    expect(result.hint).toContain("npx agent-wallet import in their own terminal");
    expect(result.hint).toContain("never request a private key in chat or tool arguments");
    expect(result.hint).toContain("list_wallets");
  });
  it("routes allowance recovery to the actual governance approval tool without automatic retry", () => {
    const result = classifyError("Insufficient allowance. Please approve first.");
    expect(result).toMatchObject({ errorCode: "insufficient_allowance", retryable: false });
    expect(result.hint).toContain("approve_jst_for_voting");
    expect(result.hint).not.toContain("approve_for_votes");
    expect(result.hint).toContain("Do not retry automatically");
  });
  it("marks transient network/RPC errors retryable", () => {
    for (const msg of ["Request timed out", "SERVER_BUSY", "rate limit exceeded", "fetch failed", "ECONNRESET"]) {
      const c = classifyError(msg);
      expect(c.errorCode).toBe("transient");
      expect(c.retryable).toBe(true);
    }
  });

  it("marks deterministic errors non-retryable with a code", () => {
    expect(classifyError("Insufficient USDT balance. Have 1, need 2")).toMatchObject({
      errorCode: "insufficient_balance",
      retryable: false,
    });
    expect(classifyError("execution reverted")).toMatchObject({ errorCode: "execution_reverted", retryable: false });
    expect(classifyError("Invalid TRON address")).toMatchObject({ errorCode: "invalid_address", retryable: false });
  });

  it("returns no code/retryable for unclassified errors", () => {
    expect(classifyError("something unexpected happened")).toEqual({});
  });

  it("does not advise retrying a claim when availability is unknown", () => {
    const response = toolError(new Error("sTRX claim availability is unknown. Re-query account data before claiming; no transaction was submitted."));
    expect(response.isError).toBe(true);
    expect(JSON.parse(response.content[0].text)).toMatchObject({ errorCode: "data_unavailable", retryable: false });
  });

  it("toolError surfaces retryable in the JSON payload", () => {
    const res = toolError(new Error("rate limit exceeded, please retry"));
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload).toMatchObject({ errorCode: "transient", retryable: true });
    expect(payload.hint).toMatch(/retry/i);
  });
});
