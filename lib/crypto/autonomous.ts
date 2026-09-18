import 'server-only';
import { chain } from './chains';
import { autoSigningConfigured, delegatedAuthorization, delegatedProvider } from './autosign';
import { sendSwapBatch } from './gasless';
import { authorizeSwap, prepareSwap } from './trades';
import { verifyUserOperation } from './rpc';
import { BUY_CHAIN } from './tradable';
import { tradePolicy } from '@/lib/socialtrading/policy';
import { recordEvent } from '@/lib/socialtrading/personalization';
import type { HubState, TradeIntent } from '@/lib/socialtrading/types';

/** Whether this user has actually handed Rubicon the ability to buy unattended.
 *
 * Four things must all be true, and none of them defaults on:
 *
 *  1. The person turned `autoExecute` on themselves.
 *  2. Their agent is in Act mode, so it may reserve without asking.
 *  3. They set real per-trade and daily limits — `tradePolicy` enforces them.
 *  4. A delegated signer exists for the wallet, and the app is configured to
 *     use one. Without this nothing can be signed and the attempt is refused
 *     rather than queued.
 *
 * Read this before offering the tool and again before executing: a person can
 * revoke the signer or turn the setting off between the two. */
export function autonomyState(state: HubState, walletId?: string | null) {
  const profile = state.profile;
  if (!profile.autoExecute) return { allowed: false as const, reason: 'Unattended buying is off. You can turn it on in your profile.' };
  if (profile.permission !== 'automatic') return { allowed: false as const, reason: 'Unattended buying needs your agent in Act mode.' };
  if (!profile.limits?.perTrade || !profile.limits?.daily) return { allowed: false as const, reason: 'Set a per-trade and daily limit before buying unattended.' };
  if (!autoSigningConfigured()) return { allowed: false as const, reason: 'This deployment has no signing key for delegated wallets, so nothing can be bought unattended.' };
  if (!walletId) return { allowed: false as const, reason: 'No delegated wallet. Grant Rubicon signing access to a wallet in your profile first.' };
  return { allowed: true as const, reason: '' };
}

export const canBuyUnattended = (state: HubState, walletId?: string | null) => autonomyState(state, walletId).allowed;

/** Carry a reserved trade all the way to a confirmed onchain purchase, with no
 * person present.
 *
 * Deliberately not a new execution path: it drives the same `prepareSwap` →
 * `authorizeSwap` → `sendSwapBatch` the browser drives, with Privy signing in
 * place of the wallet popup. The server still authorizes the calldata, the
 * paymaster still takes the fee from USDC, and the operation is still held to
 * the batch that was authorized. */
export async function executeAutonomousBuy(state: HubState, userId: string, trade: TradeIntent, wallet: { id: string; address: string }) {
  const c = trade.crypto;
  if (!c) throw new Error('This proposal has nothing to execute.');
  const gate = autonomyState(state, wallet.id);
  if (!gate.allowed) throw new Error(gate.reason);

  // Base only, checked here as well as in `proposeSwap`, because this is the
  // one path where nobody would notice a mistake until the money had moved.
  if (c.request.chainId !== BUY_CHAIN) throw new Error(`Unattended buying settles on ${chain(BUY_CHAIN).name} only.`);
  if (c.request.wallet.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('This proposal is for a different wallet than the delegated one.');

  // The limits again, immediately before spending. A reservation made minutes
  // ago is not permission to spend now if the day's allowance has since gone.
  const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true, Date.now(), trade.initiator ?? 'agent');
  if (!policy.allowed) throw new Error(policy.reason);
  const perTrade = Number(state.profile.limits!.perTrade);
  if (!Number.isFinite(perTrade) || perTrade <= 0) throw new Error('Set a per-trade limit before buying unattended.');
  if (trade.value > perTrade) throw new Error('This purchase is over your per-trade limit.');

  const prepared = await prepareSwap(state, userId, trade);
  // An approval transaction means the sponsored batch was unavailable; that path
  // needs native gas and a person, so it stops here rather than half-finishing.
  if ('transaction' in prepared) throw new Error('This purchase needs a separate approval, which only you can sign. Open Rubicon to finish it.');
  if (!prepared.quoteId) throw new Error('No quote was produced for this purchase.');

  const provider = delegatedProvider(wallet.id, wallet.address, c.request.chainId);
  let permitSignature: string | undefined;
  if (prepared.permitData) {
    permitSignature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [wallet.address, JSON.stringify({ domain: prepared.permitData.domain, types: prepared.permitData.types, primaryType: 'PermitSingle', message: prepared.permitData.values })],
    }) as string;
  }

  const authorized = await authorizeSwap(state, userId, trade, prepared.quoteId, permitSignature);
  if (!('batch' in authorized)) throw new Error('Unattended buying requires a sponsored operation, and none was authorized.');
  const batch = authorized.batch;

  const sent = await sendSwapBatch({
    batch,
    provider,
    signAuthorization: delegatedAuthorization(wallet.id, wallet.address),
    expiresAt: authorized.expiresAt,
  });

  c.hash = sent.hash; c.userOpHash = sent.userOpHash;
  c.detail = 'Bought without you present, under the limits you set. The network fee came out of your USDC.';

  // A hash is a claim. Only a verified receipt confirms a purchase.
  const verified = await verifyUserOperation(batch, sent.userOpHash, sent.hash);
  if (verified === 'confirmed') {
    (c.history ??= []).push({ step: 'swap', hash: sent.hash, result: 'confirmed' });
    c.phase = 'complete'; trade.status = 'confirmed';
    recordEvent(state, 'trade', `Your agent bought ${trade.asset.symbol} for you`, sent.hash, trade.id);
  } else if (verified === 'reverted') {
    (c.history ??= []).push({ step: 'swap', hash: sent.hash, result: 'reverted' });
    c.phase = 'complete'; trade.status = 'failed';
    c.detail = 'The purchase reverted onchain. Nothing was bought.';
    recordEvent(state, 'trade', `An unattended ${trade.asset.symbol} purchase reverted`, sent.hash, trade.id);
  } else {
    // Left pending on purpose: the next status poll settles it either way.
    trade.status = 'unknown';
  }
  return { hash: sent.hash, userOpHash: sent.userOpHash, status: trade.status };
}
