import { getSigningClient, signTransactionWithWallet } from "./wallet.js";
import { utils } from "./utils.js";
import { checkResourceSufficiency } from "./lending.js";
import { safeSend } from "./contracts.js";
import { TRC20_ABI } from "../abis.js";

/**
 * Transfer TRX to an address.
 * @param amount - Amount in TRX (not Sun).
 */
export async function transferTRX(
  to: string,
  amount: string,
  network = "mainnet",
) {
  const tronWeb = await getSigningClient(network);
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

  if (BigInt(amountSun) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `TRX transfer amount exceeds the safe SDK limit. Amount in Sun must be <= ${Number.MAX_SAFE_INTEGER}.`,
    );
  }

  // Build unsigned transaction, sign with agent-wallet, then broadcast
  const unsignedTx = await tronWeb.transactionBuilder.sendTrx(to, Number(amountSun), walletAddress);
  const signedTx = await signTransactionWithWallet(unsignedTx, undefined, network);
  const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);

  if ((broadcast as any).result) {
    return (broadcast as any).txid || (broadcast as any).transaction?.txID || unsignedTx.txID;
  }
  const errorMsg = (broadcast as any).message
    ? Buffer.from((broadcast as any).message, "hex").toString()
    : JSON.stringify(broadcast);
  throw new Error(`Broadcast failed: ${errorMsg}`);
}

/**
 * Transfer TRC20 tokens.
 * @param amount - Raw token amount (accounting for decimals).
 */
export async function transferTRC20(
  tokenAddress: string,
  to: string,
  amount: string,
  network = "mainnet",
) {
  const tronWeb = await getSigningClient(network);

  try {
    const contract = await tronWeb.contract().at(tokenAddress);

    // Check token balance before transfer
    const walletAddress = tronWeb.defaultAddress.base58 as string;
    const balance = BigInt(await contract.methods.balanceOf(walletAddress).call());
    if (balance < BigInt(amount)) {
      const symbol = await contract.methods.symbol().call();
      const decimals = Number(await contract.methods.decimals().call());
      throw new Error(
        `Insufficient ${symbol} balance. Have ${utils.formatUnits(balance, decimals)}, need ${utils.formatUnits(BigInt(amount), decimals)}`,
      );
    }

    const { txID: txId } = await safeSend({
      address: tokenAddress,
      abi: TRC20_ABI,
      functionName: "transfer",
      args: [to, amount]
    }, network);

    const symbol = await contract.methods.symbol().call();
    const decimals = await contract.methods.decimals().call();

    const decimalsNum = Number(decimals);
    const formatted = utils.formatUnits(BigInt(amount), decimalsNum);

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
  network = "mainnet",
) {
  try {
    const { txID: txId } = await safeSend({
      address: tokenAddress,
      abi: TRC20_ABI,
      functionName: "approve",
      args: [spenderAddress, amount]
    }, network);
    return txId;
  } catch (error: any) {
    throw new Error(`Failed to approve TRC20: ${error.message}`);
  }
}
