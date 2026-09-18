import { expect, it } from 'vitest';
import { BUY_CHAIN, catalogFor, isTradable, tradability } from './tradable';
import { CHAINS } from './chains';

it('settles everything on Base', () => {
  expect(BUY_CHAIN).toBe(8453);
  expect(CHAINS[BUY_CHAIN].name).toBe('Base');
});

it('maps a real stock ticker onto its tokenized Base pair', () => {
  // The card shows NVDA; the buy has to become NVDAc on Base.
  const t = tradability({ symbol: 'NVDA', name: 'NVIDIA Corp', kind: 'stock' });
  expect(t).toMatchObject({ status: 'tradable', chainId: 8453, symbol: 'NVDAc', decimals: 8, kind: 'stock', via: 'catalog' });
  if (t.status !== 'tradable') throw new Error('expected tradable');
  expect(t.token).toMatch(/^0x[0-9a-f]{40}$/);
  expect(t.icon).toContain('coingecko');
});

it('matches the tokenized ticker itself as well as the underlying', () => {
  expect(catalogFor({ symbol: 'nvdac' })?.symbol).toBe('NVDAc');
  expect(catalogFor({ symbol: 'NVDA' })?.symbol).toBe('NVDAc');
  expect(catalogFor({ symbol: 'GOOGL' })?.symbol).toBe('GOOGLc');
});

it('never trims a letter to invent an underlying', () => {
  // AERO must not be read as tracking "AER".
  expect(catalogFor({ symbol: 'AER' })).toBeUndefined();
  expect(catalogFor({ symbol: 'AERO' })?.symbol).toBe('AERO');
});

it('marks a stock with no tokenized market unavailable, and says why', () => {
  const t = tradability({ symbol: 'TSLA', name: 'Tesla Inc', kind: 'stock' });
  expect(t.status).toBe('unavailable');
  if (t.status !== 'unavailable') throw new Error('expected unavailable');
  expect(t.reason).toBe('No tokenized market');
  expect(t.detail).toContain('TSLA');
  expect(t.detail).toContain('Base');
  expect(isTradable({ symbol: 'TSLA', kind: 'stock' })).toBe(false);
});

it('buys a crypto asset that publishes its own Base contract', () => {
  const token = `0x${'ab'.repeat(20)}`;
  const t = tradability({ symbol: 'degen', name: 'Degen', kind: 'crypto', contracts: { '8453': token } });
  expect(t).toMatchObject({ status: 'tradable', chainId: 8453, token, via: 'contract' });
});

it('refuses crypto that only exists off Base, naming where it is', () => {
  const t = tradability({ symbol: 'SOMETHING', kind: 'crypto', contracts: { '137': `0x${'cd'.repeat(20)}` } });
  expect(t.status).toBe('unavailable');
  if (t.status !== 'unavailable') throw new Error('expected unavailable');
  expect(t.reason).toBe('Not on Base');
  expect(t.detail).toContain('Polygon');
});

it('does not offer a catalog entry that lists away from Base from a card', () => {
  // UNI is Ethereum-only in the catalog: still searchable, not offered on a card.
  const t = tradability({ symbol: 'UNI' });
  expect(t.status).toBe('unavailable');
  if (t.status !== 'unavailable') throw new Error('expected unavailable');
  expect(t.reason).toBe('On Ethereum');
});

it('treats a malformed contract as no contract at all', () => {
  expect(tradability({ symbol: 'X', kind: 'crypto', contracts: { '8453': 'not-an-address' } }).status).toBe('unavailable');
  expect(tradability({ symbol: 'X', kind: 'crypto', contracts: null }).status).toBe('unavailable');
});
