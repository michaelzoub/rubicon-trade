// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HubState } from "@/lib/socialtrading/types";
import { PREVIEW_ACCOUNT, PREVIEW_STATE, PREVIEW_TOKENS, PREVIEW_WALLET } from "../../preview/fixture";

vi.mock("@privy-io/react-auth", () => ({
  useSign7702Authorization: () => ({ signAuthorization: vi.fn(async () => ({ r: "0x1", s: "0x2", yParity: 0, address: "0x0", chainId: 8453, nonce: 0 })) }),
  usePrivy: () => ({ getAccessToken: async () => "token", ready: true, authenticated: true, user: { id: "preview-user", linkedAccounts: [] }, connectWallet: vi.fn() }),
  useWallets: () => ({ ready: true, wallets: [{ address: PREVIEW_WALLET, walletClientType: "privy", switchChain: vi.fn(), getEthereumProvider: async () => ({ request: vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x2105" : method === "eth_accounts" ? [PREVIEW_WALLET] : method === "eth_call" ? "0x3b9aca00" : "0x0") }) }] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/trade" }));
/** The wallet's half of the purchase: one signature, one user operation. Real
 * signing needs a bundler and a paymaster; what this asserts is the shape of
 * the flow around it. */
const chainMock = vi.hoisted(() => ({
  sendSwapBatch: vi.fn(async ({ onSubmitted }: { onSubmitted?: (op: string) => void }) => {
    onSubmitted?.(`0x${"ef".repeat(32)}`);
    return { hash: `0x${"cd".repeat(32)}`, userOpHash: `0x${"ef".repeat(32)}` };
  }),
}));
vi.mock("@/lib/crypto/gasless", () => ({ sendSwapBatch: chainMock.sendSwapBatch, recoverSwapOperation: vi.fn(async () => null) }));
import { HubProvider } from "./hub-provider";
import { BuyPanel } from "./buy-panel";

let container: HTMLDivElement, root: Root;
let reduced = true;
/** A user buy that the mock settles onchain the moment the person declines: enough to exercise the celebration path. */
const bought = (status: HubState["trades"][number]["status"]): HubState => {
  const swap = { ...structuredClone(PREVIEW_STATE.trades[1]), id: "t9", initiator: "user" as const, status, value: 25, asset: { id: "8453:0x8a8e", symbol: "BNVDA", name: "Backed NVIDIA", kind: "crypto" as const } };
  if (status === "confirmed") swap.crypto = { ...swap.crypto!, phase: "complete", hash: `0x${"cd".repeat(32)}` };
  return { ...structuredClone(PREVIEW_STATE), revision: 20, trades: [...PREVIEW_STATE.trades, swap] };
};
/** The server resolves where the money is; the panel only renders the answer. */
const seat = { chainId: 8453, wallet: PREVIEW_WALLET, balance: "500000000", reserve: "20000", status: "same_chain" as const };
const route = { chosen: seat, candidates: [seat] };
/** The same wallet, holding $7.30 — too little for any of the old fixed amounts. */
const thin = { ...seat, balance: "7300000", status: "insufficient" as const };
const batch = { chainId: 8453, sender: PREVIEW_WALLET, calls: [], callData: "0x", paymaster: "circle-usdc" };
/** The server, answering each step of one purchase in order. */
const api = {
  market: async () => ({ assets: [] }),
  searchTokens: async (_t: unknown, q: string) => ({ tokens: PREVIEW_TOKENS.filter(t => `${t.symbol} ${t.name}`.toLowerCase().includes(q.toLowerCase())) }),
  crypto: async (_t: unknown, _r: number, body: { action: string }) => {
    switch (body.action) {
      case "purchase_route": return { route };
      case "propose": return { state: bought("reserved"), tradeId: "t9" };
      case "prepare": return { state: bought("reserved"), quoteId: "q1", step: "swap", expiresAt: Date.now() + 120_000 };
      case "authorize": return { state: bought("reserved"), batch, step: "swap", expiresAt: Date.now() + 120_000 };
      case "submitted": return { state: bought("unknown") };
      default: return { state: bought("confirmed") };
    }
  },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced ? query === "(prefers-reduced-motion: reduce)" : query === "(prefers-reduced-motion: no-preference)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); reduced = true; });
const setValue = async (input: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 350)); });
/** Long enough for the debounced route resolution to land. */
const resolved = () => act(async () => { await new Promise(r => setTimeout(r, 700)); });

it.each(["nvidia", "NVDA", "NVDAc"])("finds the recommended NVIDIA instrument for %s when discovery is empty", async query => {
  const searchTokens = vi.fn(async () => ({ tokens: [] }));
  const crypto = vi.fn(api.crypto);
  await act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT} api={{ ...api, searchTokens, crypto }}><BuyPanel initialQuery={query} /></HubProvider>));
  await tick();
  expect(searchTokens).toHaveBeenCalled();
  const results = container.querySelectorAll<HTMLButtonElement>(".hub-buy-result");
  expect(results).toHaveLength(1);
  expect(results[0].textContent).toContain("NVIDIA");
  expect(container.textContent).not.toContain("Nothing found");
  await act(async () => results[0].click());
  await resolved();
  expect(crypto).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
    action: "purchase_route", destinationChainId: 8453, tokenOut: "0xb20000000000000000000078ee7ce2fe4908108c",
  }), expect.anything());
});

