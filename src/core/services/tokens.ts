import { getTronWeb } from "./clients.js";

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
    const contract = await tronWeb.contract().at(tokenAddress);

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      contract.methods.name().call(),
      contract.methods.symbol().call(),
      contract.methods.decimals().call(),
      contract.methods.totalSupply().call(),
    ]);

    const decimalsNum = Number(decimals);
    const totalSupplyBigInt = BigInt(totalSupply.toString());
    const divisor = BigInt(10) ** BigInt(decimalsNum);
    const formattedTotalSupply = (Number(totalSupplyBigInt) / Number(divisor)).toString();

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
    const contract = await tronWeb.contract().at(tokenAddress);

    const [name, symbol, tokenURI] = await Promise.all([
      contract.methods.name().call(),
      contract.methods.symbol().call(),
      contract.methods.tokenURI(tokenId.toString()).call(),
    ]);

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
    const contract = await tronWeb.contract().at(tokenAddress);
    const uri = await contract.methods.uri(tokenId.toString()).call();
    return String(uri);
  } catch (error: any) {
    throw new Error(`Failed to get TRC1155 URI: ${error.message}`);
  }
}
