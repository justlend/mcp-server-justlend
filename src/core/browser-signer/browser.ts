/**
 * TRON Browser Wallet Signer — Browser Utilities
 */

const LOCAL_HOST = "127.0.0.1";

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

export function buildLocalOrigin(port: number): string {
  return `http://${LOCAL_HOST}:${port}`;
}

function buildApprovalUrl(port: number, path: string, approvalToken: string): string {
  const url = new URL(path, buildLocalOrigin(port));
  url.searchParams.set("token", approvalToken);
  return url.toString();
}

export function buildConnectUrl(port: number, requestId: string, approvalToken: string): string {
  return buildApprovalUrl(port, `/connect/${requestId}`, approvalToken);
}

export function buildSignUrl(port: number, requestId: string, approvalToken: string): string {
  return buildApprovalUrl(port, `/sign/${requestId}`, approvalToken);
}
