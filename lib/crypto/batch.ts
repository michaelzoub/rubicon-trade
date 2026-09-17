import "server-only";
import { address, gaslessChain, NATIVE } from "./chains";
import { rpc } from "./rpc";
import { CIRCLE_PAYMASTER, encodeAccountCalls, erc20AllowanceData, erc20ApproveData, PERMIT2, permit2AllowanceData, permit2ApproveData } from "./aa";
import type { Call, SwapBatch, SwapRequest, Transaction } from "./types";

export { gaslessChain };

/** Permit2 allowances carry their own expiry. Long enough that a user can read the
 * card and sign, short enough that an abandoned approval lapses on its own. */
const PERMIT2_WINDOW = 1800;

const uint = (hex: string, slot = 0) => BigInt(`0x${hex.slice(2).slice(slot * 64, (slot + 1) * 64) || "0"}`);

/** Everything one signature authorizes, in execution order.
 *
 * Batching is the whole point: a fresh wallet has no Permit2 allowance, and
 * granting one used to mean a separate transaction the user had to pay gas for
 * and sign first. Inside a single user operation the approvals land immediately
 * before the swap that consumes them, so the user signs once and the allowance
 * never outlives the trade. */
export async function buildSwapBatch(request: SwapRequest, swap: Transaction, read: typeof rpc = rpc): Promise<SwapBatch> {
  const router = address(swap.to), wallet = request.wallet, amount = BigInt(request.amount);
  const calls: Call[] = [];

  if (request.tokenIn !== NATIVE) {
    const [erc20, permit2] = await Promise.all([
      read<string>(request.chainId, "eth_call", [{ to: request.tokenIn, data: erc20AllowanceData(wallet, PERMIT2) }, "latest"]),
      read<string>(request.chainId, "eth_call", [{ to: PERMIT2, data: permit2AllowanceData(wallet, request.tokenIn, router) }, "latest"]),
    ]);
    const current = uint(erc20);
    // Tokens like USDT revert on a non-zero-to-non-zero approval, so clear first.
    if (current < amount) {
      if (current > BigInt(0)) calls.push({ to: request.tokenIn, value: "0", data: erc20ApproveData(PERMIT2, BigInt(0)) });
      calls.push({ to: request.tokenIn, value: "0", data: erc20ApproveData(PERMIT2, amount) });
    }
    const expiration = Math.floor(Date.now() / 1000) + PERMIT2_WINDOW;
    if (uint(permit2, 0) < amount || uint(permit2, 1) <= BigInt(Math.floor(Date.now() / 1000)))
      calls.push({ to: PERMIT2, value: "0", data: permit2ApproveData(request.tokenIn, router, amount, expiration) });
  }

  calls.push({ to: router, value: BigInt(swap.value).toString(), data: swap.data });
  return { chainId: request.chainId, sender: wallet, calls, callData: encodeAccountCalls(calls), paymaster: gaslessChain(request.chainId) ? "circle-usdc" : null };
}

export const paymasterAddress = CIRCLE_PAYMASTER;
