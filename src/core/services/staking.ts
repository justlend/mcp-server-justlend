import { getSigningClient, signTransactionWithWallet } from "./wallet.js";

/**
 * Freeze TRX to obtain BANDWIDTH or ENERGY resources (Stake 2.0).
 * @param amount - Amount in Sun (as a decimal string for precision).
 * @param resource - "BANDWIDTH" or "ENERGY".
 * @returns Transaction hash.
 */
export async function freezeBalanceV2(
  amount: string,
  resource: "BANDWIDTH" | "ENERGY" = "BANDWIDTH",
  network = "mainnet",
) {
  const tronWeb = await getSigningClient(network);

  try {
    const transaction = await tronWeb.transactionBuilder.freezeBalanceV2(
      amount as any,
      resource,
      tronWeb.defaultAddress.base58 || undefined,
    );
    const signedTx = await signTransactionWithWallet(transaction);
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    if (result.result) return result.txid;
    throw new Error(`FreezeBalanceV2 failed: ${JSON.stringify(result)}`);
  } catch (error: any) {
    throw new Error(`Failed to freeze balance V2: ${error.message}`);
  }
}

/**
 * Unfreeze staked TRX to release resources (Stake 2.0).
 * @param amount - Amount in Sun (as a decimal string for precision).
 * @param resource - "BANDWIDTH" or "ENERGY".
 * @returns Transaction hash.
 */
export async function unfreezeBalanceV2(
  amount: string,
  resource: "BANDWIDTH" | "ENERGY" = "BANDWIDTH",
  network = "mainnet",
) {
  const tronWeb = await getSigningClient(network);

  try {
    const transaction = await tronWeb.transactionBuilder.unfreezeBalanceV2(
      amount as any,
      resource,
      tronWeb.defaultAddress.base58 || undefined,
    );
    const signedTx = await signTransactionWithWallet(transaction);
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    if (result.result) return result.txid;
    throw new Error(`UnfreezeBalanceV2 failed: ${JSON.stringify(result)}`);
  } catch (error: any) {
    throw new Error(`Failed to unfreeze balance V2: ${error.message}`);
  }
}

/**
 * Withdraw expired unfrozen balance after the unbonding period ends (Stake 2.0).
 * @returns Transaction hash.
 */
export async function withdrawExpireUnfreeze(network = "mainnet") {
  const tronWeb = await getSigningClient(network);

  try {
    const transaction = await tronWeb.transactionBuilder.withdrawExpireUnfreeze(
      tronWeb.defaultAddress.base58 || undefined,
    );
    const signedTx = await signTransactionWithWallet(transaction);
    const result = await tronWeb.trx.sendRawTransaction(signedTx);

    if (result.result) return result.txid;
    throw new Error(`WithdrawExpireUnfreeze failed: ${JSON.stringify(result)}`);
  } catch (error: any) {
    throw new Error(`Failed to withdraw expire unfreeze: ${error.message}`);
  }
}
