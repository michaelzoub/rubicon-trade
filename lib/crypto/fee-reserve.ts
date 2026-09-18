import 'server-only';
import { chain, feeCap, NATIVE } from './chains';
import { rpc } from './rpc';
import { cryptoServices } from './services';

/** Gas one sponsored step consumes, rounded generously upward. A 4337 operation
 * wrapping an approval and a swap lands well under this. */
export const OP_GAS = 450_000n;
/** Circle's markup, plus room for gas to move between the quote and the
 * signature. Unspent allowance is refunded, so erring high costs nothing except
 * the size of the smallest possible purchase. */
export const SAFETY = 4;
/** Never reserve less than two cents: a chain can spike between quote and signing. */
export const FLOOR = 20_000n;

export type ReserveReader = {
  gasPrice: (chainId: number) => Promise<bigint>;
  nativeUsd: (chainId: number) => Promise<number>;
};

export const liveReader: ReserveReader = {
  async gasPrice(chainId) {
    const raw = await rpc<string>(chainId, 'eth_gasPrice', []);
    if (!/^0x[0-9a-f]+$/i.test(raw)) throw new Error('Gas price unavailable.');
    return BigInt(raw);
  },
  async nativeUsd(chainId) {
    chain(chainId);
    const { price } = await cryptoServices.defi.price({ chainId, address: NATIVE });
    if (!Number.isFinite(price) || price <= 0) throw new Error('Native price unavailable.');
    return price;
  },
};

/** What the network fee on this chain actually costs right now, in USDC base units.
 *
 * The app used to hardcode this: $8 on Ethereum, cents on the rollups. Those
 * numbers were written when mainnet gas was tens of gwei, and they long outlived
 * the conditions that justified them — at 0.05 gwei a sponsored step costs about
 * six cents, so an $8 reserve refuses a $10 purchase that would have worked
 * fine. Reserving what the chain is charging today, rather than what it charged
 * once, is the difference between a small buy being possible and being refused.
 *
 * Clamped both ways: never below `FLOOR`, never above the old static cap, which
 * stays as the ceiling because the Permit2 allowance is signed against it. A
 * pricing failure falls back to that cap, because refusing a small purchase is
 * survivable and a reverted one is not. */
export async function liveFeeReserve(chainId: number, read: ReserveReader = liveReader): Promise<bigint> {
  const cap = feeCap(chainId);
  try {
    const [gasPrice, nativeUsd] = await Promise.all([read.gasPrice(chainId), read.nativeUsd(chainId)]);
    const nativeWei = OP_GAS * gasPrice;
    // USDC has six decimals; native has eighteen.
    const usdc = BigInt(Math.ceil((Number(nativeWei) / 1e18) * nativeUsd * SAFETY * 1e6));
    return usdc < FLOOR ? FLOOR : usdc > cap ? cap : usdc;
  } catch { return cap; }
}

/** The same figure for display, in dollars. */
export const reserveUsd = (reserve: bigint) => Number(reserve) / 1e6;
