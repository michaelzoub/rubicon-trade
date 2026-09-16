import "server-only";
import { address, NATIVE, swapRequest } from "../chains";
import { http, ProviderError, type Transport } from "../http";
import type { ExecutionProvider, SwapRequest, Transaction } from "../types";
export function validateTransaction(tx: Transaction, request: SwapRequest): Transaction {
  if (!tx || tx.chainId !== request.chainId || address(tx.from) !== request.wallet || !/^0x(?:[a-fA-F0-9]{2})+$/.test(tx.data) || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(tx.value)) throw new Error("Invalid Uniswap transaction response.");
  address(tx.to);
  return { chainId: tx.chainId, from: tx.from, to: tx.to, data: tx.data, value: tx.value };
}
export function createUniswap(request: Transport = http): ExecutionProvider {
  function post<T>(path: string, body: unknown) {
    const key = process.env.UNISWAP_API_KEY; if (!key) throw new ProviderError("Uniswap", 503);
    return request<T>("Uniswap", `https://trade-api.gateway.uniswap.org/v1/${path}`, { body, headers: { "x-api-key": key, "x-universal-router-version": "2.0", "x-agent-info": JSON.stringify({ decision_origin: "human_mediated", integration_name: "rubicon-trade" }) } });
  }
  return {
    async quote(input) {
      const r = swapRequest(input);
      const data = await post<{ routing: string; permitData?: unknown; quote: Record<string, unknown> & { input: { token: string; amount: string }; output: { token: string; amount: string; recipient?: string }; swapper: string; chainId: number; slippage: number; tradeType: string } }>("quote", { type: "EXACT_INPUT", amount: r.amount, tokenInChainId: r.chainId, tokenOutChainId: r.chainId, tokenIn: r.tokenIn, tokenOut: r.tokenOut, swapper: r.wallet, recipient: r.wallet, slippageTolerance: r.slippageBps / 100, protocols: ["V2", "V3"], routingPreference: "BEST_PRICE" });
      const q = data.quote;
      if (data.routing !== "CLASSIC" || q?.tradeType !== "EXACT_INPUT" || q?.slippage !== r.slippageBps / 100 || !q || q.chainId !== r.chainId || address(q.swapper) !== r.wallet || address(q.input?.token) !== r.tokenIn || q.input.amount !== r.amount || address(q.output?.token) !== r.tokenOut || (q.output.recipient && address(q.output.recipient) !== r.wallet) || !/^[1-9][0-9]{0,77}$/.test(q.output.amount)) throw new Error("Uniswap returned an unsupported or mismatched quote.");
      const minimumOutput = (BigInt(q.output.amount) * BigInt(10_000 - r.slippageBps) / BigInt(10_000)).toString();
      return { provider: "uniswap", request: r, outputAmount: q.output.amount, minimumOutput, raw: q, expiresAt: Date.now() + 60_000 };
    },
    async swap(quote) { if (quote.expiresAt <= Date.now()) throw new Error("Quote expired. Request a new quote."); const data = await post<{ swap: Transaction }>("swap", { quote: quote.raw, simulateTransaction: false, refreshGasPrice: true, deadline: Math.floor(quote.expiresAt / 1000) }); const tx = validateTransaction(data.swap, quote.request);
      const allowedValue = quote.request.tokenIn === NATIVE ? BigInt(quote.request.amount) : BigInt(0);
      if (BigInt(tx.value) !== allowedValue) throw new Error("Unexpected native token value in swap transaction.");
      return tx; },
  };
}
