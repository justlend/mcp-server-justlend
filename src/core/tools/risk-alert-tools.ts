import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createRiskAlertReadClient } from '../services/risk-alerts.js';
import { getGlobalNetwork } from '../services/index.js';
import { toolError, tronAddress } from './shared.js';

export function registerRiskAlertTools(server: McpServer) {
  for (const [name, method, description] of [
    ['get_risk_alerts', 'list', 'Read configured risk alerts and email-bound status for an explicit TRON address. Does not reveal an email or change alerts.'],
    ['get_risk_alert_rules', 'rules', 'Read default risk alert thresholds. Missing/null values remain unavailable, not zero or usable defaults.'],
    ['get_risk_alert_markets', 'markets', 'Read selectable V2 alert markets for an explicit TRON address, preserving unavailable markets and position status.']
  ] as const) {
    server.registerTool(name, {
      description: description + ' Mainnet TRON only; requires operator-configured JUSTLEND_ALERT_API_URL. No wallet/signature/session is used. On query errors state is unknown, not an empty result. Alert writes are not supported.',
      inputSchema: {
        ...(method === 'rules' ? {} : { address: tronAddress('TRON account to query; no wallet lookup') }),
        network: z.string().optional().describe('Network; mainnet only')
      },
      annotations: { title: name, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    }, async ({ address, network = getGlobalNetwork() }) => {
      try {
        const client = createRiskAlertReadClient({ network });
        const result = method === 'rules' ? await client.rules() : await client[method](address!);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) { return toolError(error); }
    });
  }
}
