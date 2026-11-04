import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const setup = readFileSync(new URL("../../scripts/setup-mcp-test.sh", import.meta.url), "utf8");

describe("quick setup wallet guidance", () => {
  it("does not recommend the disabled browser bridge", () => {
    expect(setup).toContain("browser mode: Disabled");
    expect(setup).not.toContain("Connect my TronLink wallet");
    expect(setup).not.toContain("TronLink extension (recommended)");
  });

  it("keeps wallet import local and calls out the password requirement", () => {
    expect(setup).toContain("AGENT_WALLET_PASSWORD");
    expect(setup).toContain("in your own terminal with: npx agent-wallet import");
    expect(setup).toContain("Never paste a private key into chat or MCP tool arguments");
  });
});
