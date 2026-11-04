import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { sideEffect } from "../../scripts/lib/tool-side-effects.js";
import { classifyError } from "../../src/core/tools/shared.js";

describe("offline tool catalog execution effects", () => {
  it.each(["transfer_trx", "transfer_trc20", "enter_market", "approve_underlying", "claim_rewards",
    "approve_jst_for_voting", "approve_moolah_vault", "approve_moolah_proxy", "approve_liquidator_token"])(
    "%s is a transaction even without a destructive annotation", (tool) => {
      expect(sideEffect(tool, { readOnlyHint: false })).toMatch(/🔴 On-chain transaction/);
    },
  );
  it("distinguishes local configuration, disabled interactions, and backend broadcasting", () => {
    expect(sideEffect("set_network", { readOnlyHint: false })).toContain("Local configuration");
    expect(sideEffect("connect_browser_wallet", { readOnlyHint: false })).toContain("Disabled interaction");
    expect(sideEffect("buy_energy_direct", { readOnlyHint: false })).toContain("backend");
  });
  it("requires an explicit decision for new writes and contradictory read annotations", () => {
    expect(() => sideEffect("future_write", { readOnlyHint: false })).toThrow("Unclassified write");
    expect(() => sideEffect("transfer_trx", { readOnlyHint: true })).toThrow("conflicts");
  });
  it("registers the full catalog offline and distinguishes nullable from optional output fields", () => {
    const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/gen-mcp-api-list.ts"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8", timeout: 30_000,
    });
    expect(output).toContain("### `claim_v1_mining_period`");
    expect(output).toContain("| `claimableRewards` | <code>number (min 0) &#124; null</code> | ✅ |");
    expect(output).toContain("| `note` | <code>string</code> | — |");
    expect(output).not.toContain("🟡 State-changing (Write)");
    expect([...output.matchAll(/^### `/gm)]).toHaveLength(107);
    expect([...output.matchAll(/^- \*\*Side effect\*\*: 🟢/gm)]).toHaveLength(66);
    expect([...output.matchAll(/^- \*\*Side effect\*\*: 🔴/gm)]).toHaveLength(37);
    expect([...output.matchAll(/^- \*\*Side effect\*\*: 🟡/gm)]).toHaveLength(4);
    expect(output.trim()).toBe(readFileSync(new URL("../../mcp-api-list.md", import.meta.url), "utf8").trim());
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const names = new Set([...output.matchAll(/^### `([^`]+)`/gm)].map(match => match[1]));
    // Check actual recovery hints against the full registry, not a hand-maintained
    // allowlist that could silently preserve a removed or invented tool name.
    for (const [message, code] of [
      ["sTRX claim availability is unknown", "data_unavailable"],
      ["Insufficient allowance. Please approve first.", "insufficient_allowance"],
      ["Insufficient balance", "insufficient_balance"],
      ["No wallet configured", "wallet_not_configured"],
      ["execution reverted", "execution_reverted"],
      ["unknown market", "market_not_found"],
      ["Invalid TRON address", "invalid_address"],
      ["Request timed out", "transient"],
    ]) {
      const result = classifyError(message);
      expect(result.errorCode).toBe(code);
      for (const name of result.hint?.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []) {
        expect(names.has(name), `${code} references unregistered tool ${name}`).toBe(true);
      }
    }
    const claimExample = readme.split('**"Do I have any sTRX rewards to claim?"**')[1].split('**"Can I withdraw')[0];
    expect(claimExample).toContain("reports the result only");
    expect(claimExample).toContain("A query alone never authorizes a transaction");
    expect(claimExample).toContain("obtain separate explicit confirmation, then call `claim_strx_rewards`");
    expect(claimExample).toContain("Unknown/null data is not zero");
    for (const surface of [output, readme]) {
      expect(surface).not.toMatch(/0–1 where 1\.0 = liquidatable|1\.0 for liquidatable now|liquidatable right now/);
      expect(surface).toContain("current on-chain health");
    }
    const candidates = output.split("### `get_moolah_pending_liquidations`")[1].split("### ")[0];
    expect(candidates).toContain("this filter does not establish liquidation eligibility");
    const quote = output.split("### `get_moolah_liquidation_quote`")[1].split("### ")[0];
    expect(quote).toContain("does not check borrower health");
    expect(quote).toContain("does not check liquidation permissions");
    const liquidate = output.split("### `moolah_liquidate`")[1].split("### ")[0];
    expect(liquidate).toContain("core caller and public-liquidator market/borrower permissions");
    expect(liquidate).toContain("If health or permissions are unknown, stop");
  }, 35_000);
});
