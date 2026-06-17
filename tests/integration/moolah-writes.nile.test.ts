/**
 * JustLend V2 (Moolah) end-to-end write-path probe on nile testnet.
 *
 * Skipped unless `TEST_MOOLAH_WRITE=1`. When enabled, runs through a realistic
 * deposit → withdraw → supply_collateral → borrow → repay → withdraw_collateral
 * sequence on nile using small amounts.
 *
 * Additional env vars consumed:
 *   - MOOLAH_NILE_MARKET_ID — bytes32 marketId to use for the market-side
 *     sub-tests. Morpho-style markets aren't enumerable on-chain; this must
 *     be supplied by the caller after checking what markets exist in the
 *     nile MoolahProxy.
 *   - MOOLAH_NILE_VAULT_SYMBOL — which registered vault to use ("TRX" or
 *     "USDT"). Default "TRX" since TRX is easiest to top up via the nile
 *     faucet. NOTE: both nile vault addresses in chains.ts are not yet
 *     deployed on-chain (verified 2026-04-17) — the test will probe and
 *     skip with a clear message if so.
 *
 * See forTest/docs/v1.1.0/nile-write-path-runbook.md for the full runbook:
 * wallet funding, USDT faucet, marketId discovery, and expected outputs.
 */
import { describe, it, expect } from "vitest";
import { getSigningClient } from "../../src/core/services/wallet.js";
import { setGlobalNetwork } from "../../src/core/services/global.js";
import { getMoolahAddresses, getMoolahVaultInfo } from "../../src/core/chains.js";

const ENABLED = process.env.TEST_MOOLAH_WRITE === "1";
const VAULT_SYMBOL = (process.env.MOOLAH_NILE_VAULT_SYMBOL ?? "TRX").toUpperCase();
const MARKET_ID = process.env.MOOLAH_NILE_MARKET_ID;
const NETWORK = "nile";

// Small amounts to keep faucet drain minimal
const VAULT_DEPOSIT_AMOUNT = "1";        // 1 TRX or 1 USDT
const VAULT_WITHDRAW_AMOUNT = "0.5";     // 0.5 TRX or 0.5 USDT
const COLLATERAL_AMOUNT = "1";
const BORROW_AMOUNT = "0.1";

async function bytecodeExists(network: string, address: string): Promise<boolean> {
  const tronWeb = await getSigningClient(network);
  try {
    const code = await (tronWeb.trx as any).getContract(address);
    return !!(code && code.bytecode && code.bytecode.length > 0);
  } catch {
    return false;
  }
}

const maybeDescribe = ENABLED ? describe : describe.skip;

maybeDescribe("Moolah V2 write-path on nile (end-to-end)", () => {
  setGlobalNetwork(NETWORK);

  it("precheck: moolahProxy and trxProviderProxy exist on nile", async () => {
    const { moolahProxy, trxProviderProxy, publicLiquidatorProxy } = getMoolahAddresses(NETWORK);
    for (const addr of [moolahProxy, trxProviderProxy, publicLiquidatorProxy]) {
      expect(await bytecodeExists(NETWORK, addr), `expected ${addr} to be deployed on nile`).toBe(true);
    }
  });

  describe("Vault path", () => {
    it("skips gracefully if the configured nile vault isn't deployed", async () => {
      const vault = getMoolahVaultInfo(VAULT_SYMBOL, NETWORK);
      const deployed = await bytecodeExists(NETWORK, vault.address);
      if (!deployed) {
        console.warn(
          `[moolah-writes.nile] Skipping vault tests — ${VAULT_SYMBOL} vault at ${vault.address} ` +
          `is not deployed on nile. This is expected as of the chains.ts note; see the runbook.`,
        );
        expect(deployed).toBe(false);
        return;
      }
      // If we get here, the vault deployed after the chains.ts note was written.
      // The actual write tests below will then be live.
      expect(deployed).toBe(true);
    });

    it.skipIf(!ENABLED)("approve → deposit → partial withdraw → max withdraw", async () => {
      const services = await import("../../src/core/services/index.js");
      const vault = getMoolahVaultInfo(VAULT_SYMBOL, NETWORK);
      const deployed = await bytecodeExists(NETWORK, vault.address);
      if (!deployed) return; // Already warned above

      // TRC20 path needs approval first
      if (vault.underlying) {
        const approveResult = await services.approveMoolahVault({
          vaultSymbol: VAULT_SYMBOL,
          amount: "max",
          network: NETWORK,
        });
        expect(approveResult.txID.length).toBeGreaterThan(0);
      }

      const deposit = await services.moolahVaultDeposit({
        vaultSymbol: VAULT_SYMBOL,
        amount: VAULT_DEPOSIT_AMOUNT,
        network: NETWORK,
      });
      expect(deposit.txID.length).toBeGreaterThan(0);

      const withdraw = await services.moolahVaultWithdraw({
        vaultSymbol: VAULT_SYMBOL,
        amount: VAULT_WITHDRAW_AMOUNT,
        network: NETWORK,
      });
      expect(withdraw.txID.length).toBeGreaterThan(0);

      const withdrawMax = await services.moolahVaultWithdraw({
        vaultSymbol: VAULT_SYMBOL,
        amount: "max",
        network: NETWORK,
      });
      expect(withdrawMax.txID.length).toBeGreaterThan(0);
    }, 120_000);
  });

  describe("Market path", () => {
    it("requires MOOLAH_NILE_MARKET_ID to run write tests", () => {
      if (!MARKET_ID) {
        console.warn(
          "[moolah-writes.nile] Skipping market write tests — MOOLAH_NILE_MARKET_ID not set. " +
          "See the runbook for how to discover a valid nile marketId.",
        );
      }
      expect(true).toBe(true);
    });

    it.skipIf(!ENABLED || !MARKET_ID)(
      "supply_collateral → borrow → max repay → withdraw_collateral max",
      async () => {
        const services = await import("../../src/core/services/index.js");

        const supply = await services.moolahSupplyCollateral({
          marketId: MARKET_ID!,
          amount: COLLATERAL_AMOUNT,
          network: NETWORK,
        });
        expect(supply.txID.length).toBeGreaterThan(0);

        const borrow = await services.moolahBorrow({
          marketId: MARKET_ID!,
          amount: BORROW_AMOUNT,
          network: NETWORK,
        });
        expect(borrow.txID.length).toBeGreaterThan(0);

        const repay = await services.moolahRepay({
          marketId: MARKET_ID!,
          amount: "max",
          network: NETWORK,
        });
        expect(repay.txID.length).toBeGreaterThan(0);

        const withdrawCollateral = await services.moolahWithdrawCollateral({
          marketId: MARKET_ID!,
          amount: "max",
          network: NETWORK,
        });
        expect(withdrawCollateral.txID.length).toBeGreaterThan(0);
      },
      180_000,
    );
  });
});
