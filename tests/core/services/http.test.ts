import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { fetchWithTimeout, promiseWithTimeout } from "../../../src/core/services/http.js";

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects an AbortSignal when the caller does not provide one", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await fetchWithTimeout("https://example.com/data");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("preserves caller options while adding timeout protection", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await fetchWithTimeout("https://example.com/data", {
      headers: { Accept: "application/json" },
    }, 1234);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.headers).toEqual({ Accept: "application/json" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects long-running async work with promiseWithTimeout", async () => {
    await expect(
      promiseWithTimeout(new Promise(() => {}), 10, "rpc timeout"),
    ).rejects.toThrow("rpc timeout");
  });
});
