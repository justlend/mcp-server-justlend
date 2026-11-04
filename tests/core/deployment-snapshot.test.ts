import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getJustLendAddresses } from '../../src/core/chains.js';
const snapshot = JSON.parse(readFileSync(new URL('../fixtures/deployments.verified.json', import.meta.url), 'utf8'));
it.each(snapshot.assertions)('$network $path matches independent deployment evidence', ({ network, path, expected }) => {
  const value = path.split('.').reduce((value: any, key: string) => value[key], getJustLendAddresses(network));
  expect(value).toEqual(expected);
});
