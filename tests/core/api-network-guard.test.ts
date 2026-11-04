import { describe, it, expect } from 'vitest';
import { getApiHost, getMoolahApiHost } from '../../src/core/chains.js';

describe('backend network isolation', () => {
  it.each(['', 'unknown', 'eth', 'mainnett', ' mainnet'])('rejects unsupported %j before choosing an API', network => {
    expect(() => getApiHost(network)).toThrow(/Unsupported network/);
    expect(() => getMoolahApiHost(network)).toThrow();
  });
  it('retains supported aliases and separates Nile from mainnet', () => {
    expect(getApiHost('TRX')).toBe(getApiHost('mainnet'));
    expect(getApiHost('testnet')).toBe(getApiHost('nile'));
    expect(getApiHost('nile')).not.toBe(getApiHost('mainnet'));
  });
});
