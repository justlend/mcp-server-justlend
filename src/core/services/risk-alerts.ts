import { TronWeb } from 'tronweb';

// Public reads from App master f408aed2. No wallet, session, email or write API.
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown) => (typeof value === 'string' && value.trim().length > 0) || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
const invalid = () => new Error('Invalid risk alert API response.');
const fields = ['id', 'alertType', 'enabled', 'version', 'chain', 'marketId', 'marketName', 'marketStatus',
  'marketNameDuplicated', 'collateralSymbol', 'loanSymbol', 'thresholdMode', 'hasPosition', 'positionUsd', 'hasAlert', 'alertId'];
function publicRow(row: Row): Row {
  const out: Row = {};
  for (const field of fields) {
    const value = row[field];
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[field] = value;
  }
  if (row.thresholds !== undefined) {
    if (!Array.isArray(row.thresholds)) throw invalid();
    out.thresholds = row.thresholds.map(item => {
      if (!record(item) || typeof item.conditionKey !== 'string' || !item.conditionKey ||
          !(item.value === null || typeof item.value === 'string' || (typeof item.value === 'number' && Number.isFinite(item.value)))) throw invalid();
      return { conditionKey: item.conditionKey, value: item.value };
    });
  }
  return out;
}
function addressInput(address: string): void {
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) || !TronWeb.isAddress(address)) throw new Error('Invalid TRON Base58 address.');
}
export function createRiskAlertReadClient(options: { baseUrl?: string; network?: string; fetch?: typeof globalThis.fetch } = {}) {
  const network = (options.network ?? 'mainnet').toLowerCase();
  if (!['mainnet', 'tron', 'trx'].includes(network)) throw new Error('Risk alert API supports mainnet TRON only.');
  const input = options.baseUrl ?? process.env.JUSTLEND_ALERT_API_URL;
  if (!input) throw new Error('Set JUSTLEND_ALERT_API_URL to an explicitly trusted risk alert API endpoint.');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Invalid risk alert API endpoint.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Risk alert API endpoint must be HTTPS without credentials, query or fragment.');
  const baseUrl = url.toString().replace(/\/$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  async function request(path: string, body?: Row): Promise<unknown> {
    try {
      const response = await fetchImpl(`${baseUrl}/notice/alert/${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(8000),
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      if (!response.ok) throw new Error('HTTP failure');
      const result: unknown = await response.json();
      if (!record(result) || (result.code !== 0 && result.code !== '0')) throw new Error('API failure');
      return result.data;
    } catch {
      // Never echo endpoint credentials, server error messages, emails or payloads.
      throw new Error('Risk alert API request failed or returned an invalid response; state is unknown.');
    }
  }
  return Object.freeze({
    async list(address: string) {
      addressInput(address);
      const data = await request('list', { address });
      if (!record(data) || typeof data.emailBound !== 'boolean' || !Array.isArray(data.alerts)) throw invalid();
      const alerts = data.alerts.map(row => {
        if (!record(row) || !identity(row.id) || ![1, 2, 3].includes(row.alertType as number) || typeof row.enabled !== 'boolean') throw invalid();
        return publicRow(row);
      });
      return { emailBound: data.emailBound, alerts };
    },
    async rules() {
      const data = await request('rule-defaults');
      if (!Array.isArray(data)) throw invalid();
      return data.map(row => {
        if (!record(row) || ![1, 2, 3].includes(row.alertType as number) || !Array.isArray(row.thresholds)) throw invalid();
        return publicRow(row);
      });
    },
    async markets(address: string) {
      addressInput(address);
      const data = await request('v2/markets', { address, chain: 'tron' });
      if (!Array.isArray(data)) throw invalid();
      return data.map(row => {
        if (!record(row) || typeof row.marketId !== 'string' || !row.marketId.trim() || typeof row.marketStatus !== 'string' || !row.marketStatus) throw invalid();
        return publicRow(row);
      });
    }
  });
}
