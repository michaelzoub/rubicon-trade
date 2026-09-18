import { expect, it } from 'vitest';
import { CATALOG, CATALOG_ENTRIES, catalogEntry, primaryChain } from './catalog';
import { CHAINS } from './chains';

it('pins every entry to a real, lowercase address on a supported chain', () => {
  for (const entry of CATALOG_ENTRIES) {
    expect(Object.keys(entry.contracts).length, `${entry.symbol} has no contract`).toBeGreaterThan(0);
    for (const [chainId, address] of Object.entries(entry.contracts)) {
      expect(Number(chainId) in CHAINS, `${entry.symbol} on unsupported chain ${chainId}`).toBe(true);
      expect(address, `${entry.symbol} on ${chainId}`).toMatch(/^0x[0-9a-f]{40}$/);
    }
  }
});

/** A placeholder address ships a Buy button that points at nothing. The real
 * guard is the onchain `symbol()` check in `live.test.ts`; this catches the
 * shapes that never need a network call to reject. */
it('contains no zero or obviously placeholder addresses', () => {
  for (const entry of CATALOG_ENTRIES) {
    for (const [chainId, address] of Object.entries(entry.contracts)) {
      const body = address.slice(2), where = `${entry.symbol} on ${chainId}`;
      expect(/^0+$/.test(body), `${where} is the zero address`).toBe(false);
      expect(/^(dead|beef|1234|abcd)/.test(body), `${where} looks like a placeholder`).toBe(false);
    }
  }
});

it('has no duplicate symbols and no two entries sharing one contract', () => {
  const symbols = CATALOG_ENTRIES.map(e => e.symbol.toLowerCase());
  expect(new Set(symbols).size).toBe(symbols.length);
  const pins = CATALOG_ENTRIES.flatMap(e => Object.entries(e.contracts).map(([c, a]) => `${c}:${a}`));
  expect(new Set(pins).size).toBe(pins.length);
});

it('records the real decimals, because the tokenized stocks are not eighteen', () => {
  // A wrong decimal count misplaces the point in what a buyer is told they get.
  for (const entry of CATALOG_ENTRIES) {
    expect(Number.isInteger(entry.decimals), `${entry.symbol} decimals`).toBe(true);
    expect(entry.decimals, `${entry.symbol} decimals`).toBeGreaterThan(0);
    expect(entry.decimals, `${entry.symbol} decimals`).toBeLessThanOrEqual(18);
  }
  expect(CATALOG_ENTRIES.find(e => e.symbol === 'NVDAc')!.decimals).toBe(8);
  expect(CATALOG_ENTRIES.find(e => e.symbol === 'WETH')!.decimals).toBe(18);
});

it('leads with stocks and gives every one of them a real icon', () => {
  expect(CATALOG[0].title).toBe('Stocks');
  expect(CATALOG[0].entries.length).toBeGreaterThanOrEqual(5);
  for (const entry of CATALOG_ENTRIES) expect(entry.icon, `${entry.symbol} has no icon`).toMatch(/^https:\/\/coin-images\.coingecko\.com\//);
});

it('keeps each symbol in the casing its contract actually reports', () => {
  // `scripts/verify-catalog.ts` holds these to onchain `symbol()`, and Coinbase's
  // tokenized stocks really are NVDAc rather than NVDAC.
  expect(CATALOG_ENTRIES.find(e => e.symbol === 'NVDAc')).toBeDefined();
  expect(CATALOG_ENTRIES.some(e => e.symbol === 'NVDAC')).toBe(false);
});

it('resolves an entry back from a chain and contract, for output units', () => {
  const nvda = CATALOG_ENTRIES.find(e => e.symbol === 'NVDAc')!;
  expect(catalogEntry(8453, nvda.contracts[8453]!.toUpperCase())?.decimals).toBe(8);
  expect(catalogEntry(8453, `0x${'99'.repeat(20)}`)).toBeUndefined();
});

it('buys a multi-chain asset on Base, not the chain with the lowest fee', () => {
  // Polygon reserves less than Base but holds far less liquidity; slippage on a
  // thin pool costs more than the fee it saves.
  const weth = CATALOG_ENTRIES.find(e => e.symbol === 'WETH')!;
  expect(Object.keys(weth.contracts).length).toBeGreaterThan(1);
  expect(primaryChain(weth)).toBe(8453);
});

it('buys each entry on its listed chain, never Ethereum when a rollup exists', () => {
  for (const entry of CATALOG_ENTRIES) {
    const chainId = primaryChain(entry);
    expect(entry.contracts[chainId], `${entry.symbol} primary chain has no contract`).toBeDefined();
    const ids = Object.keys(entry.contracts).map(Number);
    if (ids.length > 1) expect(chainId, `${entry.symbol} defaults to mainnet despite a rollup listing`).not.toBe(1);
  }
});

it('labels tokenized stocks so they are never mistaken for brokerage shares', () => {
  const stocks = CATALOG.find(s => s.title === 'Stocks');
  expect(stocks?.note).toMatch(/not brokerage shares/i);
  expect(stocks?.entries.every(e => e.kind === 'stock')).toBe(true);
});
