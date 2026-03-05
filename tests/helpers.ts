/**
 * Shared test helpers for integration tests that hit TronGrid.
 * Without TRONGRID_API_KEY, rate limiting (429) is common.
 */

/**
 * Wraps an async test function to skip gracefully on 429 rate-limit errors.
 * Use this for integration tests that make real TronGrid API calls.
 */
export function skipOn429(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (error: any) {
      const msg = error?.message || "";
      if (msg.includes("429") || msg.includes("rate") || msg.includes("Rate")) {
        console.warn("⚠ Skipped due to TronGrid 429 rate limit — set TRONGRID_API_KEY for reliable tests");
        return; // pass the test gracefully
      }
      throw error; // re-throw non-429 errors
    }
  };
}
