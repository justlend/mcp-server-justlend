/**
 * JustLend V2 (Moolah) — Market supply-collateral / borrow / repay operations.
 * TRX markets route through TrxProviderProxy; TRC20 markets use MoolahProxy directly.
 */
import { getSigningClient } from "./wallet.js";
import { safeSend, readContract } from "./contracts.js";
import { getMoolahAddresses } from "../chains.js";
import { TRC20_ABI, MOOLAH_CORE_ABI, TRX_PROVIDER_ABI } from "../abis.js";
import { utils } from "./utils.js";
import { toHexAddress } from "./address.js";
import {
  getMoolahMarketParams,
  getMoolahUserPosition,
  getMoolahMarketState,
} from "./moolah-query.js";
import type { MarketParams } from "./moolah-query.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const GAS_BUFFER_SUN = 20_000_000n;
// Small buffer added to TRX repay callValue to cover per-block interest accrual between query and tx
const REPAY_BUFFER_SUN = 1_000_000n;

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Build the 5-element tuple array required by TronWeb for MarketParams tuple encoding. */
function toParamsTuple(p: MarketParams): string[] {
  return [
    toHexAddress(p.loanToken),
    toHexAddress(p.collateralToken),
    toHexAddress(p.oracle),
    toHexAddress(p.irm),
    p.lltv.toString(),
  ];
}

/** Read TRC20 decimals directly from the token contract. */
async function getTokenDecimals(tokenAddress: string, network: string): Promise<number> {
  const r = await readContract(
    { address: tokenAddress, functionName: "decimals", args: [], abi: TRC20_ABI },
    network,
  );
  return Number(r);
}

// ── Approve MoolahProxy to spend TRC20 ───────────────────────────────────────

