import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeAccountCalls, PERMIT2 } from "./aa";

/** Hits the real Uniswap gateway and real RPC nodes. Off by default; run with
 * `LIVE=1 npx vitest run lib/crypto/live.test.ts` after touching the quote,
 * batch, or routing code. Read-only: it quotes and builds, never signs. */
const live = process.env.LIVE === "1";

describe.skipIf(!live)("live swap pipeline", () => {
  beforeAll(() => {
    const file = path.join(process.cwd(), ".env");
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0 && !line.trim().startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
    }
  });

  it("quotes and builds a signable batch for a $25 USDC buy on Base", async () => {
    const { cryptoServices } = await import("./services");
    const { buildSwapBatch } = await import("./batch");
    const request = {
      chainId: 8453, wallet: "0x0000000000000000000000000000000000000001",
      tokenIn: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      tokenOut: "0x4200000000000000000000000000000000000006",
      amount: "25000000", slippageBps: 50,
    };
    const quote = await cryptoServices.execution.quote(request);
    expect(BigInt(quote.outputAmount)).toBeGreaterThan(0n);

    const swap = await cryptoServices.execution.swap(quote);
    const batch = await buildSwapBatch(request, swap);

    // A wallet that has never traded needs both Permit2 layers, then the swap.
    expect(batch.paymaster).toBe("circle-usdc");
    expect(batch.calls.at(-1)!.to).toBe(swap.to.toLowerCase());
    expect(batch.calls.some(c => c.to === PERMIT2)).toBe(true);
    expect(decodeAccountCalls(batch.callData)).toEqual(batch.calls);
    console.log(`routed ${batch.calls.length} calls -> ${swap.to}; min out ${quote.minimumOutput}`);
  }, 60_000);
});
