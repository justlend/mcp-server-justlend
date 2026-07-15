/**
 * JustLend V2 (Moolah) — Vault deposit / withdraw operations.
 * TRX vaults route through TrxProviderProxy; TRC20 vaults use the ERC4626 contract directly.
 */
import { getSigningClient } from "./wallet.js";
import { safeSend } from "./contracts.js";
import { approveWithReset } from "./allowance.js";
import { getMoolahAddresses, getMoolahVaultInfo } from "../chains.js";
import { TRC20_ABI, MOOLAH_VAULT_ABI, TRX_PROVIDER_ABI } from "../abis.js";
import { utils } from "./utils.js";
import { getMoolahVaultMaxWithdraw, getMoolahUserVaultShares } from "./moolah-query.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
// Conservative gas buffer: 20 TRX in sun
const GAS_BUFFER_SUN = 20_000_000n;

// ── Deposit ───────────────────────────────────────────────────────────────────

export async function moolahVaultDeposit(params: {
  vaultSymbol: string;
  amount: string;
  network?: string;
}): Promise<{ txID: string; vaultSymbol: string; amount: string; message: string }> {
  const { vaultSymbol, amount, network = "mainnet" } = params;
  const vault = getMoolahVaultInfo(vaultSymbol, network);
  const { trxProviderProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const amountRaw = utils.parseUnits(amount, vault.underlyingDecimals);
  const isTRX = vault.underlying === "";

  if (isTRX) {
    const balanceSun = BigInt(await tronWeb.trx.getBalance(walletAddress));
    const needed = amountRaw + GAS_BUFFER_SUN;
    if (balanceSun < needed) {
      throw new Error(
        `Insufficient TRX balance. Have ${utils.formatUnits(balanceSun, 6)} TRX, ` +
        `need ~${utils.formatUnits(needed, 6)} TRX (deposit + gas).`,
      );
    }
    const { txID } = await safeSend(
      {
        address: trxProviderProxy,
        abi: TRX_PROVIDER_ABI,
        functionName: "deposit",
        args: [vault.address, walletAddress],
        callValue: amountRaw.toString(),
      },
      network,
    );
    return { txID, vaultSymbol, amount, message: `Deposited ${amount} TRX into ${vaultSymbol} vault. TX: ${txID}` };
  }

  // TRC20 path
  const token = tronWeb.contract(TRC20_ABI, vault.underlying);
  const balance = BigInt(await token.methods.balanceOf(walletAddress).call());
  if (balance < amountRaw) {
    throw new Error(
      `Insufficient ${vault.underlyingSymbol} balance. ` +
      `Have ${utils.formatUnits(balance, vault.underlyingDecimals)}, need ${amount}.`,
    );
  }
  const allowance = BigInt(await token.methods.allowance(walletAddress, vault.address).call());
  if (allowance < amountRaw) {
    throw new Error(
      `Insufficient ${vault.underlyingSymbol} allowance for ${vaultSymbol} vault ` +
      `(current: ${utils.formatUnits(allowance, vault.underlyingDecimals)}). ` +
      `Call approve_moolah_vault first.`,
    );
  }
  const { txID } = await safeSend(
    {
      address: vault.address,
      abi: MOOLAH_VAULT_ABI,
      functionName: "deposit",
      args: [amountRaw.toString(), walletAddress],
    },
    network,
  );
  return { txID, vaultSymbol, amount, message: `Deposited ${amount} ${vault.underlyingSymbol} into ${vaultSymbol} vault. TX: ${txID}` };
}

// ── Withdraw (by underlying amount) ──────────────────────────────────────────

export async function moolahVaultWithdraw(params: {
  vaultSymbol: string;
  amount: string;   // "max" resolves to maxWithdraw
  network?: string;
}): Promise<{ txID: string; vaultSymbol: string; amount: string; message: string }> {
  const { vaultSymbol, network = "mainnet" } = params;
  const vault = getMoolahVaultInfo(vaultSymbol, network);
  const { trxProviderProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const isTRX = vault.underlying === "";

  let amount = params.amount;
  if (amount.toLowerCase() === "max") {
    const maxRaw = await getMoolahVaultMaxWithdraw(vault.address, walletAddress, network);
    if (maxRaw === 0n) throw new Error(`No ${vault.underlyingSymbol} available to withdraw from ${vaultSymbol} vault.`);
    amount = utils.formatUnits(maxRaw, vault.underlyingDecimals);
  }
  const amountRaw = utils.parseUnits(amount, vault.underlyingDecimals);

  if (isTRX) {
    const { txID } = await safeSend(
      {
        address: trxProviderProxy,
        abi: TRX_PROVIDER_ABI,
        functionName: "withdraw",
        args: [vault.address, amountRaw.toString(), walletAddress, walletAddress],
      },
      network,
    );
    return { txID, vaultSymbol, amount, message: `Withdrew ${amount} TRX from ${vaultSymbol} vault. TX: ${txID}` };
  }

  const { txID } = await safeSend(
    {
      address: vault.address,
      abi: MOOLAH_VAULT_ABI,
      functionName: "withdraw",
      args: [amountRaw.toString(), walletAddress, walletAddress],
    },
    network,
  );
  return { txID, vaultSymbol, amount, message: `Withdrew ${amount} ${vault.underlyingSymbol} from ${vaultSymbol} vault. TX: ${txID}` };
}

// ── Redeem (by shares) ────────────────────────────────────────────────────────

export async function moolahVaultRedeem(params: {
  vaultSymbol: string;
  shares: string;   // "max" resolves to full shares balance
  network?: string;
}): Promise<{ txID: string; vaultSymbol: string; shares: string; message: string }> {
  const { vaultSymbol, network = "mainnet" } = params;
  const vault = getMoolahVaultInfo(vaultSymbol, network);
  const { trxProviderProxy } = getMoolahAddresses(network);
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const isTRX = vault.underlying === "";

  let shares = params.shares;
  if (shares.toLowerCase() === "max") {
    const sharesRaw = await getMoolahUserVaultShares(vault.address, walletAddress, network);
    if (sharesRaw === 0n) throw new Error(`No shares held in ${vaultSymbol} vault.`);
    shares = utils.formatUnits(sharesRaw, vault.sharesDecimals);
  }
  const sharesRaw = utils.parseUnits(shares, vault.sharesDecimals);

  if (isTRX) {
    const { txID } = await safeSend(
      {
        address: trxProviderProxy,
        abi: TRX_PROVIDER_ABI,
        functionName: "redeem",
        args: [vault.address, sharesRaw.toString(), walletAddress, walletAddress],
      },
      network,
    );
    return { txID, vaultSymbol, shares, message: `Redeemed ${shares} shares from ${vaultSymbol} TRX vault. TX: ${txID}` };
  }

  const { txID } = await safeSend(
    {
      address: vault.address,
      abi: MOOLAH_VAULT_ABI,
      functionName: "redeem",
      args: [sharesRaw.toString(), walletAddress, walletAddress],
    },
    network,
  );
  return { txID, vaultSymbol, shares, message: `Redeemed ${shares} shares from ${vaultSymbol} vault. TX: ${txID}` };
}

// ── Approve TRC20 to vault ────────────────────────────────────────────────────

export async function approveMoolahVault(params: {
  vaultSymbol: string;
  amount?: string;
  network?: string;
}): Promise<{ txID: string; message: string; warning?: string }> {
  const { vaultSymbol, amount, network = "mainnet" } = params;
  const vault = getMoolahVaultInfo(vaultSymbol, network);
  if (!vault.underlying) {
    return { txID: "", message: `${vaultSymbol} vault uses native TRX — no token approval needed.` };
  }

  if (amount === undefined || amount === null || amount === "") {
    throw new Error(
      `approve_moolah_vault requires an explicit amount. Pass the exact value you intend to deposit ` +
      `(e.g. amount='100'), or pass amount='max' to grant unlimited allowance (NOT recommended — see warning).`,
    );
  }

  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const token = tronWeb.contract(TRC20_ABI, vault.underlying);

  const isMax = amount.toLowerCase() === "max";
  const approveRaw = isMax ? MAX_UINT256 : utils.parseUnits(amount, vault.underlyingDecimals).toString();

  const currentAllowance = BigInt(await token.methods.allowance(walletAddress, vault.address).call());
  // A revoke (amount='0') must not be swallowed by the sufficient-allowance skip.
  if (!isMax && BigInt(approveRaw) > 0n && currentAllowance >= BigInt(approveRaw)) {
    return { txID: "", message: `${vault.underlyingSymbol} already has sufficient allowance for ${vaultSymbol} vault.` };
  }

  const { txID, resetTxID } = await approveWithReset({
    tokenAddress: vault.underlying,
    spender: vault.address,
    approveRaw,
    currentAllowance,
    symbol: vault.underlyingSymbol,
    network,
  });
  const action = BigInt(approveRaw) === 0n
    ? `Revoked ${vault.underlyingSymbol} allowance for ${vaultSymbol} vault`
    : `Approved ${isMax ? "unlimited" : amount} ${vault.underlyingSymbol} for ${vaultSymbol} vault`;
  const result: { txID: string; message: string; warning?: string } = {
    txID,
    message: resetTxID
      ? `${action} (existing allowance reset to 0 first — reset TX: ${resetTxID}). TX: ${txID}`
      : `${action}. TX: ${txID}`,
  };
  if (isMax) {
    result.warning =
      `⚠️ UNLIMITED APPROVAL granted. The ${vaultSymbol} vault contract can now spend your entire ` +
      `${vault.underlyingSymbol} balance — present and future — without further confirmation. ` +
      `If you no longer need this, revoke with: approve_moolah_vault vaultSymbol='${vaultSymbol}' amount='0'.`;
  }
  return result;
}