export async function approveMoolahProxy(params: {
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
      `approve_moolah_proxy requires an explicit amount. Pass the exact value you intend to use ` +
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
  const { moolahProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const token = tronWeb.contract(TRC20_ABI, tokenAddress);

  const approveRaw = isMax ? MAX_UINT256 : utils.parseUnits(amount, tokenDecimals).toString();

  const currentAllowance = BigInt(await token.methods.allowance(walletAddress, moolahProxy).call());
  if (!isMax && currentAllowance >= BigInt(approveRaw)) {
    return { txID: "", message: `${tokenSymbol} already has sufficient allowance for Moolah.` };
  }

  const { txID } = await safeSend(
    {
      address: tokenAddress,
      abi: TRC20_ABI,
      functionName: "approve",
      args: [moolahProxy, approveRaw],
    },
    network,
  );
  const result: { txID: string; message: string; warning?: string } = {
    txID,
    message: `Approved ${isMax ? "unlimited" : amount} ${tokenSymbol} for Moolah. TX: ${txID}`,
  };
  if (isMax) {
    result.warning =
      `⚠️ UNLIMITED APPROVAL granted. The Moolah proxy contract can now spend your entire ` +
      `${tokenSymbol} balance — present and future — without further confirmation. ` +
      `If you no longer need this, revoke with: approve_moolah_proxy tokenAddress='${tokenAddress}' amount='0'.`;
  }
  return result;
}

// ── Supply Collateral ─────────────────────────────────────────────────────────

export async function moolahSupplyCollateral(params: {
  marketId: string;
  amount: string;
  network?: string;
}): Promise<{ txID: string; marketId: string; amount: string; message: string }> {
  const { marketId, amount, network = "mainnet" } = params;
  const { moolahProxy, trxProviderProxy, wtrxProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  const marketParams = await getMoolahMarketParams(marketId, network);
  const isCollateralTRX = marketParams.collateralToken === wtrxProxy;
  const decimals = isCollateralTRX ? 6 : await getTokenDecimals(marketParams.collateralToken, network);
  const amountRaw = utils.parseUnits(amount, decimals);
  const paramsTuple = toParamsTuple(marketParams);

  if (isCollateralTRX) {
    const balance = BigInt(await tronWeb.trx.getBalance(walletAddress));
    if (balance < amountRaw + GAS_BUFFER_SUN) {
      throw new Error(
        `Insufficient TRX. Have ${utils.formatUnits(balance, 6)} TRX, ` +
        `need ~${utils.formatUnits(amountRaw + GAS_BUFFER_SUN, 6)} TRX (collateral + gas).`,
      );
    }
    const { txID } = await safeSend(
      {
        address: trxProviderProxy,
        abi: TRX_PROVIDER_ABI,
        functionName: "supplyCollateral",
        args: [paramsTuple, walletAddress, "0x"],
        callValue: amountRaw.toString(),
      },
      network,
    );
    return { txID, marketId, amount, message: `Supplied ${amount} TRX as collateral in market. TX: ${txID}` };
  }

  // TRC20 path
  const token = tronWeb.contract(TRC20_ABI, marketParams.collateralToken);
  const balance = BigInt(await token.methods.balanceOf(walletAddress).call());
  if (balance < amountRaw) {
    throw new Error(
      `Insufficient collateral balance. Have ${utils.formatUnits(balance, decimals)}, need ${amount}.`,
    );
  }
  const allowance = BigInt(await token.methods.allowance(walletAddress, moolahProxy).call());
  if (allowance < amountRaw) {
    throw new Error(
      `Insufficient allowance for Moolah (current: ${utils.formatUnits(allowance, decimals)}). ` +
      `Call approve_moolah_proxy first.`,
    );
  }
  const { txID } = await safeSend(
    {
      address: moolahProxy,
      abi: MOOLAH_CORE_ABI,
      functionName: "supplyCollateral",
      args: [paramsTuple, amountRaw.toString(), walletAddress, "0x"],
    },
    network,
  );
  return { txID, marketId, amount, message: `Supplied ${amount} collateral in market. TX: ${txID}` };
}

// ── Withdraw Collateral ───────────────────────────────────────────────────────

export async function moolahWithdrawCollateral(params: {
  marketId: string;
  amount: string;  // "max" only allowed when no active borrows
  network?: string;
}): Promise<{ txID: string; marketId: string; amount: string; message: string }> {
  const { marketId, network = "mainnet" } = params;
  const { moolahProxy, trxProviderProxy, wtrxProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  const marketParams = await getMoolahMarketParams(marketId, network);
  const isCollateralTRX = marketParams.collateralToken === wtrxProxy;
  const decimals = isCollateralTRX ? 6 : await getTokenDecimals(marketParams.collateralToken, network);
  const paramsTuple = toParamsTuple(marketParams);

  let amount = params.amount;
  if (amount.toLowerCase() === "max") {
    const position = await getMoolahUserPosition(marketId, walletAddress, network);
    if (position.collateral === 0n) {
      throw new Error(`No collateral to withdraw from this market.`);
    }
    if (position.borrowShares > 0n) {
      throw new Error(`Cannot withdraw all collateral while active borrows exist. Repay borrows first or specify an amount.`);
    }
    amount = utils.formatUnits(position.collateral, decimals);
  }
  const amountRaw = utils.parseUnits(amount, decimals);
  const contract = isCollateralTRX ? trxProviderProxy : moolahProxy;
  const abi = isCollateralTRX ? TRX_PROVIDER_ABI : MOOLAH_CORE_ABI;

  const { txID } = await safeSend(
    {
      address: contract,
      abi,
      functionName: "withdrawCollateral",
      args: [paramsTuple, amountRaw.toString(), walletAddress, walletAddress],
    },
    network,
  );
  return { txID, marketId, amount, message: `Withdrew ${amount} collateral from market. TX: ${txID}` };
}

// ── Borrow ────────────────────────────────────────────────────────────────────

export async function moolahBorrow(params: {
  marketId: string;
  amount: string;
  network?: string;
}): Promise<{ txID: string; marketId: string; amount: string; message: string }> {
  const { marketId, amount, network = "mainnet" } = params;
  const { moolahProxy, trxProviderProxy, wtrxProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  const marketParams = await getMoolahMarketParams(marketId, network);
  const isLoanTRX = marketParams.loanToken === wtrxProxy;
  const decimals = isLoanTRX ? 6 : await getTokenDecimals(marketParams.loanToken, network);
  const amountRaw = utils.parseUnits(amount, decimals);
  const paramsTuple = toParamsTuple(marketParams);
  const contract = isLoanTRX ? trxProviderProxy : moolahProxy;
  const abi = isLoanTRX ? TRX_PROVIDER_ABI : MOOLAH_CORE_ABI;

  // assets = amountRaw, shares = 0 (borrow by exact asset amount)
  const { txID } = await safeSend(
    {
      address: contract,
      abi,
      functionName: "borrow",
      args: [paramsTuple, amountRaw.toString(), "0", walletAddress, walletAddress],
    },
    network,
  );
  return { txID, marketId, amount, message: `Borrowed ${amount} from market. TX: ${txID}` };
}

// ── Repay ─────────────────────────────────────────────────────────────────────

export async function moolahRepay(params: {
  marketId: string;
  amount: string;  // "max" repays full borrow using borrowShares
  network?: string;
}): Promise<{ txID: string; marketId: string; amount: string; message: string }> {
  const { marketId, network = "mainnet" } = params;
  const { moolahProxy, trxProviderProxy, wtrxProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  const marketParams = await getMoolahMarketParams(marketId, network);
  const isLoanTRX = marketParams.loanToken === wtrxProxy;
  const decimals = isLoanTRX ? 6 : await getTokenDecimals(marketParams.loanToken, network);
  const paramsTuple = toParamsTuple(marketParams);

  let assetsArg: string;
  let sharesArg: string;
  let displayAmount: string;
  let callValue: string | undefined;

  if (params.amount.toLowerCase() === "max") {
    const position = await getMoolahUserPosition(marketId, walletAddress, network);
    if (position.borrowShares === 0n) {
      throw new Error(`No active borrow to repay in this market.`);
    }
    // Use shares=position.borrowShares, assets=0 to repay the full position
    assetsArg = "0";
    sharesArg = position.borrowShares.toString();

    if (isLoanTRX) {
      // Compute the approximate TRX needed at the current block, then add a small buffer
      const state = await getMoolahMarketState(marketId, network);
      const assetsNeeded = state.totalBorrowShares > 0n
        ? (position.borrowShares * state.totalBorrowAssets + state.totalBorrowShares - 1n) / state.totalBorrowShares
        : position.borrowShares;
      callValue = (assetsNeeded + REPAY_BUFFER_SUN).toString();
      displayAmount = utils.formatUnits(assetsNeeded, 6);
    } else {
      displayAmount = "all";
    }
  } else {
    displayAmount = params.amount;
    assetsArg = utils.parseUnits(params.amount, decimals).toString();
    sharesArg = "0";
    if (isLoanTRX) {
      callValue = assetsArg;
    }
  }

  if (!isLoanTRX) {
    // TRC20: check allowance before repay
    const amountBig = BigInt(assetsArg) > 0n ? BigInt(assetsArg) : undefined;
    const token = tronWeb.contract(TRC20_ABI, marketParams.loanToken);
    const allowance = BigInt(await token.methods.allowance(walletAddress, moolahProxy).call());
    if (amountBig !== undefined && allowance < amountBig) {
      throw new Error(
        `Insufficient allowance for Moolah (current: ${utils.formatUnits(allowance, decimals)}). ` +
        `Call approve_moolah_proxy first.`,
      );
    }
  }

  const contract = isLoanTRX ? trxProviderProxy : moolahProxy;
  const abi = isLoanTRX ? TRX_PROVIDER_ABI : MOOLAH_CORE_ABI;

  const { txID } = await safeSend(
    {
      address: contract,
      abi,
      functionName: "repay",
      args: [paramsTuple, assetsArg, sharesArg, walletAddress, "0x"],
      ...(callValue ? { callValue } : {}),
    },
    network,
  );
  return { txID, marketId, amount: displayAmount, message: `Repaid ${displayAmount} to market. TX: ${txID}` };
}

// ── Supply Collateral + Borrow (composite) ────────────────────────────────────

export async function moolahSupplyCollateralAndBorrow(params: {
  marketId: string;
  collateralAmount: string;
  borrowAmount: string;
  network?: string;
}): Promise<{
  supplyTxID: string;
  borrowTxID: string;
  marketId: string;
  collateralAmount: string;
  borrowAmount: string;
  message: string;
}> {
  const { marketId, collateralAmount, borrowAmount, network = "mainnet" } = params;

  const supplyResult = await moolahSupplyCollateral({ marketId, amount: collateralAmount, network });
  const borrowResult = await moolahBorrow({ marketId, amount: borrowAmount, network });

  return {
    supplyTxID: supplyResult.txID,
    borrowTxID: borrowResult.txID,
    marketId,
    collateralAmount,
    borrowAmount,
    message:
      `Supplied ${collateralAmount} collateral (TX: ${supplyResult.txID}) ` +
      `and borrowed ${borrowAmount} (TX: ${borrowResult.txID}).`,
  };
}
