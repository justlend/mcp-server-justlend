import { TronWeb } from "tronweb";
import { getNetworkConfig } from "../chains.js";

const clientCache = new Map<string, TronWeb>();

/**
 * Get a read-only TronWeb instance for a specific network (cached).
 */
const ALLOWED_NETWORKS = new Set(["mainnet", "tron", "trx", "nile", "testnet"]);

export function getTronWeb(network = "mainnet"): TronWeb {
  const key = network.toLowerCase();
  if (!ALLOWED_NETWORKS.has(key)) {
    throw new Error(`Unsupported network: ${network}. Allowed: mainnet, nile`);
  }
  if (clientCache.has(key)) return clientCache.get(key)!;

  const config = getNetworkConfig(network);
  const isMainnet = ["mainnet", "tron", "trx"].includes(key);
  const apiKey = isMainnet ? process.env.TRONGRID_API_KEY : undefined;

  const client = new TronWeb({
    fullHost: config.fullNode,
    solidityNode: config.solidityNode,
    eventServer: config.eventServer,
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : undefined,
  });

  // Default address for read-only calls that require a `from` address.
  // This is a publicly known zero-balance address used only as a placeholder
  // for view/pure contract calls; it has no private key exposure risk.
  client.setAddress("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb");

  clientCache.set(key, client);
  return client;
}
