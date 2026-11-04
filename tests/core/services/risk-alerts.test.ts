import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRiskAlertReadClient } from '../../../src/core/services/risk-alerts.js';
const address = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const endpoint = 'https://alerts.example.test';
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const alert = { id: 'a1', alertType: 1, enabled: true, thresholdMode: 1, thresholds: [{ conditionKey: 'ALERT', value: null }] };
afterEach(() => vi.restoreAllMocks());
describe('public risk-alert reads (App contract)', () => {
  it('uses exact public methods/bodies and omits sensitive fields', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(envelope({ emailBound: true, email: 'private@example.test', alerts: [{ ...alert, signature: 'secret' }] }))
      .mockResolvedValueOnce(envelope([{ alertType: 1, version: 'V1', thresholds: alert.thresholds }]))
      .mockResolvedValueOnce(envelope([{ marketId: 'm1', marketStatus: 'unavailable', hasPosition: false, cookieId: 'secret' }]));
    const client = createRiskAlertReadClient({ baseUrl: endpoint, fetch });
    expect(await client.list(address)).toEqual({ emailBound: true, alerts: [alert] });
    expect(await client.rules()).toEqual([{ alertType: 1, version: 'V1', thresholds: alert.thresholds }]);
    expect(await client.markets(address)).toEqual([{ marketId: 'm1', marketStatus: 'unavailable', hasPosition: false }]);
    expect(fetch.mock.calls.map(([url, options]) => [url, options.method, options.body && JSON.parse(options.body)])).toEqual([
      [endpoint + '/notice/alert/list', 'POST', { address }],
      [endpoint + '/notice/alert/rule-defaults', 'GET', undefined],
      [endpoint + '/notice/alert/v2/markets', 'POST', { address, chain: 'tron' }]
    ]);
    expect(fetch.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
  });
  it.each(['', 'http://example.test', 'https://user:secret@example.test', 'https://example.test/?key=secret', 'https://example.test/#secret'])('rejects unsafe/missing endpoint %j', baseUrl => {
    expect(() => createRiskAlertReadClient({ baseUrl })).toThrow();
  });
  it.each(['nile', 'unknown', 'eth', ''])('rejects unsupported network %j', network => {
    expect(() => createRiskAlertReadClient({ baseUrl: endpoint, network })).toThrow();
  });
  it('rejects invalid address without any request', async () => {
    const fetch = vi.fn(); const client = createRiskAlertReadClient({ baseUrl: endpoint, fetch });
    await expect(client.list('invalid')).rejects.toThrow(/address/);
    await expect(client.markets('invalid')).rejects.toThrow(/address/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, {}, { emailBound: true }, { emailBound: 'false', alerts: [] }, { emailBound: false, alerts: [null] }])('does not turn invalid list into empty success: %j', data => {
    return expect(createRiskAlertReadClient({ baseUrl: endpoint, fetch: vi.fn().mockResolvedValue(envelope(data)) }).list(address)).rejects.toThrow(/response/);
  });
  it.each(['rules', 'markets'] as const)('rejects malformed %s rows', method => {
    return expect(createRiskAlertReadClient({ baseUrl: endpoint, fetch: vi.fn().mockResolvedValue(envelope([{}])) })[method](address)).rejects.toThrow(/response/);
  });
  it('preserves legitimate empty list', async () => {
    const client = createRiskAlertReadClient({ baseUrl: endpoint, fetch: vi.fn().mockResolvedValue(envelope({ emailBound: false, alerts: [] })) });
    expect(await client.list(address)).toEqual({ emailBound: false, alerts: [] });
  });
  it.each([
    () => Promise.reject(new Error('private@example.test secret')),
    () => Promise.resolve(new Response('private@example.test secret', { status: 500 })),
    () => Promise.resolve(new Response(JSON.stringify({ code: 32, msg: 'private@example.test secret', data: [] }))),
    () => Promise.resolve(new Response('not JSON'))
  ])('reports failure without exposing remote payload or pretending success', async fetch => {
    const client = createRiskAlertReadClient({ baseUrl: endpoint, fetch: fetch as typeof globalThis.fetch });
    const error = await client.rules().catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toMatch(/private@|secret/);
  });
});

it('sends no ambient credentials and handles an aborted deadline as unknown', async () => {
  const signal = AbortSignal.abort(new DOMException('deadline', 'TimeoutError'));
  const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
  const fetch = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => { throw signal.reason; });
  await expect(createRiskAlertReadClient({ baseUrl: endpoint, fetch }).rules()).rejects.toThrow(/unknown/);
  expect(deadline).toHaveBeenCalledWith(8000);
  expect(fetch.mock.calls[0][1]?.credentials).toBe('omit');
  expect(fetch.mock.calls[0][1]?.signal).toBe(signal);
});
