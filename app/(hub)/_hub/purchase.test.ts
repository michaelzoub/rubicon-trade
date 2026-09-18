// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { openPurchase } from './purchase';

/** The dialog is opened by a deliberate control — a Buy button, a holding's
 * Sell — never by parsing what someone typed. A typed "buy $1 of NVIDIA" is a
 * request to the agent, and the agent proposes and settles it. */
it('opens the dialog only when a control asks for it, carrying that control’s request', () => {
  const heard = vi.fn();
  window.addEventListener('rubicon:purchase', heard);
  openPurchase({ amount: '1', query: 'NVIDIA' });
  expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ amount: '1', query: 'NVIDIA' });
  openPurchase();
  expect((heard.mock.calls[1][0] as CustomEvent).detail).toEqual({});
  window.removeEventListener('rubicon:purchase', heard);
});
