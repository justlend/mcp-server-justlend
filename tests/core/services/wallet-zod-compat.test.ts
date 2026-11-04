import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoInitWallet, getAgentWallet, importWallet } from "../../../src/core/services/wallet.js";

let directory: string | undefined;
afterEach(() => {
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("installed agent-wallet compatibility with patched Zod", () => {
  it("creates, imports and decrypts the imported wallet in a separate process", async () => {
    directory = mkdtempSync(join(tmpdir(), "mcp-zod-wallet-"));
    vi.stubEnv("AGENT_WALLET_DIR", directory);
    vi.stubEnv("AGENT_WALLET_PASSWORD", "test-only-zod-compatibility-password");
    const created = await autoInitWallet();
    expect(created.created).toBe(true);
    // Synthetic fixture, never funded, signed with, or sent to a network.
    const imported = await importWallet("11".repeat(32), "zod-compat");
    expect(imported.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(imported.address).not.toBe(created.address);
    expect(await (await getAgentWallet()).getAddress()).toBe(imported.address);
    const script = `
      import { getAgentWallet } from './src/core/services/wallet.ts';
      import { setActiveWalletId } from './src/core/services/global.ts';
      setActiveWalletId('zod-compat');
      console.log(JSON.stringify({ address: await (await getAgentWallet()).getAddress() }));
    `;
    const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env }, encoding: "utf8", timeout: 15_000,
    });
    expect(JSON.parse(output).address).toBe(imported.address);
    expect(existsSync(join(directory, "runtime_secrets.json"))).toBe(false);
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, AGENT_WALLET_PASSWORD: "wrong-test-password" },
      encoding: "utf8", timeout: 15_000, stdio: "pipe",
    })).toThrow();
  }, 30_000);
});
