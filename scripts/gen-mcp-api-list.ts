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
import { registerWtrxTools } from "../src/core/tools/wtrx-tools.js";
import { registerMoolahVaultTools } from "../src/core/tools/moolah-vault-tools.js";
import { registerMoolahMarketTools } from "../src/core/tools/moolah-market-tools.js";
import { registerMoolahLiquidationTools } from "../src/core/tools/moolah-liquidation-tools.js";
import { registerMoolahDashboardTools } from "../src/core/tools/moolah-dashboard-tools.js";
import { registerMoolahMiningTools } from "../src/core/tools/moolah-mining-tools.js";
import { registerRecordsTools } from "../src/core/tools/records-tools.js";
import { TOOL_OUTPUT_SCHEMA_VERSION, withStructuredToolOutputs } from "../src/core/tools/structured-output.js";
import { sideEffect } from "./lib/tool-side-effects.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

interface CapturedTool {
  category: string;
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  outputSchema?: Record<string, z.ZodTypeAny>;
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
      outputSchema: config?.outputSchema,
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
  ["WTRX Wrap / Unwrap", registerWtrxTools],
  // JustLend V2 (Moolah)
  ["JustLend V2 (Moolah) — Vaults", registerMoolahVaultTools],
  ["JustLend V2 (Moolah) — Markets", registerMoolahMarketTools],
  ["JustLend V2 (Moolah) — Liquidation", registerMoolahLiquidationTools],
  ["JustLend V2 (Moolah) — Dashboard & History", registerMoolahDashboardTools],
  ["JustLend V2 (Moolah) — Mining, Rewards & Estimator", registerMoolahMiningTools],
  // Historical records (V1 + cross-cutting)
  ["Historical Records", registerRecordsTools],
];

for (const [label, register] of categories) {
  currentCategory = label;
  register(withStructuredToolOutputs(stubServer));
}

const missingOutputSchema = tools.filter((tool) => !tool.outputSchema);
if (missingOutputSchema.length > 0) {
  throw new Error(`Tools missing outputSchema: ${missingOutputSchema.map((tool) => tool.name).join(", ")}`);
}

/** Unwrap Zod optional/default/nullable to the inner type, tracking metadata. */
function describeField(zt: z.ZodTypeAny): {
  type: string;
  required: boolean;
  def?: string;
  description: string;
} {
  let required = true;
  let nullable = false;
  let def: string | undefined;
  let description = (zt as any)?._def?.description ?? "";
  let t: any = zt;

  while (t?._def) {
    const tn = t._def.typeName;
    if (tn === "ZodOptional") {
      required = false;
      t = t._def.innerType;
    } else if (tn === "ZodNullable") {
      nullable = true;
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
  if (tn === "ZodString") {
    const checks = t._def.checks ?? [];
    const parts = checks
      .map((c: any) => {
        if (c.kind === "regex") return `pattern ${String(c.regex)}`;
        if (c.kind === "min") return `min len ${c.value}`;
        if (c.kind === "max") return `max len ${c.value}`;
        if (c.kind === "length") return `len ${c.value}`;
        return null;
      })
      .filter(Boolean);
    if (parts.length) type = `string (${parts.join(", ")})`;
  }
  if (nullable) type += " | null";
  return { type, required, def, description: (description || "").replace(/\s*\n\s*/g, " ").trim() };
}

// HTML code keeps regex backslashes and union pipes intact in Markdown tables.
const typeCell = (value: string) => `<code>${value.replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\\/g, "&#92;").replace(/\|/g, "&#124;")}</code>`;
const textCell = (value: string) => value.replace(/\|/g, "&#124;");

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
lines.push(`## Common structured output contract (v${TOOL_OUTPUT_SCHEMA_VERSION})`);
lines.push("");
lines.push("Every tool declares an MCP `outputSchema`. Successful calls preserve the legacy text `content` and also return:");
lines.push("");
lines.push("```json");
lines.push(JSON.stringify({ schemaVersion: TOOL_OUTPUT_SCHEMA_VERSION, tool: "get_supported_markets", result: {} }, null, 2));
lines.push("```");
lines.push("");
lines.push("Consume `structuredContent` when available; older clients may continue parsing the first text content item. Error results keep `isError: true` and the existing structured JSON error body.");
lines.push("The envelope version covers `schemaVersion`, `tool`, and `result`, not every nested business field. The sTRX eligibility tool additionally declares a field-level result schema below. Unknown error codes or missing retryability never authorize replaying a write.");
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
  "> ⚠️ 🔴 identifies on-chain transactions, including transfers, approvals, collateral membership, and claims, whether or not the MCP annotation marks them destructive. " +
    "They require explicit human confirmation **before** building a signing/broadcast workflow. 🟡 identifies local configuration or the disabled browser interaction, not an on-chain write. " +
    "`destructiveHint: false` does not mean read-only. Direct energy payments are signed locally but may be broadcast by the backend. " +
    "Private keys remain encrypted in `@bankofai/agent-wallet` and are never tool arguments. The browser-wallet bridge remains disabled.",
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
    if (tool.annotations?.title) lines.push(`**${tool.annotations.title}**`);
    lines.push(`- **Side effect**: ${sideEffect(tool.name, tool.annotations)}`);
    if (tool.annotations) {
      const flags = [
        tool.annotations.idempotentHint != null ? `idempotent: ${tool.annotations.idempotentHint}` : null,
        tool.annotations.openWorldHint != null ? `openWorld: ${tool.annotations.openWorldHint}` : null,
      ].filter(Boolean);
      if (flags.length) lines.push(`- **annotations**: ${flags.join(" · ")}`);
    }
    lines.push(`- **Description**: ${tool.description.replace(/\s*\n\s*/g, " ").trim()}`);
    lines.push(
      `- **Output schema**: common structured envelope v${TOOL_OUTPUT_SCHEMA_VERSION} (` +
        "`schemaVersion`, `tool`, `result`)",
    );
    const resultSchema = tool.outputSchema?.result;
    if (resultSchema instanceof z.ZodObject) {
      lines.push("- **Result fields** (required nullable fields must be present as `null` when unknown):", "");
      lines.push("| Field | Type | Required | Description |", "|-------|------|:--------:|-------------|");
      for (const [name, schema] of Object.entries(resultSchema.shape)) {
        const field = describeField(schema as z.ZodTypeAny);
        lines.push(`| \`${name}\` | ${typeCell(field.type)} | ${field.required ? "✅" : "—"} | ${textCell(field.description)} |`);
      }
    }
    const fields = Object.entries(tool.inputSchema);
    if (fields.length) {
      lines.push("");
      lines.push("| Param | Type | Required | Default | Description |");
      lines.push("|-------|------|:--------:|---------|-------------|");
      for (const [fname, zt] of fields) {
        const d = describeField(zt as z.ZodTypeAny);
        lines.push(
          `| \`${fname}\` | ${typeCell(d.type)} | ${d.required ? "✅" : "—"} | ${textCell(d.def ?? "")} | ${textCell(d.description)} |`,
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
