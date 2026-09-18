import 'server-only';
import { encodeFunctionData, decodeFunctionResult, parseAbi } from 'viem';
import { address, chain, CHAIN_IDS, formatUnits, type ChainId } from './chains';
import { rpc } from './rpc';
import { indexedTokens } from './portfolio-index';
import { ownedWallet } from './wallet';
import { CATALOG_ENTRIES } from './catalog';
import type { HubState } from '@/lib/socialtrading/types';

/** Deployed at the same address on every chain here, verified by reading its
 * code on each. One call answers a whole chain's worth of balances, which is
 * what makes this affordable against public RPCs. */
export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';

const multicallAbi = parseAbi(['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])']);
const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export type Holding = {
  chainId: number; chainName: string; wallet: string; token: string;
  symbol: string; decimals: number; balance: string; display: string;
  /** What the contract actually is, when the catalog pinned it. `AAPLc` alone
   * asks the agent to guess that a trailing lowercase c means Apple, and asked
   * to "sell my aapl" it guesses wrong and reports an empty wallet. The scan
   * list was built from these entries, so the join costs nothing and is only
   * ever present for a contract this app pinned itself. */
  name?: string;
  /** For a tokenized stock, the ticker it tracks: `AAPL` behind `AAPLc`. */
  underlying?: string;
  /** USDC on a chain the app does not buy from is the classic "wrong network"
   * arrival, and worth naming as such rather than listing as a stray token. */
  kind: 'usdc' | 'token';
};

/** Which contracts to look for on a chain.
 *
 * There is no indexer behind these RPCs, so an exhaustive scan is not possible
 * and pretending otherwise would be worse than a bounded one. This covers what
 * actually goes wrong: USDC that landed on the wrong network, something bought
 * earlier, or anything in the catalog. Anything else is reachable by pasting its
 * contract address, which is the honest escape hatch. */
export function candidates(chainId: number, state?: HubState): string[] {
  const here = new Set<string>([chain(chainId).usdc]);
  for (const entry of CATALOG_ENTRIES) {
    const at = entry.contracts[chainId as ChainId];
    if (at) here.add(at.toLowerCase());
  }
  for (const trade of state?.trades ?? []) {
    const r = trade.crypto?.request;
    if (r && r.chainId === chainId) { here.add(r.tokenOut.toLowerCase()); here.add(r.tokenIn.toLowerCase()); }
    const b = trade.crypto?.bridge?.request;
    if (b?.destinationChainId === chainId) here.add(b.tokenOut.toLowerCase());
  }
  return [...here];
}

/** The catalog entry that pinned this contract, by address rather than by
 * symbol: the symbol comes off the chain and is untrusted, the address is what
 * `candidates` put in the scan list. */
function pinned(chainId: number, token: string) {
  const at = token.toLowerCase();
  return CATALOG_ENTRIES.find(entry => entry.contracts[chainId as ChainId]?.toLowerCase() === at);
}

async function readChain(chainId: number, wallet: string, tokens: string[]): Promise<Holding[]> {
  if (!tokens.length) return [];
  const calls = tokens.flatMap(token => [
    { target: token as `0x${string}`, allowFailure: true, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] }) },
    { target: token as `0x${string}`, allowFailure: true, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'symbol' }) },
    { target: token as `0x${string}`, allowFailure: true, callData: encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' }) },
  ]);
  const raw = await rpc<string>(chainId, 'eth_call', [{ to: MULTICALL3, data: encodeFunctionData({ abi: multicallAbi, functionName: 'aggregate3', args: [calls] }) }, 'latest']);
  const results = decodeFunctionResult({ abi: multicallAbi, functionName: 'aggregate3', data: raw as `0x${string}` }) as readonly { success: boolean; returnData: `0x${string}` }[];

  const held: Holding[] = [];
  for (const [i, token] of tokens.entries()) {
    const [bal, sym, dec] = [results[i * 3], results[i * 3 + 1], results[i * 3 + 2]];
    if (!bal?.success) continue;
    let balance: bigint, symbol: string, decimals: number;
    try {
      balance = decodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', data: bal.returnData }) as bigint;
      if (balance <= 0n) continue;
      symbol = sym?.success ? String(decodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', data: sym.returnData })).slice(0, 12) : 'Token';
      if (!dec?.success) continue;
      decimals = Number(decodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', data: dec.returnData }));
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue;
    } catch { continue; }
    const entry = pinned(chainId, token);
    held.push({
      chainId, chainName: chain(chainId).name, wallet, token,
      symbol, decimals, balance: balance.toString(), display: formatUnits(balance.toString(), decimals),
      ...(entry ? { name: entry.name, ...(entry.underlying ? { underlying: entry.underlying } : {}) } : {}),
      kind: token === chain(chainId).usdc ? 'usdc' : 'token',
    });
  }
  return held;
}

/** Everything of the user's that is sitting somewhere, across every supported
 * network. Read-only: it never moves anything and never asks a wallet to switch
 * networks. Sending is the user's own signature, from the client. */
export type HoldingsScan = { holdings: Holding[]; complete: boolean; warnings: string[]; fetchedAt: string };
export async function scanHoldings(userId: string, wallets: string[], state?: HubState, extra?: { chainId: number; token: string }[], networks: readonly ChainId[] = CHAIN_IDS): Promise<HoldingsScan> {
  const list = [...new Set(wallets.map(address))];
  await Promise.all(list.map(w => ownedWallet(userId, w)));
  const warnings = new Set<string>();
  const pairs = list.flatMap(wallet => networks.map(chainId => ({ wallet, chainId })));
  const results = await Promise.all(pairs.map(async ({ wallet, chainId }) => {
    let discovered: string[] = [];
    try {
      const index = await indexedTokens(chainId, wallet);
      discovered = index.tokens;
      if (!index.complete) warnings.add(`${chain(chainId).name}: showing known tokens; full discovery is unavailable or incomplete.`);
    } catch { warnings.add(`${chain(chainId).name}: token discovery is unavailable; showing known tokens.`); }
    const tokens = [...new Set([...candidates(chainId, state), ...discovered, ...(extra ?? []).filter(e => e.chainId === chainId).map(e => address(e.token))])];
    const held: Holding[] = [];
    for (let offset = 0; offset < tokens.length; offset += 40) {
      try { held.push(...await readChain(chainId, wallet, tokens.slice(offset, offset + 40))); }
      catch { warnings.add(`${chain(chainId).name}: some balances could not be checked.`); }
    }
    return held;
  }));
  return { holdings: results.flat().sort((a, b) => Number(b.kind === 'usdc') - Number(a.kind === 'usdc') || a.chainName.localeCompare(b.chainName) || a.symbol.localeCompare(b.symbol)), complete: !warnings.size, warnings: [...warnings], fetchedAt: new Date().toISOString() };
}

export async function findHoldings(userId: string, wallets: string[], state?: HubState, extra?: { chainId: number; token: string }[]): Promise<Holding[]> {
  return (await scanHoldings(userId, wallets, state, extra)).holdings;
}

/** Calldata for an ERC-20 transfer the user signs themselves. The server never
 * holds a key and never sends this; it only says what a correct transfer is. */
export function transferCall(token: string, to: string, amount: string) {
  const target = address(token), recipient = address(to);
  if (!/^[1-9][0-9]{0,77}$/.test(amount)) throw new Error('Enter an amount greater than zero.');
  if (recipient === '0x0000000000000000000000000000000000000000') throw new Error('That address would burn the tokens. Check it and try again.');
  return { to: target, value: '0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient as `0x${string}`, BigInt(amount)] }) };
}
