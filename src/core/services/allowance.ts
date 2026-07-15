import { safeSend } from "./contracts.js";
import { waitForTransaction } from "./transactions.js";
import { TRC20_ABI } from "../abis.js";

// TRON USDT / USDC / USDJ are TetherToken-style: their `approve()` reverts when
// the current allowance is already non-zero, so the allowance must be reset to 0
// before a new non-zero approval. Matched by contract address (robust) with a
// symbol fallback that mirrors app-justlend's `NEEDS_APPROVE_RESET = {USDT,USDC,USDJ}`.
// Base58 addresses are case-sensitive — do NOT lowercase.
const RESET_TO_ZERO_TOKENS = new Set<string>([
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // USDT (mainnet)
  "TMwFHYXLJaRUPeW6421aqXL4ZEzPRFGkGT", // USDJ (mainnet)
  "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", // USDC (mainnet)
]);
const RESET_TO_ZERO_SYMBOLS = new Set<string>(["USDT", "USDC", "USDJ"]);

/**
 * Whether a token's `approve()` requires a reset-to-0 before a new non-zero
 * approval (TetherToken semantics). Address match is authoritative; the symbol
 * fallback covers testnet mocks / caller-supplied tokens that reuse the symbol.
 */
export function requiresAllowanceReset(tokenAddress?: string, symbol?: string): boolean {
  if (tokenAddress && RESET_TO_ZERO_TOKENS.has(tokenAddress)) return true;
  if (symbol && RESET_TO_ZERO_SYMBOLS.has(symbol.trim().toUpperCase())) return true;
  return false;
}

export interface ApproveWithResetParams {
  tokenAddress: string;
  spender: string;
  /** Target allowance in raw units. "0" revokes. */
  approveRaw: string;
  /** Current on-chain allowance (owner → spender), already read by the caller. */
  currentAllowance: bigint;
  /** Optional token symbol for the reset-list fallback. */
  symbol?: string;
  network: string;
}

/**
 * Approve `spender` for `approveRaw` of `tokenAddress`, inserting a reset-to-0
 * first when required — a TetherToken-style token (USDT/USDC/USDJ) with a
 * non-zero current allowance and a non-zero target. A revoke (`approveRaw = "0"`)
 * never needs the reset: `approve(0)` is always accepted.
 *
 * The reset tx is awaited to confirmation before the target approve, so the
 * target approve's mainnet pre-flight simulation (inside `safeSend`) sees the
 * zeroed allowance — otherwise `safeSend` would fail-closed on the still-non-zero
 * state and the approval could never complete.
 *
 * Returns both tx ids: `resetTxID` is present only when a reset was performed.
 */
export async function approveWithReset(
  params: ApproveWithResetParams,
): Promise<{ resetTxID?: string; txID: string }> {
  const { tokenAddress, spender, approveRaw, currentAllowance, symbol, network } = params;
  const target = BigInt(approveRaw);

  let resetTxID: string | undefined;
  if (target > 0n && currentAllowance > 0n && requiresAllowanceReset(tokenAddress, symbol)) {
    const reset = await safeSend(
      { address: tokenAddress, abi: TRC20_ABI, functionName: "approve", args: [spender, "0"] },
      network,
    );
    resetTxID = reset.txID;
    // Wait for the reset to be mined AND succeed before the next approve, so it
    // simulates against a 0 allowance (TetherToken reverts non-zero -> non-zero
    // otherwise). requireSuccess: a reverted reset aborts here instead of falling
    // through to a target approve that would only fail-close later.
    await waitForTransaction(resetTxID, network, { requireSuccess: true });
  }

  const { txID } = await safeSend(
    { address: tokenAddress, abi: TRC20_ABI, functionName: "approve", args: [spender, approveRaw] },
    network,
  );
  return { resetTxID, txID };
}
