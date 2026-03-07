import { getWallet } from "./clients.js";
import { utils } from "./utils.js";
import { checkResourceSufficiency } from "./lending.js";

/**
 * Transfer TRX to an address.
 * @param amount - Amount in TRX (not Sun).
 */
export async function transferTRX(
  privateKey: string,
  to: string,
  amount: string,
  network = "mainnet",
) {
  const tronWeb = getWallet(privateKey, network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const amountSun = utils.toSun(amount as any);

  // Check TRX balance with dynamic gas estimation
  // TRX transfer: ~0 energy (simple transfer), ~270 bandwidth
  const balanceSun = await tronWeb.trx.getBalance(walletAddress);
  const TRANSFER_ENERGY_ESTIMATE = 0;
  const TRANSFER_BANDWIDTH_ESTIMATE = 270;
  const resourceCheck = await checkResourceSufficiency(walletAddress, TRANSFER_ENERGY_ESTIMATE, TRANSFER_BANDWIDTH_ESTIMATE, network);
  const gasSun = BigInt(Math.ceil((parseFloat(resourceCheck.energyBurnTRX) + parseFloat(resourceCheck.bandwidthBurnTRX)) * 1e6));
  const needed = BigInt(amountSun) + gasSun;
  if (BigInt(balanceSun) < needed) {
    throw new Error(
      `Insufficient TRX balance. Have ${utils.fromSun(balanceSun)} TRX, need ~${utils.fromSun(needed.toString())} TRX (transfer + gas)`,
    );
  }

  const tx = await tronWeb.trx.sendTransaction(to, amountSun as any);

  if ((tx as any).result === true && (tx as any).transaction) {
    return (tx as any).transaction.txID;
  }
  if ((tx as any).txID) {
    return (tx as any).txID;
  }
  throw new Error(`Transaction failed: ${JSON.stringify(tx)}`);
}

/**
 * Transfer TRC20 tokens.
 * @param amount - Raw token amount (accounting for decimals).
 */
export async function transferTRC20(
  tokenAddress: string,
  to: string,
  amount: string,
  privateKey: string,
  network = "mainnet",
) {
  const tronWeb = getWallet(privateKey, network);

  try {
    const contract = await tronWeb.contract().at(tokenAddress);

    // Check token balance before transfer
    const walletAddress = tronWeb.defaultAddress.base58 as string;
    const balance = BigInt(await contract.methods.balanceOf(walletAddress).call());
    if (balance < BigInt(amount)) {
      const symbol = await contract.methods.symbol().call();
      const decimals = Number(await contract.methods.decimals().call());
      const divisor = BigInt(10) ** BigInt(decimals);
      throw new Error(
        `Insufficient ${symbol} balance. Have ${(Number(balance) / Number(divisor)).toString()}, need ${(Number(BigInt(amount)) / Number(divisor)).toString()}`,
      );
    }

    const txId = await contract.methods.transfer(to, amount).send();

    const symbol = await contract.methods.symbol().call();
    const decimals = await contract.methods.decimals().call();

    const decimalsNum = Number(decimals);
    const divisor = BigInt(10) ** BigInt(decimalsNum);
    const formatted = (Number(BigInt(amount)) / Number(divisor)).toString();

    return {
      txHash: txId,
      amount: { raw: amount, formatted },
      token: { symbol: String(symbol), decimals: decimalsNum },
    };
  } catch (error: any) {
    throw new Error(`Failed to transfer TRC20: ${error.message}`);
  }
}

/**
 * Approve a spender to spend TRC20 tokens.
 * @param amount - Raw approval amount.
 */
export async function approveTRC20(
  tokenAddress: string,
  spenderAddress: string,
  amount: string,
  privateKey: string,
  network = "mainnet",
) {
  const tronWeb = getWallet(privateKey, network);

  try {
    const contract = await tronWeb.contract().at(tokenAddress);
    const txId = await contract.methods.approve(spenderAddress, amount).send();
    return txId;
  } catch (error: any) {
    throw new Error(`Failed to approve TRC20: ${error.message}`);
  }
}