async function buyThenSettle(over: Partial<typeof api> = {}) {
  await act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT} api={{ ...api, ...over }}><BuyPanel /></HubProvider>));
  await setValue(container.querySelector("#buy-search") as HTMLInputElement, "bnvda");
  await tick();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-buy-result")).find(b => b.textContent?.includes("BNVDA"))!.click());
  expect(container.querySelector("#buy-search")).toBeNull();
  expect(container.querySelector(".hub-buy-estimate")?.textContent).toContain("BNVDA at today’s price");
  await resolved();
  // A purchase that works explains nothing: no network, no wallet, no fee
  // sentence, no "where your money is" — and still no controls to resolve.
  const form = container.querySelector(".hub-buy-form")!;
  expect(form.textContent).not.toContain("Paying with USDC on Base");
  expect(form.textContent).not.toContain("Where your money is");
  expect(form.textContent).not.toContain("not brokerage shares");
  expect(form.querySelector(".hub-notice")).toBeNull();
  expect(container.querySelector("select")).toBeNull();
  await act(async () => { container.querySelector("form.hub-buy-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await tick();
  await tick();
}

async function chooseBNVDA(over: Partial<typeof api> = {}) {
  await act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT} api={{ ...api, ...over }}><BuyPanel /></HubProvider>));
  await setValue(container.querySelector("#buy-search") as HTMLInputElement, "bnvda");
  await tick();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-buy-result")).find(b => b.textContent?.includes("BNVDA"))!.click());
  await resolved();
}
const chips = () => Array.from(container.querySelectorAll(".hub-buy-presets button")).map(b => b.textContent);

it("says what you hold, and offers amounts that fit inside it", async () => {
  await chooseBNVDA();
  expect(container.querySelector(".hub-buy-balance")?.textContent).toBe("$500.00 available");
  // Round numbers that fit, then all of it, less the fee the network takes
  // out of the same USDC.
  expect(chips()).toEqual(["$50", "$100", "$250", "$499.50"]);
});

it("re-scales the amounts to a small balance instead of offering refusals", async () => {
  await chooseBNVDA({ crypto: async (_t: unknown, _r: number, body: { action: string }) => body.action === "purchase_route" ? { route: { chosen: null, candidates: [thin] } } : api.crypto(_t, _r, body) });
  expect(container.querySelector(".hub-buy-balance")?.textContent).toBe("$7.30 available");
  expect(chips()).toEqual(["$1.70", "$3.40", "$6.80"]);
  // The opening $50 was never buyable here, so it never stays on screen.
  expect((container.querySelector("#buy-amount") as HTMLInputElement).value).toBe("6.80");
});

it("settles in one press, with nothing to confirm in between", async () => {
  await buyThenSettle();
  // The whole purchase — quote, approvals, signature, submission — happened on
  // the press. Anything asking the buyer to do it again is the bug this guards.
  expect(chainMock.sendSwapBatch).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Confirm purchase");
  expect(container.textContent).not.toContain("One last step");
  expect(container.querySelector(".hub-swap-result")).toBeNull();
  expect(container.querySelector(".hub-buy-done")?.textContent).toContain("It’s yours.");
}, 20000);

it("hands the purchase back to its own card when the wallet cannot finish it", async () => {
  chainMock.sendSwapBatch.mockRejectedValueOnce(new Error("User rejected the request."));
  await buyThenSettle();
  expect(container.querySelector(".hub-buy-done")).toBeNull();
  // Everything that can recover a half-sent purchase lives on that card.
  expect(container.querySelector(".hub-swap-result .hub-trade--crypto")).not.toBeNull();
  expect(container.querySelector(".hub-error")?.textContent).toContain("Wallet request declined");
}, 20000);

it("celebrates in words when the buy settles onchain, and keeps the burst quiet under reduced motion", async () => {
  await buyThenSettle();
  const done = container.querySelector(".hub-buy-done")!;
  expect(done.textContent).toContain("It’s yours.");
  expect(done.textContent).toContain("$25.00 of BNVDA");
  expect(document.querySelector(".rubicon-celebration")).toBeNull();
  await act(async () => Array.from(done.querySelectorAll("button")).find(b => b.textContent === "Buy something else")!.click());
  expect(container.querySelector("#buy-search")).not.toBeNull();
}, 20000);

it("bursts fifteen pieces of confetti from the trade card when motion is welcome", async () => {
  reduced = false;
  await buyThenSettle();
  const burst = document.querySelector(".rubicon-celebration");
  expect(burst).not.toBeNull();
  expect(burst!.querySelectorAll("span")).toHaveLength(15);
}, 20000);
