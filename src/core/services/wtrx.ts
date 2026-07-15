import { getSigningClient } from "./wallet.js";
import { utils } from "./utils.js";
import { safeSend } from "./contracts.js";
import { checkResourceSufficiency } from "./lending.js";
import { getMoolahAddresses } from "../chains.js";
import { WTRX_ABI } from "../abis.js";

// WTRX mirrors native TRX 1:1 at 6 decimals (like WETH for ETH).
const WTRX_DECIMALS = 6;
// Conservative resource estimates for the pre-flight balance check only; safeSend
// runs the real energy/bandwidth simulation and fail-closes on an actual shortfall.
const WTRX_ENERGY_ESTIMATE = 15_000;
const WTRX_BANDWIDTH_ESTIMATE = 350;

function getWtrxAddress(network: string): string {
  const { wtrxProxy } = getMoolahAddresses(network);
  if (!wtrxProxy || !utils.isAddress(wtrxProxy)) {
    throw new Error(`WTRX contract address is not configured for network "${network}".`);
  }
  return wtrxProxy;
}

/**
 * Wrap native TRX into WTRX (1:1). Sends `amount` TRX as callValue to the WTRX
 * contract's payable `deposit()`; you receive an equal amount of WTRX.
 *
 * Mirrors app-justlend `system.jsx wtrxDeposit` (funcSelector `deposit()`,
 * callValue = amount) on the hardened `safeSend` path (pre-flight simulation +
 * mainnet fail-closed on REVERT + non-negative/precision-guarded amount).
 *
 * @param amount Human-readable TRX amount (e.g. "10.5").
 */
export async function wrapTrx(
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; amount: string; wtrx: string; message: string }> {
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const wtrxAddress = getWtrxAddress(network);

  // parseUnits rejects a leading '-' and silent over-precision truncation.
  const amountRaw = utils.parseUnits(amount, WTRX_DECIMALS);
  if (amountRaw <= 0n) throw new Error("Wrap amount must be greater than 0.");

  // Pre-check: need the wrap amount + estimated gas in native TRX.
  const balanceSun = await tronWeb.trx.getBalance(walletAddress);
  const resourceCheck = await checkResourceSufficiency(
    walletAddress,
    WTRX_ENERGY_ESTIMATE,
    WTRX_BANDWIDTH_ESTIMATE,
    network,
  );
  const gasSun = BigInt(
    Math.ceil((parseFloat(resourceCheck.energyBurnTRX) + parseFloat(resourceCheck.bandwidthBurnTRX)) * 1e6),
  );
  const needed = amountRaw + gasSun;
  if (BigInt(balanceSun) < needed) {
    throw new Error(
      `Insufficient TRX balance. Have ${utils.formatUnits(BigInt(balanceSun).toString(), WTRX_DECIMALS)} TRX, ` +
      `need ~${utils.formatUnits(needed.toString(), WTRX_DECIMALS)} TRX (wrap + estimated gas).`,
    );
  }

  const { txID } = await safeSend(
    {
      address: wtrxAddress,
      abi: WTRX_ABI,
      functionName: "deposit",
      callValue: amountRaw.toString(),
    },
    network,
  );

  return {
    txID,
    amount,
    wtrx: amount,
    message: `Wrapped ${amount} TRX into ${amount} WTRX (1:1). WTRX contract: ${wtrxAddress}.`,
  };
}

/**
 * Unwrap WTRX back into native TRX (1:1) via the WTRX contract's
 * `withdraw(uint256)`. No approval is needed — you burn your own WTRX.
 *
 * Mirrors app-justlend `system.jsx wtrxWithdraw` (funcSelector `withdraw(uint256)`,
 * parameters `[amount]`) on the hardened `safeSend` path.
 *
 * @param amount Human-readable WTRX amount (e.g. "10.5").
 */
export async function unwrapTrx(
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; amount: string; trx: string; message: string }> {
  const tronWeb = await getSigningClient(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const wtrxAddress = getWtrxAddress(network);

  const amountRaw = utils.parseUnits(amount, WTRX_DECIMALS);
  if (amountRaw <= 0n) throw new Error("Unwrap amount must be greater than 0.");

  // Pre-check: need WTRX balance >= unwrap amount.
  const wtrx = tronWeb.contract(WTRX_ABI, wtrxAddress);
  const wtrxBalance = BigInt(await wtrx.methods.balanceOf(walletAddress).call());
  if (wtrxBalance < amountRaw) {
    throw new Error(
      `Insufficient WTRX balance. Have ${utils.formatUnits(wtrxBalance.toString(), WTRX_DECIMALS)} WTRX, need ${amount}.`,
    );
  }

  const { txID } = await safeSend(
    {
      address: wtrxAddress,
      abi: WTRX_ABI,
      functionName: "withdraw",
      args: [amountRaw.toString()],
    },
    network,
  );

  return {
    txID,
    amount,
    trx: amount,
    message: `Unwrapped ${amount} WTRX into ${amount} TRX (1:1). WTRX contract: ${wtrxAddress}.`,
  };
}
