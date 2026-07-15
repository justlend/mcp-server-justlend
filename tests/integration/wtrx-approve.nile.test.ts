/**
 * v1.1.2 write-path probe on nile testnet — WTRX wrap/unwrap + USDT approve
 * reset-to-0 + revoke. This is the repeatable form of the manual Tier-B smoke.
 *
 * Skipped unless `TEST_WTRX_WRITE=1`. When enabled, runs against a funded nile
 * wallet (agent-wallet) and exercises the three headline v1.1.2 changes:
 *
 *   1. wrap_trx  → WTRX balance goes up 1:1
 *      unwrap_trx → WTRX balance goes back down 1:1
 *   2. approve_underlying on jUSDT: a re-approve over a non-zero allowance emits
 *      a "reset TX" (the USDT/USDC/USDJ approve(0)-then-approve reset path)
 *   3. approve_underlying amount='0' actually revokes (message "Revoked …" + a
 *      real txID) — no longer swallowed by the sufficient-allowance short-circuit
 *
 * Prereqs (see forTest/docs/v1.1.0/nile-write-path-runbook.md for wallet funding):
 *   - agent-wallet configured + activated with a nile-funded key
 *   - AGENT_WALLET_PASSWORD exported
 *   - a few nile TRX for the wrap amount + gas (approvals only need gas)
 *
 * Run:
 *   npm run build
 *   TEST_WTRX_WRITE=1 npx vitest run tests/integration/wtrx-approve.nile.test.ts
 */
import { describe, it, expect } from "vitest";
import { getSigningClient } from "../../src/core/services/wallet.js";
import { setGlobalNetwork } from "../../src/core/services/global.js";
import { getMoolahAddresses, getJTokenInfo } from "../../src/core/chains.js";

const ENABLED = process.env.TEST_WTRX_WRITE === "1";
const NETWORK = "nile";

// Small amounts to keep faucet drain minimal.
const WRAP_AMOUNT = "2"; // 2 TRX -> 2 WTRX -> back
const WRAP_RAW = 2_000_000n; // 2 WTRX in SUN (6 dp)

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

maybeDescribe("v1.1.2 write-path on nile (WTRX + approve reset/revoke)", () => {
  setGlobalNetwork(NETWORK);

  const { wtrxProxy } = getMoolahAddresses(NETWORK);
  const jUSDT = getJTokenInfo("jUSDT", NETWORK);

  it("precheck: WTRX contract is deployed on nile", async () => {
    expect(await bytecodeExists(NETWORK, wtrxProxy), `expected WTRX ${wtrxProxy} deployed on nile`).toBe(true);
  });

  it.skipIf(!ENABLED)("wrap_trx then unwrap_trx moves WTRX balance 1:1", async () => {
    if (!(await bytecodeExists(NETWORK, wtrxProxy))) {
      console.warn(`[wtrx.nile] Skipping — WTRX ${wtrxProxy} not deployed on nile.`);
      return;
    }
    const services = await import("../../src/core/services/index.js");
    const tronWeb = await getSigningClient(NETWORK);
    const wallet = tronWeb.defaultAddress.base58 as string;

    const before = (await services.getTRC20Balance(wtrxProxy, wallet, NETWORK)).raw;

    const wrap = await services.wrapTrx(WRAP_AMOUNT, NETWORK);
    expect(wrap.txID.length).toBeGreaterThan(0);
    await services.waitForTransaction(wrap.txID, NETWORK);
    const afterWrap = (await services.getTRC20Balance(wtrxProxy, wallet, NETWORK)).raw;
    expect(afterWrap - before).toBe(WRAP_RAW); // +2 WTRX

    const unwrap = await services.unwrapTrx(WRAP_AMOUNT, NETWORK);
    expect(unwrap.txID.length).toBeGreaterThan(0);
    await services.waitForTransaction(unwrap.txID, NETWORK);
    const afterUnwrap = (await services.getTRC20Balance(wtrxProxy, wallet, NETWORK)).raw;
    expect(afterUnwrap).toBe(before); // back to start
  }, 240_000);

  it.skipIf(!ENABLED)("approve_underlying resets a non-zero USDT allowance and honors amount='0' revoke", async () => {
    if (!jUSDT?.underlying || !(await bytecodeExists(NETWORK, jUSDT.underlying))) {
      console.warn(`[wtrx.nile] Skipping approve tests — nile jUSDT underlying not deployed.`);
      return;
    }
    const services = await import("../../src/core/services/index.js");

    // 0) Known state: revoke to 0 (always sends approve(0), never swallowed).
    const r0 = await services.approveUnderlying("jUSDT", "0", NETWORK);
    expect(r0.txID.length).toBeGreaterThan(0);
    expect(r0.message).toMatch(/Revoked/i);
    await services.waitForTransaction(r0.txID, NETWORK);

    // 1) Fresh approve over a zero allowance → no reset needed.
    const r1 = await services.approveUnderlying("jUSDT", "1", NETWORK);
    expect(r1.txID.length).toBeGreaterThan(0);
    expect(r1.message).not.toMatch(/reset TX/i);
    await services.waitForTransaction(r1.txID, NETWORK);

    // 2) Re-approve a higher amount over a non-zero allowance → reset(0) fires.
    const r2 = await services.approveUnderlying("jUSDT", "2", NETWORK);
    expect(r2.txID.length).toBeGreaterThan(0);
    expect(r2.message).toMatch(/reset TX/i); // approve(0) then approve(2)
    await services.waitForTransaction(r2.txID, NETWORK);

    // 3) Revoke again → the documented amount='0' path really sends approve(0).
    const r3 = await services.approveUnderlying("jUSDT", "0", NETWORK);
    expect(r3.txID.length).toBeGreaterThan(0);
    expect(r3.message).toMatch(/Revoked/i);
  }, 300_000);
});
