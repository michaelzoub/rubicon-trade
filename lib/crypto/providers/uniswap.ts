import "server-only";
import { ROUTERS, validatePermit } from "../permit";
import { address, NATIVE, swapRequest } from "../chains";
import { http, ProviderError, type Transport } from "../http";
import type { ExecutionProvider, SwapRequest, Transaction, PermitData } from "../types";
export function validateTransaction(tx: Transaction, request: SwapRequest): Transaction {
  if (!tx || tx.chainId !== request.chainId || address(tx.from) !== request.wallet || !/^0x(?:[a-fA-F0-9]{2})+$/.test(tx.data) || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(tx.value)) throw new Error("Invalid Uniswap transaction response.");
  if (address(tx.to) !== ROUTERS[request.chainId]) throw new Error("Unexpected Uniswap router on this chain.");
  return { chainId: tx.chainId, from: tx.from, to: tx.to, data: tx.data, value: tx.value };
}
export function createUniswap(request: Transport = http): ExecutionProvider {
  /** Uniswap asks integrations to declare where the decision came from, in
   * exactly two words: `autonomous` when the agent decided and nobody signed
   * off, `human_mediated` when a person did. This was pinned to
   * `human_mediated` for every call, which was true of the chat flow and untrue
   * of an unattended buy — the traffic the declaration exists for. */
  function post<T>(path: string, body: unknown, autonomous = false) {
    const key = process.env.UNISWAP_API_KEY; if (!key) throw new ProviderError("Uniswap", 503);
    return request<T>("Uniswap", `https://trade-api.gateway.uniswap.org/v1/${path}`, { body, headers: { "x-api-key": key, "x-universal-router-version": "2.0", "x-agent-info": JSON.stringify({ decision_origin: autonomous ? "autonomous" : "human_mediated", integration_name: "rubicon-trade" }) } });
  }
  return {
    async quote(input, options) {
      const r = swapRequest(input);
      const data = await post<{ routing: string; permitData?: PermitData; quote: Record<string, unknown> & { input: { token: string; amount: string }; output: { token: string; amount: string; recipient?: string }; swapper: string; chainId: number; slippage: number; tradeType: string } }>("quote", { type: "EXACT_INPUT", amount: r.amount, tokenInChainId: r.chainId, tokenOutChainId: r.chainId, tokenIn: r.tokenIn, tokenOut: r.tokenOut, swapper: r.wallet, recipient: r.wallet, slippageTolerance: r.slippageBps / 100, protocols: ["V2", "V3"], routingPreference: "BEST_PRICE", permitAmount: "EXACT" }, options?.autonomous === true);
      const q = data.quote;
      if (data.routing !== "CLASSIC" || q?.tradeType !== "EXACT_INPUT" || q?.slippage !== r.slippageBps / 100 || !q || q.chainId !== r.chainId || address(q.swapper) !== r.wallet || address(q.input?.token) !== r.tokenIn || q.input.amount !== r.amount || address(q.output?.token) !== r.tokenOut || (q.output.recipient && address(q.output.recipient) !== r.wallet) || !/^[1-9][0-9]{0,77}$/.test(q.output.amount)) throw new Error("Uniswap returned an unsupported or mismatched quote.");
      if (data.permitData) validatePermit(data.permitData, r);
      const minimumOutput = (BigInt(q.output.amount) * BigInt(10_000 - r.slippageBps) / BigInt(10_000)).toString();
      return { provider: "uniswap", request: r, outputAmount: q.output.amount, minimumOutput, raw: q, permitData: data.permitData ?? undefined, expiresAt: Date.now() + 60_000 };
    },
    async swap(quote, signature, options) {
      const batched = options?.batchedApprovals === true;
      if (!batched && quote.permitData && (!signature || !/^0x[0-9a-f]+$/i.test(signature))) throw new Error("Permit2 signature required for this quote.");
      if (quote.expiresAt <= Date.now()) throw new Error("Quote expired. Request a new quote.");
      // Batch approvals are simulated together by the caller; the gateway can
      // only simulate the standalone router call against existing allowances.
      const data = await post<{ swap: Transaction }>("swap", {
        quote: quote.raw,
        ...(!batched && quote.permitData ? { permitData: quote.permitData, signature } : {}),
        simulateTransaction: !batched, refreshGasPrice: true, deadline: Math.floor(quote.expiresAt / 1000),
      }, options?.autonomous === true);
      const tx = validateTransaction(data.swap, quote.request);
      const allowedValue = quote.request.tokenIn === NATIVE ? BigInt(quote.request.amount) : BigInt(0);
      if (BigInt(tx.value) !== allowedValue) throw new Error("Unexpected native token value in swap transaction.");
      return tx; },
  };
}
