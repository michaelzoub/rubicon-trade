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
const api = {
  market: async () => ({ assets: [] }),
  searchTokens: async (_t: unknown, q: string) => ({ tokens: PREVIEW_TOKENS.filter(t => `${t.symbol} ${t.name}`.toLowerCase().includes(q.toLowerCase())) }),
  crypto: async (_t: unknown, _r: number, body: { action: string }) =>
    body.action === "purchase_route" ? { route }
      : body.action === "propose" ? { state: bought("reserved"), tradeId: "t9" }
      : { state: bought("confirmed") },
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

async function buyThenSettle() {
  await act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT} api={api}><BuyPanel /></HubProvider>));
  await setValue(container.querySelector("#buy-search") as HTMLInputElement, "bnvda");
  await tick();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-buy-result")).find(b => b.textContent?.includes("BNVDA"))!.click());
  expect(container.querySelector("#buy-search")).toBeNull();
  expect(container.querySelector(".hub-buy-estimate")?.textContent).toContain("BNVDA at today’s price");
  await resolved();
  // The network, the wallet and the fee are one sentence, not four controls.
  expect(container.querySelector(".hub-buy-form")!.textContent).toContain("Paying with USDC on Base");
  expect(container.querySelector("select")).toBeNull();
  await act(async () => { container.querySelector("form.hub-buy-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await tick();
  expect(container.querySelector(".hub-swap-result .hub-trade--crypto")).not.toBeNull();
  expect(container.querySelector(".hub-buy-done")).toBeNull();
  const decline = Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-swap-result button")).find(b => b.textContent === "Decline")!;
  await act(async () => decline.click());
  await tick();
}

it("shows a purchase you placed without restating it or the agent's limits", async () => {
  await act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT} api={api}><BuyPanel /></HubProvider>));
  await setValue(container.querySelector("#buy-search") as HTMLInputElement, "bnvda");
  await tick();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-buy-result")).find(b => b.textContent?.includes("BNVDA"))!.click());
  await resolved();
  await act(async () => { container.querySelector("form.hub-buy-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await tick();
  const card = container.querySelector(".hub-swap-result .hub-trade--crypto")!;

  // The line above already says what this is, and the agent's limits are not a
  // fact about a trade the person placed themselves.
  expect(card.textContent).not.toContain("Your agent’s mode and limits");
  expect(card.querySelector(".hub-trade-reasoning")).toBeNull();
  // The status belongs in one place, not beside itself.
  expect(card.textContent!.match(/Ready to sign/g) ?? []).toHaveLength(1);
  // The guarantee that matters before signing survives.
  expect(card.querySelector(".purchase-readiness")!.textContent).toContain("At least");
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
