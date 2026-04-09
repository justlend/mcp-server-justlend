import { getAllJTokens } from "../chains.js";
import { getTronWeb } from "./clients.js";
import { promiseWithTimeout } from "./http.js";
import { utils } from "./utils.js";

export interface ResolvedKnownToken {
  input: string;
  address: string;
  symbol: string;
  decimals: number;
  resolution: "symbol" | "address";
}

function normalizeTokenSymbol(symbol: string): string {
  return symbol.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function resolveKnownToken(tokenOrAddress: string, network = "mainnet"): ResolvedKnownToken | null {
  const input = tokenOrAddress.trim();
  if (!input) return null;

  if (utils.isAddress(input)) {
    return {
      input,
      address: input,
      symbol: input,
      decimals: 18,
      resolution: "address",
    };
  }

  const normalizedInput = normalizeTokenSymbol(input);
  const resolvedByAddress = new Map<string, ResolvedKnownToken>();

  for (const token of getAllJTokens(network)) {
    if (!token.underlying) continue;

    const candidateKeys = new Set([
      normalizeTokenSymbol(token.underlyingSymbol),
      normalizeTokenSymbol(token.symbol),
      normalizeTokenSymbol(token.symbol.replace(/^j/i, "")),
    ]);
    if (!candidateKeys.has(normalizedInput)) continue;

    resolvedByAddress.set(token.underlying.toLowerCase(), {
      input,
      address: token.underlying,
      symbol: token.underlyingSymbol,
      decimals: token.underlyingDecimals,
      resolution: "symbol",
    });
  }

  if (resolvedByAddress.size === 1) {
    return Array.from(resolvedByAddress.values())[0];
  }

  return null;
}

/**
 * Get TRC20 token metadata (name, symbol, decimals, totalSupply).
 */
export async function getTRC20TokenInfo(
  tokenAddress: string,
  network = "mainnet",
): Promise<{
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  formattedTotalSupply: string;
}> {
  const tronWeb = getTronWeb(network);

  try {
    const contract: any = await promiseWithTimeout(
      tronWeb.contract().at(tokenAddress),
      undefined,
      "Timed out while loading TRC20 token contract",
    );

    const [name, symbol, decimals, totalSupply] = await promiseWithTimeout(Promise.all([
      contract.methods.name().call(),
      contract.methods.symbol().call(),
      contract.methods.decimals().call(),
      contract.methods.totalSupply().call(),
    ]), undefined, "Timed out while reading TRC20 token metadata");

    const decimalsNum = Number(decimals);
    const totalSupplyBigInt = BigInt(totalSupply.toString());
    const formattedTotalSupply = utils.formatUnits(totalSupplyBigInt, decimalsNum);

    return {
      name: String(name),
      symbol: String(symbol),
      decimals: decimalsNum,
      totalSupply: totalSupplyBigInt,
      formattedTotalSupply,
    };
  } catch (error: any) {
    throw new Error(`Failed to get TRC20 token info: ${error.message}`);
  }
}

/**
 * Get TRC721 (NFT) token metadata for a specific tokenId.
 */
export async function getTRC721TokenMetadata(
  tokenAddress: string,
  tokenId: bigint,
  network = "mainnet",
): Promise<{ name: string; symbol: string; tokenURI: string }> {
  const tronWeb = getTronWeb(network);

  try {
    const contract: any = await promiseWithTimeout(
      tronWeb.contract().at(tokenAddress),
      undefined,
      "Timed out while loading TRC721 token contract",
    );

    const [name, symbol, tokenURI] = await promiseWithTimeout(Promise.all([
      contract.methods.name().call(),
      contract.methods.symbol().call(),
      contract.methods.tokenURI(tokenId.toString()).call(),
    ]), undefined, "Timed out while reading TRC721 token metadata");

    return { name: String(name), symbol: String(symbol), tokenURI: String(tokenURI) };
  } catch (error: any) {
    throw new Error(`Failed to get TRC721 metadata: ${error.message}`);
  }
}

/**
 * Get the URI for a TRC1155 token ID.
 */
export async function getTRC1155TokenURI(
  tokenAddress: string,
  tokenId: bigint,
  network = "mainnet",
): Promise<string> {
  const tronWeb = getTronWeb(network);

  try {
    const contract: any = await promiseWithTimeout(
      tronWeb.contract().at(tokenAddress),
      undefined,
      "Timed out while loading TRC1155 token contract",
    );
    const uri = await promiseWithTimeout(
      contract.methods.uri(tokenId.toString()).call(),
      undefined,
      "Timed out while reading TRC1155 token URI",
    );
    return String(uri);
  } catch (error: any) {
    throw new Error(`Failed to get TRC1155 URI: ${error.message}`);
  }
}
