// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ crypto: vi.fn() }));
vi.mock('./hub-provider', () => ({ useHub: () => ({ crypto: mocks.crypto, state: { trades: [] } }) }));
vi.mock('./parts', () => ({ AssetLogo: () => null, TradeCard: () => <div>Sale confirmation</div> }));
import { SellPanel } from './sell-panel';
const held = { chainId: 8453, chainName: 'Base', wallet: `0x${'11'.repeat(20)}`, token: `0x${'22'.repeat(20)}`, symbol: 'TOKEN', decimals: 18, balance: '1234567890123456789', display: '1.234567', kind: 'token' };
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.crypto.mockReset().mockImplementation(async body => body.action === 'holdings' ? { holdings: [held], complete: false } : { tradeId: 'sale' });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('sells an exact maximum balance through the verified wallet into Base USDC', async () => {
  await act(async () => root.render(<SellPanel />));
  expect(container.textContent).toContain('Some tokens may be missing');
  expect(container.textContent).not.toContain(held.wallet);
  await act(async () => container.querySelector<HTMLButtonElement>('.hub-buy-result')!.click());
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Max')!.click());
  expect(container.querySelector<HTMLInputElement>('#sell-amount')!.value).toBe('1.234567890123456789');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.crypto).toHaveBeenCalledWith(expect.objectContaining({ action: 'propose', tokenIn: held.token, tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', wallet: held.wallet, amount: '1.234567890123456789' }));
  expect(container.textContent).toContain('Sale confirmation');
});
it('disables a sale larger than the owned balance', async () => {
  await act(async () => root.render(<SellPanel />));
  await act(async () => container.querySelector<HTMLButtonElement>('.hub-buy-result')!.click());
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#sell-amount')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
});
it('keeps Ethereum holdings hidden and selects the exact Base holding', async () => {
  const ethereum = { ...held, chainId: 1, chainName: 'Ethereum' };
  mocks.crypto.mockImplementation(async body => body.action === 'holdings' ? { holdings: [held, ethereum], complete: true } : { tradeId: 'sale' });
  await act(async () => root.render(<SellPanel initialHolding={held} />));
  expect(container.textContent).not.toContain('Ethereum');
  expect(container.querySelector('button[aria-pressed=true]')?.textContent).toContain('Base');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Max')!.click());
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.crypto).toHaveBeenCalledWith(expect.objectContaining({ action: 'propose', chainId: 8453, tokenIn: held.token, tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', wallet: held.wallet }));
});
