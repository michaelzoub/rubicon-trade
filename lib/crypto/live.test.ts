import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extraNetworkFee } from "./network-fee";
import { erc20ApproveData, PERMIT2 } from "./aa";
import { validatePermit } from "./permit";

/** Hits the real Uniswap gateway and real RPC nodes. Off by default; run with
 * `LIVE=1 npx vitest run lib/crypto/live.test.ts` after touching the quote,
 * or routing code. Read-only: it verifies RPC and quotes, never signs or sends. */
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

  it("verifies Base RPC, onchain decimals, and a real Uniswap USDC quote", async () => {
    const { cryptoServices } = await import("./services");
    const { tokenDecimals } = await import("./preflight");
    const { rpc } = await import("./rpc");
    const request = {
      chainId: 8453, wallet: "0x0000000000000000000000000000000000000001",
      tokenIn: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      tokenOut: "0x4200000000000000000000000000000000000006",
      amount: "25000000", slippageBps: 50,
    };
    const quote = await cryptoServices.execution.quote(request);
    expect(BigInt(quote.outputAmount)).toBeGreaterThan(0n);

    expect(BigInt(await rpc<string>(8453, "eth_chainId", []))).toBe(8453n);
    expect(await tokenDecimals(8453, request.tokenIn)).toBe(6);
    expect(await tokenDecimals(8453, request.tokenOut)).toBe(18);
    const extra = await extraNetworkFee({ chainId: 8453, from: request.wallet, to: request.tokenIn, data: erc20ApproveData(PERMIT2, BigInt(request.amount)), value: "0" }, 100000n, (method, params) => rpc(8453, method, params));
    expect(extra).toBeGreaterThanOrEqual(0n);
    if (quote.permitData) {
      validatePermit(quote.permitData, request);
      await expect(cryptoServices.execution.swap(quote)).rejects.toThrow(/signature required/);
    }
  }, 60_000);
});
