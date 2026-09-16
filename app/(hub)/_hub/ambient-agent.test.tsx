// @vitest-environment happy-dom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PREVIEW_STATE } from '../../preview/fixture';
import type { HubContextValue } from './hub-provider';

let hub: HubContextValue;
vi.mock('./hub-provider', () => ({ useHub: () => hub }));
vi.mock('./navigation', () => ({ HubLink: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
import { AmbientAgent } from './ambient-agent';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  hub = { state: { ...PREVIEW_STATE, trades: [] }, messages: [], busy: false, send: vi.fn(async () => {}), stop: vi.fn(), error: null, lastChange: null, account: null } as unknown as HubContextValue;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => { root.render(<main><h1>Explore</h1><div className="wv-market"><button className="wv-market-object">An idea</button></div><AmbientAgent/></main>); });
const clickOrb = () => act(async () => { container.querySelector<HTMLButtonElement>('.ambient-orb')!.click(); });
const key = (value: string, ctrlKey = false) => act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey, bubbles: true })); });

it('summons from the keyboard, focuses the thought, and returns focus on Escape', async () => {
  await render(); await key('j', true);
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement).toBe(container.querySelector('textarea'));
  expect(container.textContent).toContain('In the context of your discoveries');
  await key('Escape');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('.ambient-orb'));
});

it('offers editable contextual prompts without sending until submission', async () => {
  await render(); await clickOrb();
  await act(async () => container.querySelector<HTMLButtonElement>('.ambient-prompts button')!.click());
  expect(container.querySelector('textarea')?.value).toBe('How do these ideas fit my thesis?');
  expect(hub.send).not.toHaveBeenCalled();
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(hub.send).toHaveBeenCalledWith('How do these ideas fit my thesis?');
});

it('does not submit when credits are exhausted', async () => {
  hub.account = { credits: { balanceMicros: 0 } } as HubContextValue['account'];
  await render(); await clickOrb();
  await act(async () => container.querySelector<HTMLButtonElement>('.ambient-prompts button')!.click());
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(hub.send).not.toHaveBeenCalled();
  expect(container.querySelector('textarea')?.disabled).toBe(true);
});

it('connects research, output, and approval states to provider activity', async () => {
  hub.busy = true; await render();
  expect(container.querySelector('.ambient-agent')?.getAttribute('data-state')).toBe('researching');
  hub.messages = [{ id: 'stream', role: 'assistant', at: '', status: 'streaming', parts: [] }];
  await render();
  expect(container.querySelector('.ambient-agent')?.getAttribute('data-state')).toBe('acting');
  hub.busy = false; hub.state = { ...hub.state, trades: PREVIEW_STATE.trades }; await render();
  expect(container.querySelector('.ambient-agent')?.getAttribute('data-state')).toBe('waiting');
});
