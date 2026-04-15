import { getTronWeb } from "./clients.js";
import { utils } from "./utils.js";

/**
 * Get TRX balance for an address.
 * Returns a rich object with wei (Sun), ether (TRX), formatted string, symbol, and decimals.
 */
export async function getTRXBalance(address: string, network = "mainnet") {
  const tronWeb = getTronWeb(network);
  const balanceSun = await tronWeb.trx.getBalance(address);

  return {
    wei: BigInt(balanceSun),
    ether: utils.fromSun(balanceSun),
    formatted: utils.fromSun(balanceSun),
    symbol: "TRX",
    decimals: 6,
  };
}

/**
 * Get TRC20 token balance for an address.
 */
export async function getTRC20Balance(
  tokenAddress: string,
  walletAddress: string,
  network = "mainnet",
) {
  const tronWeb = getTronWeb(network);

  try {
    const contract = await tronWeb.contract().at(tokenAddress);
    const balance = await contract.methods.balanceOf(walletAddress).call();
    const decimals = await contract.methods.decimals().call();
    const symbol = await contract.methods.symbol().call();

    const balanceBigInt = BigInt(balance.toString());
    const decimalsNum = Number(decimals);
    const formatted = utils.formatUnits(balanceBigInt, decimalsNum);

    return {
      raw: balanceBigInt,
      formatted,
      token: {
        symbol: String(symbol),
        decimals: decimalsNum,
        address: tokenAddress,
      },
    };
  } catch (error: any) {
    throw new Error(`Failed to get TRC20 balance: ${error.message}`);
  }
}

/**
 * Get TRC1155 token balance for a given token ID and owner address.
 */
export async function getTRC1155Balance(
  contractAddress: string,
  ownerAddress: string,
  tokenId: bigint,
  network = "mainnet",
) {
  const tronWeb = getTronWeb(network);

  try {
    const contract = await tronWeb.contract().at(contractAddress);
    const balance = await contract.methods.balanceOf(ownerAddress, tokenId.toString()).call();
    return BigInt(balance.toString());
  } catch (error: any) {
    throw new Error(`Failed to get TRC1155 balance: ${error.message}`);
  }
}
