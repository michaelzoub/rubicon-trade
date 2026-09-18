import 'server-only';
import { address, chain, parseUnits } from './chains';
import { CROSS_CHAIN_FUNDING, FUNDING_CHAINS } from './tradable';
import { liveFeeReserve, type ReserveReader } from './fee-reserve';
import { rpc } from './rpc';
import { ownedWallet } from './wallet';
import { createUniswapBridge } from './providers/uniswap-bridge';

const provider = createUniswapBridge();

/** Why a funded chain could not be used, or what it would cost if it can.
 * The panel shows only the winner; the agent gets the whole list, because
 * "your money is on Polygon and nothing reaches this token" is the useful
 * answer to "can I afford this?". */
export type RouteCandidate = {
  chainId: number; wallet: string; balance: string;
  /** What the network fee on this chain costs right now, in USDC base units. */
  reserve: string;
} & (
  | { status: 'same_chain' }
  | { status: 'available'; input: string; outputAmount: string; gasFeeUSD?: string; timeEstimateMs?: number }
  | { status: 'insufficient' }
  | { status: 'fee_exceeds_amount' }
  | { status: 'unavailable'; reason: string }
);
export type ResolvedRoute = { chosen: RouteCandidate | null; candidates: RouteCandidate[] };

const balanceData = (wallet: string) => `0x70a08231${wallet.slice(2).padStart(64, '0')}`;

/** The USDC that actually reaches the bridge.
 *
 * Circle's Paymaster pulls its fee in postOp, after execution, so a step that
 * spends its whole USDC balance reverts. Holding back the source chain's live
 * fee is what lets a wallet holding exactly the purchase price complete a buy:
 * the user pays `amount`, and `amount` minus a few cents arrives. Only the
 * source is reserved — real routes execute every step there and deliver the
 * target token, not USDC, so a destination reserve would shrink the output for
 * nothing. */
export const bridgeInput = (amount: bigint, reserve: bigint) => amount - reserve;

/** Find the money and pick the route, without asking the user which network
 * they keep their USDC on. Every balance is read server-side over RPC, so the
 * wallet is never asked to switch networks just to answer "can I afford this?". */
export async function resolvePurchaseRoute(userId: string, input: { wallets: string[]; destinationChainId: number; tokenOut: string; amount: string }, read?: ReserveReader): Promise<ResolvedRoute> {
  const tokenOut = address(input.tokenOut);
  chain(input.destinationChainId);
  const amount = parseUnits(input.amount, 6);
  // Bounded: a handful of verified wallets, never an arbitrary list.
  const wallets = [...new Set(input.wallets.map(address))].slice(0, 3);
  if (!wallets.length) throw new Error('Connect a wallet to continue.');
  await Promise.all(wallets.map(wallet => ownedWallet(userId, wallet)));

  const pairs = wallets.flatMap(wallet => FUNDING_CHAINS.map(chainId => ({ wallet, chainId })));

  // What each chain's fee actually costs today, rather than what it cost when
  // the constant was written. This is what decides whether a small buy is
  // possible at all, so it is measured, not assumed.
  const reserves = new Map(await Promise.all(FUNDING_CHAINS.map(async id => [id, await liveFeeReserve(id, read)] as const)));

  // Balances next, for every wallet and chain at once. Nothing is quoted yet:
  // a funded destination makes every bridge quote wasted work.
  const funds = await Promise.all(pairs.map(async ({ wallet, chainId }) => {
    try {
      const raw = await rpc<string>(chainId, 'eth_call', [{ to: chain(chainId).usdc, data: balanceData(wallet) }, 'latest']);
      if (!/^0x[0-9a-f]*$/i.test(raw)) throw new Error('Invalid balance response.');
      return { wallet, chainId, balance: BigInt(raw || '0x0'), error: '' };
    } catch (error) { return { wallet, chainId, balance: 0n, error: error instanceof Error ? error.message : 'Balance unavailable' }; }
  }));

  const here = funds.find(f => f.chainId === input.destinationChainId && !f.error && f.balance >= BigInt(amount) + reserves.get(f.chainId)!);
  if (here) {
    return {
      chosen: { chainId: here.chainId, wallet: here.wallet, balance: here.balance.toString(), reserve: reserves.get(here.chainId)!.toString(), status: 'same_chain' },
      candidates: funds.map(f => ({ chainId: f.chainId, wallet: f.wallet, balance: f.balance.toString(), reserve: reserves.get(f.chainId)!.toString(), ...(f === here ? { status: 'same_chain' as const } : f.error ? { status: 'unavailable' as const, reason: f.error } : { status: 'insufficient' as const }) })),
    };
  }

  const candidates = await Promise.all(funds.map(async ({ wallet, chainId, balance, error }): Promise<RouteCandidate> => {
    const reserve = reserves.get(chainId)!;
    const at = { chainId, wallet, balance: balance.toString(), reserve: reserve.toString() };
    if (error) return { ...at, status: 'unavailable', reason: error };
    // The destination tops the fee up on the side, as `purchaseTotal` already
    // computes for the same-chain path; a source pays it out of the amount.
    if (chainId === input.destinationChainId || balance < BigInt(amount)) return { ...at, status: 'insufficient' };
    if (!CROSS_CHAIN_FUNDING) return { ...at, status: 'insufficient' };
    const send = bridgeInput(BigInt(amount), reserve);
    // A route that delivers less than a dollar is not a route.
    if (send <= 1_000_000n) return { ...at, status: 'fee_exceeds_amount' };
    try {
      const quote = await provider.quote({ chainId, destinationChainId: input.destinationChainId, wallet, tokenIn: chain(chainId).usdc, tokenOut, amount: send.toString(), slippageBps: 50 });
      return { ...at, status: 'available', input: send.toString(), outputAmount: quote.output.amount, gasFeeUSD: quote.gasFeeUsd, timeEstimateMs: quote.timeEstimateMs };
    } catch (e) { return { ...at, status: 'unavailable', reason: e instanceof Error ? e.message : 'Route unavailable' }; }
  }));

  const best = candidates.filter((c): c is RouteCandidate & { status: 'available'; gasFeeUSD?: string; timeEstimateMs?: number } => c.status === 'available')
    .sort((a, b) => Number(a.gasFeeUSD ?? Infinity) - Number(b.gasFeeUSD ?? Infinity)
      || (a.timeEstimateMs ?? Infinity) - (b.timeEstimateMs ?? Infinity)
      || a.chainId - b.chainId)[0];
  return { chosen: best ?? null, candidates };
}
