import { describe, expect, it } from "vitest";
import { registerJustLendPrompts } from "../../src/core/prompts.js";

describe("V2 prompt risk contract", () => {
  const handlers = new Map<string, (args: Record<string, string>) => any>();
  registerJustLendPrompts({
    registerPrompt(name: string, _config: unknown, handler: any) { handlers.set(name, handler); },
  } as any);
  const render = (name: string) => handlers.get(name)!({}).messages.map((m: any) => m.content.text).join("\n");

  it.each(["moolah_borrow", "moolah_liquidate", "moolah_portfolio"])("%s does not turn risk snapshots into execution guarantees", (name) => {
    const text = render(name);
    expect(text).not.toMatch(/ratio \(0-1|liquidated right now|Position will be liquidated/);
    expect(text).toContain("current on-chain health");
    expect(text).toContain("not proof of liquidation eligibility");
  });

  it("separates borrower checks from quotes and requires confirmation and reconciliation", () => {
    const text = render("moolah_liquidate");
    expect(text).toContain("If healthy, unknown, or unavailable, stop");
    expect(text).toContain("does not check borrower health");
    expect(text).toContain("changed parameters require renewed confirmation");
    expect(text).toContain("a hash alone is not success");
    expect(text).toContain("do not blindly retry");
  });
});
