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
import { gsap } from '../../_components/motion';

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  hub = { state: { ...PREVIEW_STATE, trades: [] }, messages: [], busy: false, send: vi.fn(async () => {}), stop: vi.fn(), error: null, lastChange: null, account: null, agents: [] } as unknown as HubContextValue;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = () => act(async () => { root.render(<main><h1>Explore</h1><div data-agent-region="market"><button className="wv-market-object">An idea</button></div><AmbientAgent/></main>); });
const clickOrb = () => act(async () => { container.querySelector<HTMLButtonElement>('.ambient-orb')!.click(); });
const key = (value: string, ctrlKey = false) => act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey, bubbles: true })); });
const state = () => container.querySelector('.ambient-agent')?.getAttribute('data-state');

it('summons from the keyboard, focuses the thought, and returns focus on Escape', async () => {
  await render(); await key('j', true);
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement).toBe(container.querySelector('textarea'));
  await key('Escape');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('.ambient-orb'));
});

it('opens with the person’s own convictions rather than a stock list of prompts', async () => {
  await render(); await clickOrb();
  const first = container.querySelector<HTMLButtonElement>('.ambient-prompts button')!;
  expect(first.textContent).toContain(PREVIEW_STATE.profile.thesis.split(/(?<=[.!?])\s+|\n+/)[0].replace(/[.!?]$/, '').slice(0, 30));
  await act(async () => first.click());
  const prompt = container.querySelector('textarea')!.value;
  expect(prompt).toContain('Challenge');
  expect(hub.send).not.toHaveBeenCalled();
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(hub.send).toHaveBeenCalledWith(prompt);
});

it('does not submit when credits are exhausted', async () => {
  hub.account = { credits: { balanceMicros: 0 } } as HubContextValue['account'];
  await render(); await clickOrb();
  await act(async () => container.querySelector<HTMLButtonElement>('.ambient-prompts button')!.click());
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(hub.send).not.toHaveBeenCalled();
  expect(container.querySelector('textarea')?.disabled).toBe(true);
});

it('is quiet until something happens, then shows one state at a time', async () => {
  await render();
  expect(state()).toBe('idle');

  hub.busy = true; await render();
  expect(state()).toBe('thinking');

  hub.messages = [{ id: 'stream', role: 'assistant', at: '', status: 'streaming', parts: [] }];
  await render();
  expect(state()).toBe('interacting');

  // A decision nobody can make but the person outranks the agent's own work.
  hub.state = { ...hub.state, trades: PREVIEW_STATE.trades }; await render();
  expect(state()).toBe('wanting');
});

it('turns its attention to what is being read without going there', async () => {
  await render();
  const before = container.querySelector('.ambient-agent')!.getAttribute('style');
  await act(async () => { window.dispatchEvent(new CustomEvent('rubicon:attend', { detail: { x: 600, y: 300 } })); });
  expect(state()).toBe('observing');
  // Looking is not travelling: the body has not been asked to move.
  expect(container.querySelector('.ambient-agent')!.getAttribute('style')).toBe(before);
  await act(async () => { window.dispatchEvent(new CustomEvent('rubicon:attend', { detail: null })); });
  expect(state()).toBe('idle');
});

it('names its state for anyone not watching it move', async () => {
  await render();
  expect(container.querySelector('.ambient-orb')?.getAttribute('aria-label')).toContain('Here when you need me');
  hub.state = { ...hub.state, trades: PREVIEW_STATE.trades }; await render();
  expect(container.querySelector('.ambient-orb')?.getAttribute('aria-label')).toContain('A decision needs you');
});

it('holds still while it is being reached for, and while the thought is open', async () => {
  await render();
  const agent = container.querySelector<HTMLElement>('.ambient-agent')!;
  expect(agent.dataset.held).toBeUndefined();

  // React synthesises enter and leave from the bubbling over/out pair.
  await act(async () => { agent.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); });
  expect(agent.dataset.held).toBe('true');
  await act(async () => { agent.dispatchEvent(new MouseEvent('pointerout', { bubbles: true })); });
  expect(agent.dataset.held).toBeUndefined();

  // Opening it is the other reason to stop: nothing being read should move.
  await clickOrb();
  expect(container.querySelector('.ambient-agent')?.getAttribute('data-open')).toBe('true');
});

it('keeps the thought surface on screen wherever the agent happens to be', async () => {
  await render();
  await clickOrb();
  const agent = container.querySelector<HTMLElement>('.ambient-agent')!;
  const panel = container.querySelector<HTMLElement>('.ambient-panel')!;
  expect(panel).not.toBeNull();
  // The agent is the panel's origin, so it must sit where a panel still fits.
  const x = Number((agent.style.transform.match(/translate(?:3d)?\(([-\d.]+)px/) ?? [])[1] ?? 0);
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThanOrEqual(Math.max(16, window.innerWidth - Math.min(520, window.innerWidth - 32) - 16) + 1);
});

it('keeps travelling through a change of mood rather than snapping back to its last seat', async () => {
  // Motion allowed: the wander actually runs, on GSAP’s own clock.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(document, 'elementFromPoint', { value: () => null, configurable: true });
  await render();
  const agent = container.querySelector<HTMLElement>('.ambient-agent')!;
  const at = () => ({ x: gsap.getProperty(agent, 'x') as number, y: gsap.getProperty(agent, 'y') as number });
  const seat = at();
  // Into the first journey: the rest is 1.2s, the shortest leg is several seconds.
  const now = gsap.globalTimeline.time();
  await act(async () => { gsap.globalTimeline.time(now + 3); });
  const before = at();
  expect(before).not.toEqual(seat);
  // Something is being read nearby: the mood changes mid-flight.
  await act(async () => { window.dispatchEvent(new CustomEvent('rubicon:attend', { detail: { x: 600, y: 300 } })); });
  expect(state()).toBe('observing');
  expect(at()).toEqual(before);
  // And it carries on from there, not from the seat.
  await act(async () => { gsap.globalTimeline.time(now + 3.5); });
  const after = at();
  const far = (p: { x: number; y: number }) => Math.hypot(p.x - seat.x, p.y - seat.y);
  expect(far(after)).toBeGreaterThan(far(before));
});
