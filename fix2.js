import fs from 'fs';
let content = fs.readFileSync('src/core/tools.ts', 'utf8');

// replace only 'network = "mainnet"' to 'network = services.getGlobalNetwork()'
content = content.replace(/network = "mainnet"/g, 'network = services.getGlobalNetwork()');

// Append the two tools
const inject = `
  // ============================================================================
  // GLOBAL CONFIGURATION
  // ============================================================================

  server.registerTool(
    "set_network",
    {
      description: "Set the global default network used by all JustLend operations unless explicitly overridden.",
      inputSchema: {
        network: z.string().describe("Network name (mainnet, nile)."),
      },
      annotations: { title: "Set Global Network", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ network }) => {
      try {
        services.setGlobalNetwork(network);
        return { content: [{ type: "text", text: \`Successfully switched global default network to: \${network}\` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: \`Error: \${sanitizeError(error)}\` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_network",
    {
      description: "Get the current global default network used by all JustLend operations.",
      inputSchema: {},
      annotations: { title: "Get Global Network", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      return { content: [{ type: "text", text: \`Current global default network: \${services.getGlobalNetwork()}\` }] };
    },
  );
`;

// Insert it before the last closing brace
const lastBraceIndex = content.lastIndexOf('}');
if (lastBraceIndex !== -1) {
  content = content.substring(0, lastBraceIndex) + inject + content.substring(lastBraceIndex);
}

fs.writeFileSync('src/core/tools.ts', content);
