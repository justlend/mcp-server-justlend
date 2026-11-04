import { expect, it, vi, afterEach } from 'vitest';
import { registerRiskAlertTools } from '../../src/core/tools/risk-alert-tools.js';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('registers exactly three read-only tools without signing or session inputs', async () => {
  const captured = new Map<string, any>();
  registerRiskAlertTools({ registerTool: (name: string, config: any, handler: any) => captured.set(name, { config, handler }) } as any);
  expect([...captured.keys()]).toEqual(['get_risk_alerts', 'get_risk_alert_rules', 'get_risk_alert_markets']);
  for (const { config } of captured.values()) {
    expect(config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(Object.keys(config.inputSchema).every(key => ['network', 'address'].includes(key))).toBe(true);
  }
  vi.stubEnv('JUSTLEND_ALERT_API_URL', 'https://alerts.example.test');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  const result = await captured.get('get_risk_alert_rules').handler({ network: 'mainnet' });
  expect(result.isError).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
