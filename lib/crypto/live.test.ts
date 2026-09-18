import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extraNetworkFee } from "./network-fee";
import { erc20ApproveData, PERMIT2 } from "./aa";
import { validatePermit } from "./permit";
import { stepAction } from "./bridge-steps";
import { CATALOG_ENTRIES } from "./catalog";
import { liveFeeReserve } from "./fee-reserve";
import { CHAIN_IDS, feeCap } from "./chains";
import { rpc } from "./rpc";
import { createUniswapBridge } from "./providers/uniswap-bridge";

/** Hits the real Uniswap gateway and real RPC nodes. Off by default; run with
 * `LIVE=1 npx vitest run lib/crypto/live.test.ts` after touching the quote,
 * or routing code. Read-only: it verifies RPC and quotes, never signs or sends. */
const live = process.env.LIVE === "1";

// Every live block needs the same credentials, so this is loaded once for the
// file rather than inside one describe — otherwise running a single block by
// name leaves the others without an RPC.
beforeAll(() => {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
  }
});

describe.skipIf(!live)("live swap pipeline", () => {

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

/** The cross-network route, end to end short of signing. This is the check that
 * would have caught all of it: without `x-chained-actions-enabled` the quote
 * 404s, and without signature steps the route dead-ends at Permit2 having
 * already paid for an onchain approval. */
describe.runIf(live)("live cross-network route", () => {
  it("quotes, plans, and can execute every step without native gas", async () => {
    const wallet = `0x${"11".repeat(20)}`;
    const r = { chainId: 8453, destinationChainId: 42161, wallet, tokenIn: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", tokenOut: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", amount: "50000000", slippageBps: 50 };
    const plan = await createUniswapBridge().create(r);

    // Only the quote carries these, and every later plan read drops them.
    expect(plan.gasFeeUSD).toBeDefined();
    expect(plan.timeEstimateMs).toBeDefined();

    const kinds = plan.steps.map(step => {
      const action = stepAction(step, wallet);
      expect([r.chainId, r.destinationChainId]).toContain(action.chainId);
      return action.kind;
    });
    expect(kinds).not.toContain("transaction");
    expect(kinds).toContain("signature");
  }, 60000);
});

/** The catalog is the one place the app names an asset without the user typing
 * it, so a wrong address here is a Buy button pointing at the wrong token. Every
 * pin is held to the symbol it claims, read from the contract itself. */
describe.runIf(live)("live catalog", () => {
  it("resolves every pinned contract to the symbol it claims", async () => {
    const decode = (hex: string) => {
      const body = hex.slice(2);
      if (body.length === 64) return Buffer.from(body.replace(/0+$/, "").padEnd(2 * Math.ceil(body.replace(/0+$/, "").length / 2), "0"), "hex").toString("utf8").replace(/\0/g, "");
      return Buffer.from(body.slice(128, 128 + parseInt(body.slice(64, 128), 16) * 2), "hex").toString("utf8");
    };
    const pins = CATALOG_ENTRIES.flatMap(e => Object.entries(e.contracts).map(([chainId, address]) => ({ symbol: e.symbol, chainId: Number(chainId), address: address! })));
    const mismatched: string[] = [];
    for (const pin of pins) {
      // The configured RPCs are shared and rate limited; pace rather than burst.
      await new Promise(resolve => setTimeout(resolve, 400));
      const onchain = decode(await rpc<string>(pin.chainId, "eth_call", [{ to: pin.address, data: "0x95d89b41" }, "latest"]));
      if (onchain.toLowerCase() !== pin.symbol.toLowerCase()) mismatched.push(`${pin.symbol} on ${pin.chainId} is really "${onchain}" (${pin.address})`);
    }
    expect(mismatched, mismatched.join("; ")).toEqual([]);
  }, 120000);
});

/** The fee reserve decides whether a small purchase is possible at all, and a
 * hardcoded one silently stops matching the chain it claims to describe. This
 * is the check that catches a constant going stale. */
describe.runIf(live)("live fee reserve", () => {
  it("reserves what each chain charges now, not a number written once", async () => {
    for (const chainId of CHAIN_IDS) {
      const reserve = await liveFeeReserve(chainId);
      expect(reserve).toBeGreaterThan(0n);
      expect(reserve).toBeLessThanOrEqual(feeCap(chainId));
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    // The case from the field: a $2 buy funded from Ethereum, refused outright
    // while the reserve was a flat $16.
    expect(2_000_000n - await liveFeeReserve(1)).toBeGreaterThan(1_000_000n);
  }, 60000);
});
