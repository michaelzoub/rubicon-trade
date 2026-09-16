import { expect, it } from 'vitest';
import { purchaseIntent } from './purchase';
it('extracts an explicit purchase amount and instrument without executing anything', () => {
  expect(purchaseIntent('buy $500 of NVDA')).toEqual({ amount: '500', query: 'NVDA' });
  expect(purchaseIntent('Please buy $1,250.50 of Ethereum.')).toEqual({ amount: '1250.50', query: 'Ethereum' });
});
it('does not mistake questions, conditional requests or invalid amounts for purchase intent', () => {
  for (const text of ['Should I buy $500 of NVDA?', 'If NVDA drops, buy $500 of NVDA', 'buy $0 of NVDA', 'buy $1,2 of NVDA', 'buy $500 of NVDA?']) expect(purchaseIntent(text)).toBeNull();
});
