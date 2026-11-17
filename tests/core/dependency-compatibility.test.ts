import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigWalletProvider, loadConfig } from "@bankofai/agent-wallet";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeField } from "../../scripts/lib/describe-schema.js";

describe("Zod dependency compatibility", () => {
  it("preserves tool catalog types, constraints, descriptions and defaults", () => {
    expect(describeField(z.string().regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/).describe("TRON address").optional()))
      .toEqual({ type: "string (pattern /^T[1-9A-HJ-NP-Za-km-z]{33}$/)", required: false, def: undefined, description: "TRON address" });
    expect(describeField(z.number().min(1).max(100).default(20).describe("Page size")))
      .toEqual({ type: "number (min 1, max 100)", required: false, def: "20", description: "Page size" });
    expect(describeField(z.enum(["agent", "browser"])).type).toBe("enum(agent | browser)");
    expect(describeField(z.array(z.string())).type).toBe("string[]");
    expect(describeField(z.union([z.string(), z.array(z.string())])).type).toBe("union");
    expect(describeField(z.string().length(32)).type).toBe("string (len 32)");
    expect(describeField(z.literal(true)).type).toBe("literal");
    expect(describeField(z.number().int().positive()).type).toContain("> 0");
    expect(describeField(z.string()).required).toBe(true);
  });

  it("loads persisted wallet records and rejects mismatched wallet parameters", () => {
    const dir = mkdtempSync(join(tmpdir(), "justlend-wallet-schema-"));
    try {
      const provider = new ConfigWalletProvider(dir);
      provider.ensureStorage();
      provider.addWallet("fixture", { type: "local_secure", params: { secret_ref: "fixture" } });
      provider.setActive("fixture");
      const restored = new ConfigWalletProvider(dir);
      expect(restored.getActiveId()).toBe("fixture");
      expect(restored.getWalletConfig("fixture")).toEqual({ type: "local_secure", params: { secret_ref: "fixture" } });

      writeFileSync(join(dir, "wallets_config.json"), JSON.stringify({
        wallets: { invalid: { type: "local_secure", params: { source: "private_key", private_key: "test-only" } } },
      }));
      expect(() => loadConfig(dir)).toThrow(/params must match wallet type/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
