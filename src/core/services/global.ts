/**
 * Session-aware state management.
 *
 * In stdio mode, state falls back to a single process-wide context.
 * In HTTP/SSE mode, the HTTP layer binds a dedicated state object to each
 * session via AsyncLocalStorage so concurrent clients do not share mutable
 * wallet/network settings.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type WalletMode = "browser" | "agent" | "unset";
export type SelectableWalletMode = Exclude<WalletMode, "unset">;

export interface SessionState {
  sessionId: string;
  network: string;
  walletMode: WalletMode;
  browserSigner?: unknown;
}

const DEFAULT_NETWORK = "mainnet";
const DEFAULT_SESSION_ID = "default";
const sessionStorage = new AsyncLocalStorage<SessionState>();
const fallbackState: SessionState = {
  sessionId: DEFAULT_SESSION_ID,
  network: DEFAULT_NETWORK,
  walletMode: "unset",
};

function normalizeNetwork(network: string): string {
  const n = network.toLowerCase();
  if (n !== "mainnet" && n !== "nile" && n !== "tron" && n !== "trx" && n !== "testnet") {
    throw new Error(`Unsupported network: ${network}. Supported: mainnet, nile`);
  }
  return n;
}

export function createSessionState(sessionId: string): SessionState {
  return {
    sessionId,
    network: DEFAULT_NETWORK,
    walletMode: "unset",
  };
}

export function runWithSessionState<T>(state: SessionState, fn: () => T): T {
  return sessionStorage.run(state, fn);
}

export function getSessionState(): SessionState {
  return sessionStorage.getStore() ?? fallbackState;
}

export function getGlobalNetwork(): string {
  return getSessionState().network;
}

export function setGlobalNetwork(network: string): void {
  getSessionState().network = normalizeNetwork(network);
}

export function getWalletMode(): WalletMode {
  return getSessionState().walletMode;
}

export function setWalletMode(mode: WalletMode): void {
  getSessionState().walletMode = mode;
}
