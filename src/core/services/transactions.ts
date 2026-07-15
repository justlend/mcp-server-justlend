import { getTronWeb } from "./clients.js";

type Transaction = any;
type TransactionInfo = any;

/**
 * Get full transaction details by hash.
 */
export async function getTransaction(txHash: string, network = "mainnet"): Promise<Transaction> {
  const tronWeb = getTronWeb(network);
  return tronWeb.trx.getTransaction(txHash);
}

/**
 * Get transaction info (receipt) by hash.
 */
export async function getTransactionInfo(
  txHash: string,
  network = "mainnet",
): Promise<TransactionInfo> {
  const tronWeb = getTronWeb(network);
  return tronWeb.trx.getTransactionInfo(txHash);
}

/** Alias for tools expecting 'receipt'. */
export const getTransactionReceipt = getTransactionInfo;

/**
 * Poll until a transaction is confirmed and return its info.
 * Throws after maxAttempts * 2s if it never confirms.
 *
 * With `requireSuccess: true`, also throws when the tx is mined but its receipt
 * reports a non-SUCCESS result (REVERT / OUT_OF_ENERGY / …) — so a caller that
 * gates a follow-up write on this tx having actually landed (e.g. the approve
 * reset-to-0 → re-approve sequence) does not proceed on a failed tx. Off by
 * default because some callers decode the failed receipt themselves (contract
 * deploy) or intentionally fall back on it (energy-rental log parsing).
 */
export async function waitForTransaction(
  txHash: string,
  network = "mainnet",
  options: { requireSuccess?: boolean } = {},
): Promise<TransactionInfo> {
  const tronWeb = getTronWeb(network);
  const maxAttempts = 30;
  const interval = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    let info: any;
    try {
      info = await tronWeb.trx.getTransactionInfo(txHash);
    } catch {
      // RPC hiccup / not indexed yet — keep polling.
      info = undefined;
    }
    if (info && info.id) {
      // The success-check is deliberately outside the swallowing catch above so
      // an on-chain failure surfaces immediately instead of polling to timeout.
      if (options.requireSuccess && info.receipt?.result && info.receipt.result !== "SUCCESS") {
        const revertReason = info.resMessage
          ? Buffer.from(info.resMessage, "hex").toString()
          : `status ${info.receipt.result}`;
        throw new Error(`Transaction ${txHash} failed on-chain: ${revertReason}`);
      }
      return info;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Transaction ${txHash} not confirmed after ${maxAttempts * interval}ms`);
}
