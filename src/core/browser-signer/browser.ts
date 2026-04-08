/**
 * TRON Browser Wallet Signer — Browser Utilities
 */

/** Open a URL in the default browser. */
export async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch (error) {
    console.error(`[tron-browser-signer] Failed to open browser: ${error}`);
    console.error(`[tron-browser-signer] Please open this URL manually: ${url}`);
  }
}

export function buildConnectUrl(port: number, requestId: string): string {
  return `http://127.0.0.1:${port}/connect/${requestId}`;
}

export function buildSignUrl(port: number, requestId: string): string {
  return `http://127.0.0.1:${port}/sign/${requestId}`;
}
