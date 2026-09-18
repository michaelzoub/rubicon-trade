import { expect, it, vi, beforeEach } from 'vitest';
import type { ChatEvent, HubState } from '../types';

vi.mock('./tools', () => ({ profileSummary: () => ({}) }));
vi.mock('../trades', () => ({ describeLimits: () => '' }));
vi.mock('../agents/personality', () => ({ agentVoice: () => '' }));
vi.mock('../agents/services', () => ({ agentServices: {} }));

const execute = vi.fn();
vi.mock('../agents/builtins', () => ({ capabilities: { schemas: () => [{ type: 'function', function: { name: 'get_crypto_holdings', parameters: { type: 'object', properties: {} } } }], execute: (...a: unknown[]) => execute(...a) } }));

const { runAgent } = await import('./run');

/** One OpenRouter SSE response body from a list of choice deltas. */
const sse = (chunks: unknown[]) => new Response(
  new ReadableStream({ start(controller) {
    for (const c of chunks) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(c)}\n`));
    controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
    controller.close();
  } }),
  { status: 200 },
);

const state = { profile: { permission: 'approve' }, agent: { id: 'a1', name: 'Kafka' } } as unknown as HubState;
const chat = { id: 'c1', messages: [] } as never;

beforeEach(() => { process.env.OPENROUTER_API_KEY = 'k'; execute.mockReset(); });

/** The model guesses aloud and then calls the tool that contradicts it.
 *
 * Streamed straight through, both halves land in one bubble: "You don't hold
 * any AAPLc" immediately followed by "You hold about 0.0084 AAPLc". Only the
 * answer that saw the tool result is the answer. */
it('does not keep prose the model wrote before the tool it was about to call', async () => {
  execute.mockResolvedValue({ result: { holdings: [{ symbol: 'AAPLc', display: '0.0084' }] }, parts: [] });
  const responses = [
    sse([
      { choices: [{ delta: { content: 'You don’t hold any AAPLc tokens.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'get_crypto_holdings', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
    ]),
    sse([{ choices: [{ delta: { content: 'You hold about 0.0084 AAPLc.' }, finish_reason: 'stop' }] }]),
  ];
  vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));

  const events: ChatEvent[] = [];
  const parts = await runAgent({ state, chat, userId: 'u1', text: 'sell my aapl', emit: e => events.push(e), assistantId: 'm1' });

  const text = parts.filter(p => p.type === 'text').map(p => p.text).join('');
  expect(text).toBe('You hold about 0.0084 AAPLc.');
  expect(text).not.toContain('don’t hold');
  // Whatever already reached the client has to be taken back there too.
  expect(events.filter(e => e.type === 'retract')).toEqual([{ type: 'retract', text: 'You don’t hold any AAPLc tokens.' }]);
});

it('still streams a plain answer that calls no tools', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse([
    { choices: [{ delta: { content: 'Gold is ' } }] },
    { choices: [{ delta: { content: 'up.' }, finish_reason: 'stop' }] },
  ])));
  const events: ChatEvent[] = [];
  const parts = await runAgent({ state, chat, userId: 'u1', text: 'how is gold', emit: e => events.push(e), assistantId: 'm1' });
  expect(parts).toEqual([{ type: 'text', text: 'Gold is up.' }]);
  expect(events.filter(e => e.type === 'text')).toHaveLength(2);
});
