import { beforeEach, expect, it, vi } from 'vitest';

/** Privy's own test for a delegated wallet is `'id' in account && delegated`.
 * Matching it exactly matters: a stricter check would enable the grant UI and
 * then refuse every purchase, which is the worst of both. */
const linked: Record<string, unknown>[] = [];
vi.mock('@privy-io/node', () => ({ PrivyClient: class { users() { return { _get: async () => ({ linked_accounts: linked }) }; } } }));

const { delegatedWallet, firstDelegatedWallet } = await import('./wallet');
const ADDRESS = `0x${'11'.repeat(20)}`;

beforeEach(() => {
  linked.length = 0;
  vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', 'app');
  vi.stubEnv('PRIVY_APP_SECRET', 'secret');
});

it('accepts a delegated wallet of either embedded generation', async () => {
  for (const clientType of ['privy', 'privy-v2']) {
    linked.length = 0;
    linked.push({ type: 'wallet', chain_type: 'ethereum', address: ADDRESS, id: 'kq-1', wallet_client_type: clientType, delegated: true });
    expect(await delegatedWallet('u1', ADDRESS), clientType).toEqual({ id: 'kq-1', address: ADDRESS });
  }
});

it('refuses a wallet with no signer on it', async () => {
  linked.push({ type: 'wallet', chain_type: 'ethereum', address: ADDRESS, id: 'kq-1', delegated: false });
  expect(await delegatedWallet('u1', ADDRESS)).toBeNull();
});

it('refuses an external wallet, which has no server id to sign through', async () => {
  linked.push({ type: 'wallet', chain_type: 'ethereum', address: ADDRESS, wallet_client_type: 'metamask', delegated: true });
  expect(await delegatedWallet('u1', ADDRESS)).toBeNull();
});

it('ignores wallets on other chains and other addresses', async () => {
  linked.push({ type: 'wallet', chain_type: 'solana', address: ADDRESS, id: 'kq-sol', delegated: true });
  expect(await delegatedWallet('u1', ADDRESS)).toBeNull();
  linked.length = 0;
  linked.push({ type: 'wallet', chain_type: 'ethereum', address: `0x${'99'.repeat(20)}`, id: 'kq-2', delegated: true });
  expect(await delegatedWallet('u1', ADDRESS)).toBeNull();
});

it('finds the first delegated wallet on the account, for the pre-purchase check', async () => {
  linked.push(
    { type: 'wallet', chain_type: 'ethereum', address: `0x${'22'.repeat(20)}`, id: 'kq-a', delegated: false },
    { type: 'wallet', chain_type: 'ethereum', address: ADDRESS, id: 'kq-b', delegated: true },
  );
  expect(await firstDelegatedWallet('u1')).toEqual({ id: 'kq-b', address: ADDRESS });
});

it('reports nothing rather than throwing when Privy is not configured', async () => {
  vi.stubEnv('NEXT_PUBLIC_PRIVY_APP_ID', '');
  expect(await delegatedWallet('u1', ADDRESS)).toBeNull();
});
