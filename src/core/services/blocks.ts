import { getTronWeb } from "./clients.js";

type Block = any;

/**
 * Get a block by its number.
 */
export async function getBlockByNumber(blockNumber: number, network = "mainnet"): Promise<Block> {
  const tronWeb = getTronWeb(network);
  return tronWeb.trx.getBlock(blockNumber);
}

/**
 * Get a block by its hash.
 */
export async function getBlockByHash(blockHash: string, network = "mainnet"): Promise<Block> {
  const tronWeb = getTronWeb(network);
  return tronWeb.trx.getBlock(blockHash);
}

/**
 * Get the most recently confirmed block.
 */
export async function getLatestBlock(network = "mainnet"): Promise<Block> {
  const tronWeb = getTronWeb(network);
  return tronWeb.trx.getCurrentBlock();
}

/**
 * Get the current block number.
 */
export async function getBlockNumber(network = "mainnet"): Promise<number> {
  const block = await getLatestBlock(network);
  return (block as any).block_header.raw_data.number;
}

/**
 * Get the chain ID for a given network.
 * TRON does not use EVM chain IDs natively; known wallet-facing IDs are returned
 * to match TronLink / tronlink-signer network switching and typed-data signing.
 */
export async function getChainId(network = "mainnet"): Promise<number> {
  if (network === "mainnet") return 728126428;
  if (network === "nile") return 3448148188;
  if (network === "shasta") return 2494104990;
  return 0;
}
