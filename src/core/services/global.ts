/**
 * Global State Management
 */
let globalNetwork: string = "mainnet";

export function getGlobalNetwork(): string {
  return globalNetwork;
}

export function setGlobalNetwork(network: string): void {
  const n = network.toLowerCase();
  if (n !== "mainnet" && n !== "nile" && n !== "tron" && n !== "trx" && n !== "testnet") {
    throw new Error(`Unsupported network: ${network}. Supported: mainnet, nile`);
  }
  globalNetwork = n;
}

// --- Wallet Mode ---

export type WalletMode = "browser" | "agent" | "unset";
export type SelectableWalletMode = Exclude<WalletMode, "unset">;

let walletMode: WalletMode = "unset";

export function getWalletMode(): WalletMode {
  return walletMode;
}

export function setWalletMode(mode: WalletMode): void {
  walletMode = mode;
}
