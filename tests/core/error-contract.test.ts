import { describe, it, expect } from "vitest";
import { classifyError, toolError } from "../../src/core/tools/shared.js";

describe("error contract — classifyError / toolError retryable", () => {
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

  it("toolError surfaces retryable in the JSON payload", () => {
    const res = toolError(new Error("rate limit exceeded, please retry"));
    expect(res.isError).toBe(true);
    const payload = JSON.parse(res.content[0].text);
    expect(payload).toMatchObject({ errorCode: "transient", retryable: true });
    expect(payload.hint).toMatch(/retry/i);
  });
});
