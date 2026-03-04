/**
 * JustLend V1 Lending Operations
 *
 * VERSION: JustLend V1
 * All lending methods (supply, withdraw, borrow, repay, collateral management) are for JustLend V1.
 * Based on Compound V2 protocol architecture with jToken (cToken) mechanism.
 *
 * Core operations:
 * - Supply/Mint: Deposit assets to receive jTokens
 * - Withdraw/Redeem: Burn jTokens to receive underlying assets
 * - Borrow: Take loans against supplied collateral
 * - Repay: Return borrowed assets
 * - Enter/Exit Market: Enable/disable assets as collateral
 */

import { getWallet } from "./clients.js";
import { getJustLendAddresses, getJTokenInfo, type JTokenInfo } from "../chains.js";
import { JTOKEN_ABI, JTRX_MINT_ABI, COMPTROLLER_ABI, TRC20_ABI } from "../abis.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/**
 * Wait for a transaction to be confirmed. Returns transaction info.
 */
async function waitForTx(txID: string, network: string, maxRetries = 20, intervalMs = 3000): Promise<any> {
  const { getTronWeb } = await import("./clients.js");
  const tronWeb = getTronWeb(network);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const info = await tronWeb.trx.getTransactionInfo(txID);
      if (info && info.id) return info;
    } catch { /* not found yet */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction ${txID} not confirmed after ${maxRetries * intervalMs / 1000}s`);
}

function resolveJToken(symbolOrAddress: string, network: string): JTokenInfo {
  const info = getJTokenInfo(symbolOrAddress, network);
  if (!info) throw new Error(`Unknown jToken market: ${symbolOrAddress}. Use get_supported_markets to list available markets.`);
  return info;
}

// ============================================================================
// SUPPLY (Mint jTokens)
// ============================================================================

/**
 * Supply (deposit) assets into a JustLend V1 market.
 *
 * VERSION: V1 - Uses JustLend V1 mint() function (Compound V2-style)
 *
 * For TRC20 tokens: requires prior approve() of underlying to jToken contract.
 * For TRX: sends TRX as callValue.
 *
 * @param privateKey - Wallet private key
 * @param jTokenSymbol - e.g. "jUSDT", "jTRX"
 * @param amount - Amount in underlying token units (human-readable, e.g. "100.5")
 * @param network - Network name
 * @returns Transaction ID
 */
export async function supply(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals));

  if (info.underlyingSymbol === "TRX" || !info.underlying) {
    // jTRX: mint() is payable, amount via callValue (in Sun)
    const contract = tronWeb.contract(JTRX_MINT_ABI, info.address);
    const txID = await contract.methods.mint().send({ callValue: amountRaw.toString() });
    return { txID, jTokenSymbol, amount, message: `Supplied ${amount} TRX to ${jTokenSymbol}` };
  } else {
    // TRC20: first check/do approval, then mint(amount)
    const contract = tronWeb.contract(JTOKEN_ABI, info.address);
    const txID = await contract.methods.mint(amountRaw.toString()).send();
    return { txID, jTokenSymbol, amount, message: `Supplied ${amount} ${info.underlyingSymbol} to ${jTokenSymbol}` };
  }
}

// ============================================================================
// WITHDRAW (Redeem jTokens)
// ============================================================================

/**
 * Withdraw assets from a JustLend V1 market.
 *
 * VERSION: V1 - Uses JustLend V1 redeemUnderlying() function (Compound V2-style)
 *
 * @param privateKey - Wallet private key
 * @param jTokenSymbol - e.g. "jUSDT"
 * @param amount - Amount in underlying units to withdraw (human-readable)
 * @param network - Network name
 */
export async function withdraw(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals));

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const txID = await contract.methods.redeemUnderlying(amountRaw.toString()).send();
  return { txID, jTokenSymbol, amount, message: `Withdrew ${amount} ${info.underlyingSymbol} from ${jTokenSymbol}` };
}

/**
 * Withdraw ALL supply from a V1 market by redeeming all jTokens.
 *
 * VERSION: V1 - Uses JustLend V1 redeem() function
 */
export async function withdrawAll(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const walletAddress = tronWeb.defaultAddress.base58;
  const jTokenBalance = await contract.methods.balanceOf(walletAddress).call();

  if (BigInt(jTokenBalance) === 0n) {
    throw new Error(`No ${jTokenSymbol} balance to withdraw`);
  }

  const txID = await contract.methods.redeem(jTokenBalance.toString()).send();
  return { txID, jTokenSymbol, message: `Withdrew all supply from ${jTokenSymbol}` };
}

// ============================================================================
// BORROW
// ============================================================================

/**
 * Borrow assets from a JustLend V1 market.
 *
 * VERSION: V1 - Uses JustLend V1 borrow() function (Compound V2-style)
 * Requires the user to have collateral enabled (enterMarkets) and sufficient liquidity.
 */
export async function borrow(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals));

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const txID = await contract.methods.borrow(amountRaw.toString()).send();
  return { txID, jTokenSymbol, amount, message: `Borrowed ${amount} ${info.underlyingSymbol} from ${jTokenSymbol}` };
}

// ============================================================================
// REPAY
// ============================================================================

/**
 * Repay borrowed assets to a JustLend V1 market.
 *
 * VERSION: V1 - Uses JustLend V1 repayBorrow() function (Compound V2-style)
 *
 * For TRC20: requires approval of underlying to jToken.
 * For TRX: sends callValue.
 * Use amount = "-1" or "max" to repay full borrow balance.
 */
export async function repay(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);

  const isMax = amount === "-1" || amount.toLowerCase() === "max";

  if (info.underlyingSymbol === "TRX" || !info.underlying) {
    // For TRX repay, we need the exact borrow balance
    const contract = tronWeb.contract(JTOKEN_ABI, info.address);
    const walletAddress = tronWeb.defaultAddress.base58;
    const borrowBal = BigInt(await contract.methods.borrowBalanceStored(walletAddress).call());

    // Add a small buffer (0.1%) for accrued interest
    const repayAmount = isMax
      ? borrowBal + borrowBal / 1000n
      : BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals));

    const txID = await contract.methods.repayBorrow().send({ callValue: repayAmount.toString() });
    return { txID, jTokenSymbol, amount: isMax ? "max" : amount, message: `Repaid ${isMax ? "all" : amount} TRX to ${jTokenSymbol}` };
  } else {
    const repayAmount = isMax ? MAX_UINT256 : BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals)).toString();
    const contract = tronWeb.contract(JTOKEN_ABI, info.address);
    const txID = await contract.methods.repayBorrow(repayAmount).send();
    return { txID, jTokenSymbol, amount: isMax ? "max" : amount, message: `Repaid ${isMax ? "all" : amount} ${info.underlyingSymbol} to ${jTokenSymbol}` };
  }
}

// ============================================================================
// COLLATERAL MANAGEMENT (Enter/Exit Markets)
// ============================================================================

/**
 * Enable a jToken market as collateral in V1 Comptroller.
 *
 * VERSION: V1 - Uses JustLend V1 enterMarkets() function
 */
export async function enterMarket(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);

  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const txID = await comptroller.methods.enterMarkets([info.address]).send();
  return { txID, message: `Enabled ${jTokenSymbol} as collateral` };
}

/**
 * Disable a jToken market as collateral in V1 Comptroller.
 *
 * VERSION: V1 - Uses JustLend V1 exitMarket() function
 * Will fail if it would make the account undercollateralized.
 */
export async function exitMarket(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);

  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const txID = await comptroller.methods.exitMarket(info.address).send();
  return { txID, message: `Disabled ${jTokenSymbol} as collateral` };
}

// ============================================================================
// APPROVE (TRC20 underlying for jToken)
// ============================================================================

/**
 * Approve a V1 jToken contract to spend underlying TRC20 tokens.
 *
 * VERSION: V1 - Approves underlying token for JustLend V1 jToken contracts
 * Required before supply() or repay() for TRC20-backed markets.
 *
 * @param amount - Amount to approve (human-readable), or "max" for unlimited
 */
export async function approveUnderlying(
  privateKey: string,
  jTokenSymbol: string,
  amount: string = "max",
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  if (!info.underlying) throw new Error(`${jTokenSymbol} is native TRX — no approval needed`);

  const tronWeb = getWallet(privateKey, network);
  const token = tronWeb.contract(TRC20_ABI, info.underlying);

  const approveAmount = amount.toLowerCase() === "max"
    ? MAX_UINT256
    : BigInt(Math.floor(parseFloat(amount) * 10 ** info.underlyingDecimals)).toString();

  const txID = await token.methods.approve(info.address, approveAmount).send();
  return { txID, message: `Approved ${amount === "max" ? "unlimited" : amount} ${info.underlyingSymbol} for ${jTokenSymbol}` };
}

// ============================================================================
// CLAIM REWARDS
// ============================================================================

/**
 * Claim accrued JustLend rewards for the connected wallet.
 */
export async function claimRewards(
  privateKey: string,
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58;

  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const txID = await comptroller.methods.claimReward(walletAddress).send();
  return { txID, message: `Claimed JustLend rewards for ${walletAddress}` };
}
