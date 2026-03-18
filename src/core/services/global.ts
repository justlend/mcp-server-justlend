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
