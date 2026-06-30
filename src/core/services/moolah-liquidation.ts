/**
 * JustLend V2 (Moolah) — Liquidation operations via PublicLiquidatorProxy.
 * The liquidator repays part of a borrower's debt and seizes collateral at a discount.
 */
import { getSigningClient } from "./wallet.js";
import { safeSend } from "./contracts.js";
import { getMoolahAddresses } from "../chains.js";
import { TRC20_ABI, PUBLIC_LIQUIDATOR_ABI } from "../abis.js";
import { utils } from "./utils.js";
import { getMoolahLoanTokenAmountNeed } from "./moolah-query.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

// ── Approve liquidator contract to spend loan token ───────────────────────────

export async function approveLiquidatorToken(params: {
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  amount?: string;
  network?: string;
}): Promise<{ txID: string; message: string; warning?: string }> {
  const { tokenAddress, tokenSymbol, tokenDecimals, amount, network = "mainnet" } = params;
  if (!utils.isAddress(tokenAddress)) {
    throw new Error(`Invalid TRON token address: ${tokenAddress}`);
  }
  if (amount === undefined || amount === null || amount === "") {
    throw new Error(
      `approve_liquidator_token requires an explicit amount. Pass the exact value you intend to use ` +
      `(e.g. amount='100'), or pass amount='max' to grant unlimited allowance (NOT recommended — see warning).`,
    );
  }
  const isMax = amount.toLowerCase() === "max";
  // Don't trust caller-supplied decimals: validate before scaling (and before any
  // network round-trip) so a wrong value — e.g. an LLM defaulting to 18 for a
  // 6-decimal token — can't silently inflate the approval by orders of magnitude.
  // In the max branch decimals are unused, so validation is skipped there.
  if (!isMax) {
    utils.assertValidDecimals(tokenDecimals, tokenSymbol);
  }
  const { publicLiquidatorProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const token = tronWeb.contract(TRC20_ABI, tokenAddress);

  const approveRaw = isMax ? MAX_UINT256 : utils.parseUnits(amount, tokenDecimals).toString();

  const currentAllowance = BigInt(await token.methods.allowance(walletAddress, publicLiquidatorProxy).call());
  if (!isMax && currentAllowance >= BigInt(approveRaw)) {
    return { txID: "", message: `${tokenSymbol} already has sufficient allowance for liquidator.` };
  }

  const { txID } = await safeSend(
    {
      address: tokenAddress,
      abi: TRC20_ABI,
      functionName: "approve",
      args: [publicLiquidatorProxy, approveRaw],
    },
    network,
  );
  const result: { txID: string; message: string; warning?: string } = {
    txID,
    message: `Approved ${isMax ? "unlimited" : amount} ${tokenSymbol} for Moolah liquidator. TX: ${txID}`,
  };
  if (isMax) {
    result.warning =
      `⚠️ UNLIMITED APPROVAL granted. The Moolah public liquidator contract can now spend your entire ` +
      `${tokenSymbol} balance — present and future — without further confirmation. ` +
      `If you no longer need this, revoke with: approve_liquidator_token tokenAddress='${tokenAddress}' amount='0'.`;
  }
  return result;
}

// ── Liquidate ─────────────────────────────────────────────────────────────────

/**
 * Liquidate an undercollateralized Moolah position.
 *
 * Provide EITHER seizedAssets (collateral to seize) OR repaidShares (borrow shares to repay),
 * setting the other to "0". Do NOT provide both non-zero.
 *
 * Use getMoolahLoanTokenAmountNeed() to estimate the loan token cost before calling this.
 */
export async function moolahLiquidate(params: {
  marketId: string;
  borrower: string;
  seizedAssets: string;  // collateral units to seize, or "0"
  repaidShares: string;  // borrow shares to repay, or "0"
  network?: string;
}): Promise<{
  txID: string;
  marketId: string;
  borrower: string;
  seizedAssets: string;
  repaidShares: string;
  message: string;
}> {
  const { marketId, borrower, seizedAssets, repaidShares, network = "mainnet" } = params;

  if (!utils.isAddress(borrower)) {
    throw new Error(`Invalid TRON borrower address: ${borrower}`);
  }

  const seizedBig = BigInt(seizedAssets);
  const repaidBig = BigInt(repaidShares);

  if (seizedBig === 0n && repaidBig === 0n) {
    throw new Error("Provide either seizedAssets or repaidShares (not both zero).");
  }
  if (seizedBig > 0n && repaidBig > 0n) {
    throw new Error("Provide EITHER seizedAssets OR repaidShares, not both non-zero.");
  }

  const { publicLiquidatorProxy } = getMoolahAddresses(network);

  // Estimate loan token needed so caller can verify allowance was sufficient
  const loanNeeded = await getMoolahLoanTokenAmountNeed(marketId, seizedBig, repaidBig, network);
  if (loanNeeded === 0n) {
    throw new Error(`Loan token amount needed is 0 — position may already be healthy or marketId is incorrect.`);
  }

  const { txID } = await safeSend(
    {
      address: publicLiquidatorProxy,
      abi: PUBLIC_LIQUIDATOR_ABI,
      functionName: "liquidate",
      args: [marketId, borrower, seizedAssets, repaidShares],
    },
    network,
  );

  const desc = seizedBig > 0n
    ? `seize ${seizedAssets} collateral`
    : `repay ${repaidShares} borrow shares`;

  return {
    txID,
    marketId,
    borrower,
    seizedAssets,
    repaidShares,
    message: `Liquidated position: ${desc} for borrower ${borrower}. TX: ${txID}`,
  };
}
