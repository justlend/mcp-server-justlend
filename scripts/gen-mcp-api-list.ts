/**
 * Generate `mcp-api-list.md` — a machine-readable, offline catalog of every MCP
 * tool exposed by this server (name, side-effect class, description, input schema).
 *
 * This is the SSOT-from-code generator required by the AI-Agent doc standard
 * ("key data generated programmatically"): it stubs an McpServer, lets each register*Tools()
 * function register against the stub, then introspects the captured Zod input
 * schemas + MCP annotations into Markdown. Re-run after changing any tool:
 *
 *   npx tsx scripts/gen-mcp-api-list.ts
 *
 * Output is deterministic (tools listed in registration order, grouped by
 * category) so the committed file only changes when the tool surface changes.
 */
import { z } from "zod";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { registerWalletTools } from "../src/core/tools/wallet-tools.js";
import { registerMarketTools } from "../src/core/tools/market-tools.js";
import { registerLendingTools } from "../src/core/tools/lending-tools.js";
import { registerVotingTools } from "../src/core/tools/voting-tools.js";
import { registerEnergyTools } from "../src/core/tools/energy-tools.js";
import { registerStakingTools } from "../src/core/tools/staking-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

interface CapturedTool {
  category: string;
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

const tools: CapturedTool[] = [];
let currentCategory = "";

// Minimal stub that satisfies the shape register*Tools() actually call.
const stubServer = {
  registerTool(name: string, config: any, _handler: unknown) {
    tools.push({
      category: currentCategory,
      name,
      description: config?.description ?? "",
      inputSchema: config?.inputSchema ?? {},
      annotations: config?.annotations,
    });
  },
  // Some servers also register prompts/resources; capture-and-ignore so import
  // never throws if a register fn touches them.
  registerPrompt() {},
  registerResource() {},
  prompt() {},
  resource() {},
  tool() {},
} as any;

const categories: Array<[string, (s: any) => void]> = [
  ["Wallet & Network", registerWalletTools],
  ["Market Data", registerMarketTools],
  ["Lending Operations", registerLendingTools],
  ["JST Voting / Governance", registerVotingTools],
  ["Energy Rental", registerEnergyTools],
  ["sTRX Staking", registerStakingTools],
];

for (const [label, register] of categories) {
  currentCategory = label;
  register(stubServer);
}

/** Unwrap Zod optional/default/nullable to the inner type, tracking metadata. */
function describeField(zt: z.ZodTypeAny): {
  type: string;
  required: boolean;
  def?: string;
  description: string;
} {
  let required = true;
  let def: string | undefined;
  let description = (zt as any)?._def?.description ?? "";
  let t: any = zt;

  while (t?._def) {
    const tn = t._def.typeName;
    if (tn === "ZodOptional") {
      required = false;
      t = t._def.innerType;
    } else if (tn === "ZodNullable") {
      required = false;
      t = t._def.innerType;
    } else if (tn === "ZodDefault") {
      required = false;
      try {
        def = JSON.stringify(t._def.defaultValue());
      } catch {
        /* ignore */
      }
      t = t._def.innerType;
    } else {
      break;
    }
    if (!description && t?._def?.description) description = t._def.description;
  }

  const tn: string = t?._def?.typeName ?? "ZodUnknown";
  let type = tn.replace(/^Zod/, "").toLowerCase();
  if (tn === "ZodEnum") type = `enum(${t._def.values.join(" | ")})`;
  if (tn === "ZodNativeEnum") type = "enum";
  if (tn === "ZodArray") {
    const inner = t._def.type?._def?.typeName?.replace(/^Zod/, "").toLowerCase() ?? "any";
    type = `${inner}[]`;
  }
  if (tn === "ZodNumber") {
    const checks = t._def.checks ?? [];
    const bounds = checks
      .filter((c: any) => c.kind === "min" || c.kind === "max")
      .map((c: any) => `${c.kind} ${c.value}`)
      .join(", ");
    if (bounds) type = `number (${bounds})`;
  }
  return { type, required, def, description: (description || "").replace(/\s*\n\s*/g, " ").trim() };
}

/** Map MCP annotations to a human/agent-readable side-effect class. */
function sideEffect(a?: CapturedTool["annotations"]): string {
  if (!a) return "unannotated";
  if (a.readOnlyHint === true) return "🟢 Read-only (Safe / Network Read)";
  if (a.destructiveHint === true)
    return "🔴 On-chain write · high-risk (Remote Write / Destructive) — signs and broadcasts a TRON transaction moving real assets; the client MUST require human confirmation (HITL) before executing";
  return "🟡 State-changing (Write) — changes local wallet/network config or starts an interaction; client should confirm";
}

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

const lines: string[] = [];
lines.push(`# MCP API List — \`${pkg.name}\` v${pkg.version}`);
lines.push("");
lines.push(
  "> **Machine-readable tool catalog (for offline routing).** Auto-generated by " +
    "`scripts/gen-mcp-api-list.ts` from the `registerTool` definitions + Zod inputSchema + MCP " +
    "annotations in the source — do not edit by hand; after changing any tool run " +
    "`npx tsx scripts/gen-mcp-api-list.ts` to regenerate.",
);
lines.push(">");
lines.push(
  "> Lets an AI agent plan tool routing offline without connecting to the server. Side-effect " +
    "classes align with the AI-Agent documentation standard baseline (Safe / Network Read / " +
    "Remote Write / Destructive).",
);
lines.push("");
lines.push(`**Total tools**: ${tools.length}  |  **Protocol**: MCP  |  **Transport**: stdio / HTTP(SSE)`);
lines.push("");

// Side-effect summary
const writeTools = tools.filter((t) => t.annotations?.readOnlyHint === false);
const readTools = tools.filter((t) => t.annotations?.readOnlyHint === true);
lines.push(
  `**Read-only tools**: ${readTools.length}  |  **Write tools**: ${writeTools.length} (of which marked destructive: ` +
    `${writeTools.filter((t) => t.annotations?.destructiveHint).length})`,
);
lines.push("");
lines.push(
  "> ⚠️ Tools marked 🔴 **sign and broadcast TRON transactions that move real assets** — the client " +
    "MUST require human confirmation (HITL) before executing. 🟡 tools only change local wallet/network " +
    "config or start an interaction. Private keys are managed encrypted by `@bankofai/agent-wallet` or " +
    "signed via the TronLink browser wallet, and are **never passed as tool arguments**.",
);
lines.push("");
lines.push("---");
lines.push("");

for (const [label] of categories) {
  const group = tools.filter((t) => t.category === label);
  if (!group.length) continue;
  lines.push(`## ${label} (${group.length})`);
  lines.push("");
  for (const tool of group) {
    lines.push(`### \`${tool.name}\``);
    lines.push("");
    if (tool.annotations?.title) lines.push(`**${tool.annotations.title}**  `);
    lines.push(`- **Side effect**: ${sideEffect(tool.annotations)}`);
    if (tool.annotations) {
      const flags = [
        tool.annotations.idempotentHint != null ? `idempotent: ${tool.annotations.idempotentHint}` : null,
        tool.annotations.openWorldHint != null ? `openWorld: ${tool.annotations.openWorldHint}` : null,
      ].filter(Boolean);
      if (flags.length) lines.push(`- **annotations**: ${flags.join(" · ")}`);
    }
    lines.push(`- **Description**: ${tool.description.replace(/\s*\n\s*/g, " ").trim()}`);
    const fields = Object.entries(tool.inputSchema);
    if (fields.length) {
      lines.push("");
      lines.push("| Param | Type | Required | Default | Description |");
      lines.push("|-------|------|:--------:|---------|-------------|");
      for (const [fname, zt] of fields) {
        const d = describeField(zt as z.ZodTypeAny);
        lines.push(
          `| \`${fname}\` | ${d.type} | ${d.required ? "✅" : "—"} | ${d.def ?? ""} | ${d.description} |`,
        );
      }
    } else {
      lines.push("- **Params**: none");
    }
    lines.push("");
  }
}

lines.push("---");
lines.push("");
lines.push(
  `_Auto-generated — do not edit by hand. Generator: \`scripts/gen-mcp-api-list.ts\`. Regenerate: \`npx tsx scripts/gen-mcp-api-list.ts\`._`,
);
lines.push("");

const out = lines.join("\n");
process.stdout.write(out);
