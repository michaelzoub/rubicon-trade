// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HubState } from "@/lib/socialtrading/types";
import { PREVIEW_ACCOUNT, PREVIEW_STATE, PREVIEW_TOKENS, PREVIEW_WALLET } from "../../preview/fixture";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: async () => "token", ready: true, authenticated: true, user: { id: "preview-user", linkedAccounts: [] }, connectWallet: vi.fn() }),
  useWallets: () => ({ ready: true, wallets: [{ address: PREVIEW_WALLET, walletClientType: "privy", switchChain: vi.fn(), getEthereumProvider: async () => ({ request: vi.fn() }) }] }),
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
const api = {
  searchTokens: async (_t: unknown, q: string) => ({ tokens: PREVIEW_TOKENS.filter(t => `${t.symbol} ${t.name}`.toLowerCase().includes(q.toLowerCase())) }),
  crypto: async (_t: unknown, _r: number, body: { action: string }) => body.action === "propose" ? { state: bought("reserved"), tradeId: "t9" } : { state: bought("confirmed") },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced ? query === "(prefers-reduced-motion: reduce)" : query === "(prefers-reduced-motion: no-preference)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); reduced = true; });
const setValue = async (input: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 350)); });

async function buyThenSettle() {
  await act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT} api={api}><BuyPanel /></HubProvider>));
  await setValue(container.querySelector("#buy-search") as HTMLInputElement, "bnvda");
  await tick();
  await act(async () => Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-buy-result")).find(b => b.textContent?.includes("BNVDA"))!.click());
  expect(container.querySelector("#buy-search")).toBeNull();
  expect(container.querySelector(".hub-buy-estimate")?.textContent).toContain("BNVDA at today’s price");
  await act(async () => { container.querySelector("form.hub-buy-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await tick();
  expect(container.querySelector(".hub-swap-result .hub-trade--crypto")).not.toBeNull();
  expect(container.querySelector(".hub-buy-done")).toBeNull();
  const decline = Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-swap-result button")).find(b => b.textContent === "Decline")!;
  await act(async () => decline.click());
  await tick();
}

it("celebrates in words when the buy settles onchain, and keeps the burst quiet under reduced motion", async () => {
  await buyThenSettle();
  const done = container.querySelector(".hub-buy-done")!;
  expect(done.textContent).toContain("It’s yours.");
  expect(done.textContent).toContain("$25.00 of BNVDA");
  expect(document.querySelector(".rubicon-celebration")).toBeNull();
  await act(async () => Array.from(done.querySelectorAll("button")).find(b => b.textContent === "Buy something else")!.click());
  expect(container.querySelector("#buy-search")).not.toBeNull();
});

it("bursts fifteen pieces of confetti from the trade card when motion is welcome", async () => {
  reduced = false;
  await buyThenSettle();
  const burst = document.querySelector(".rubicon-celebration");
  expect(burst).not.toBeNull();
  expect(burst!.querySelectorAll("span")).toHaveLength(15);
});
