// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatEvent, HubState } from "@/lib/socialtrading/types";
import { PREVIEW_ACCOUNT, PREVIEW_ASSETS, PREVIEW_CHAT, PREVIEW_STATE, PREVIEW_TOKENS, PREVIEW_WALLET } from "../../preview/fixture";
import { newChat } from "@/lib/socialtrading/chats";

const events = vi.hoisted(() => ({ script: [] as ChatEvent[], posted: [] as unknown[] }));
const privy = vi.hoisted(() => ({ sendTransaction: vi.fn(), linkWallet: vi.fn(), connectWallet: vi.fn(), createWallet: vi.fn(), switchChain: vi.fn(), logout: vi.fn() }));
// Signing is exercised against viem in lib/crypto/aa.test.ts; here we only care
// that the card hands the bundler exactly the batch the server authorized.
const gasless = vi.hoisted(() => ({ sendSwapBatch: vi.fn() }));
/** Which shape the server authorizes for the next prepare: a sponsored batch or
 * a transaction the wallet funds itself. */
const authorized = vi.hoisted(() => ({ sponsored: false }));
vi.mock("@/lib/crypto/gasless", () => ({ sendSwapBatch: gasless.sendSwapBatch }));
const BATCH = { chainId: 8453, sender: "0x1111111111111111111111111111111111111111", paymaster: "circle-usdc",
  calls: [{ to: "0x2222222222222222222222222222222222222222", value: "0", data: "0xabcdef" }], callData: "0xb61d27f6" };
vi.mock("@privy-io/react-auth", () => ({
  useSign7702Authorization: () => ({ signAuthorization: vi.fn(async () => ({ r: "0x1", s: "0x2", yParity: 0, address: "0x0", chainId: 8453, nonce: 0 })) }),
  usePrivy: () => ({ getAccessToken: async () => "token", ready: true, authenticated: true, user: { id: "preview-user", linkedAccounts: [{ type: "wallet", chainType: "ethereum", address: "0x1111111111111111111111111111111111111111", walletClientType: "privy" }] }, linkWallet: privy.linkWallet, connectWallet: privy.connectWallet, createWallet: privy.createWallet, logout: privy.logout }),
  useWallets: () => ({ ready: true, wallets: [{ address: "0x1111111111111111111111111111111111111111", walletClientType: "privy", switchChain: privy.switchChain, getEthereumProvider: async () => ({ request: privy.sendTransaction }) }] }),
  useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn(), state: { status: "initial" } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("../../providers", () => ({ usePrivyConfigured: () => true }));
vi.mock("./client", async importOriginal => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    hubApi: {
      load: async () => ({ state: PREVIEW_STATE }), post: async (_t: unknown, _r: number, body: unknown) => { events.posted.push(body); return { state: PREVIEW_STATE }; }, market: async () => ({ assets: [] }),
      wallets: async () => ({ wallets: [PREVIEW_WALLET] }),
      searchTokens: async (_t: unknown, q: string) => ({ tokens: PREVIEW_TOKENS.filter(t => t.symbol.toLowerCase().includes(q.toLowerCase())) }),
      crypto: async (_t: unknown, _r: number, body: Record<string, unknown>) => {
        events.posted.push(body);
        if (body.action === "prepare") return authorized.sponsored
          ? { state: { ...PREVIEW_STATE, revision: 13 }, batch: BATCH, step: "swap", expiresAt: Date.now() + 60_000 }
          : { state: { ...PREVIEW_STATE, revision: 13 }, transaction: { chainId: 8453, from: BATCH.sender, ...BATCH.calls[0] }, step: "swap", expiresAt: Date.now() + 60_000 };
        if (body.action === "propose") return { state: { ...PREVIEW_STATE, revision: 14 }, tradeId: "t2" };
        return { state: { ...PREVIEW_STATE, revision: 15 } };
      },
    },
    streamChat: async (_token: unknown, _body: unknown, onEvent: (e: ChatEvent) => void) => { for (const e of events.script) { onEvent(e); await Promise.resolve(); } },
  };
});
import { Hub } from "./hub-shell";
import { HubProvider } from "./hub-provider";
import { HomeView } from "./home-view";
import { knowledgeOf } from "@/lib/socialtrading/knowledge";
import { identityDepth, identityStats } from "@/lib/socialtrading/identity";
import { identityPalette } from "@/lib/socialtrading/identity-palette";
import { GLOSS_ID } from "./gloss";
import { TradeView } from "./trade-view";
import { AssetGrid } from "./parts";
import { ProfileView } from "./profile-view";
import { ActivityView } from "./activity-view";
import type { AccountSummary } from "@/lib/socialtrading/plans";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  privy.sendTransaction.mockImplementation(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x2105" : method === "eth_accounts" ? [PREVIEW_WALLET] : method === "eth_call" ? "0x3b9aca00" : "0x0");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  events.script = []; events.posted = [];
  // The account card teaches itself once per person; tests that are not about
  // that moment start on the far side of it.
  localStorage.setItem("rubicon:account-discovered:v1", "1");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(state: HubState, view: React.ReactNode = <HomeView />, account: AccountSummary | null = null) {
  await act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={state} initialAccount={account}><Hub>{view}</Hub></HubProvider>));
}
const setValue = async (input: HTMLInputElement | HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
});
async function type(value: string) {
  const input = container.querySelector("textarea") as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("carries navigation inside the one header band, with the conversation and persistent agent orb", async () => {
  await render(PREVIEW_STATE);
  expect(Array.from(container.querySelectorAll(".hub-nav-link")).map(a => a.textContent)).toEqual(["Home", "Explore", "Memory"]);
  // The tab bar rides in the header rather than forming a second sticky band.
  expect(container.querySelector(".site-header .hub-nav")).not.toBeNull();
  expect(container.querySelectorAll(".hub-row").length).toBe(PREVIEW_STATE.chats[0].messages.length);
  expect(container.textContent).toContain("Michael’s agent");
  expect(container.querySelector(".hub-trade")?.textContent).toContain("Approve");
  expect(container.querySelector(".hub-layout > .socialtrading-profile")).toBeNull();
  const presence = container.querySelector<HTMLButtonElement>(".ambient-orb")!;
  expect(container.querySelector(".hub-stage .ambient-agent")).toBeNull();
  expect(presence.getAttribute("aria-expanded")).toBe("false");
  await act(async () => presence.click());
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Ask your agent");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(presence);
});

it("keeps Home to the conversation and keeps every stock and crypto order in Memory's record", async () => {
  await render(PREVIEW_STATE);
  expect(container.querySelector(".mem-field")).toBeNull();
  await render(PREVIEW_STATE, <ActivityView />);

  // Memory is a field of beliefs, not a chart of orders.
  expect(container.querySelector(".hub-trade-chart")).toBeNull();
  expect(container.querySelector(".mem-field")).not.toBeNull();

  // Every order is still reachable, in the complete record underneath.
  const entries = Array.from(container.querySelectorAll<HTMLElement>(".mem-record li"));
  const text = entries.map(node => node.textContent ?? "").join(" ");
  expect(text).toContain("OKLO");
  expect(text).toContain("WETH");
  expect(entries.filter(node => node.querySelector("a"))).toHaveLength(PREVIEW_STATE.trades.length);
});

it("streams a reply with rich parts and animates the profile card from the persisted state", async () => {
  const fresh: HubState = { ...PREVIEW_STATE, chats: [newChat("2026-09-14T21:00:00.000Z", PREVIEW_CHAT)], preferences: [] };
  const persisted: HubState = { ...fresh, revision: 13, preferences: ["nuclear"], chats: [{ ...fresh.chats[0], title: "I’m becoming more interested in nuclear", messages: [
    { id: "u1", role: "user", at: "2026-09-14T22:00:00Z", parts: [{ type: "text", text: "I’m becoming more interested in nuclear" }] },
    { id: "a1", role: "assistant", at: "2026-09-14T22:00:01Z", status: "done", parts: [{ type: "text", text: "Noted." }, { type: "profile_update", changes: [{ field: "preferences", label: "Things you care about", after: "nuclear" }] }] },
  ] }] };
  events.script = [
    { type: "message", id: "a1", at: "2026-09-14T22:00:01Z" }, { type: "status", text: "Updating your profile" }, { type: "text", text: "Noted." },
    { type: "part", part: { type: "profile_update", changes: [{ field: "preferences", label: "Things you care about", after: "nuclear" }] } },
    { type: "state", state: persisted }, { type: "done" },
  ];
  await render(fresh);
  expect(container.textContent).toContain("what’s on your mind?");
  await type("I’m becoming more interested in nuclear");
  await act(async () => { container.querySelector("form.hub-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  const rows = container.querySelectorAll(".hub-row");
  expect(rows.length).toBe(2);
  expect(rows[0].textContent).toContain("interested in nuclear");
  expect(rows[1].querySelector(".hub-update")?.textContent).toContain("nuclear");
  expect(container.querySelector(".hub-row.is-streaming")).toBeNull();
});

it("records learning signals when the user acts on an asset card", async () => {
  await render(PREVIEW_STATE);
  const card = container.querySelector<HTMLElement>('.hub-quiet-card[data-asset="OKLO"]')!;
  expect(card.querySelector("button")).toBeNull();
  const open = card.querySelector<HTMLAnchorElement>("a")!;
  expect(open.getAttribute("href")).toBe("/explore/stock/OKLO");
  await act(async () => open.click());
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "signal", signal: "opened", target: "OKLO", themes: ["energy"] }));
  const approve = Array.from(container.querySelectorAll(".hub-trade button")).find(b => b.textContent === "Approve")!;
  await act(async () => approve.click());
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "trade", tradeId: "t1", decision: "approved" }));
});

it("adds the Rubicon-blue priority treatment only to high-importance cards", async () => {
  await render(PREVIEW_STATE, <AssetGrid assets={[PREVIEW_ASSETS.VRT, PREVIEW_ASSETS.OKLO]} />);
  expect(container.querySelector('[data-asset="VRT"]')?.classList.contains("hub-priority-card")).toBe(true);
  expect(container.querySelector('[data-asset="OKLO"]')?.classList.contains("hub-priority-card")).toBe(false);
});

it("sends a sponsored batch to the bundler instead of asking the wallet for gas", async () => {
  authorized.sponsored = true;
  privy.sendTransaction.mockImplementation(async ({ method }: { method: string }) =>
    method === "eth_chainId" ? "0x2105" : method === "eth_accounts" ? [BATCH.sender] : method === "eth_call" ? `0x${"3b9aca00".padStart(64, "0")}` : "0x0"); // USDC, and no ETH at all
  gasless.sendSwapBatch.mockResolvedValue({ userOpHash: `0x${"cd".repeat(32)}`, hash: `0x${"ab".repeat(32)}` });
  await render(PREVIEW_STATE);
  const card = Array.from(container.querySelectorAll(".hub-trade--crypto")).at(-1)!;
  expect(card.textContent).toContain("network fee paid in USDC");
  const sign = Array.from(card.querySelectorAll("button")).find(b => b.textContent === "Review & sign in wallet")!;
  await act(async () => sign.click());
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  // The batch the server authorized, byte for byte, and nothing the wallet pays for.
  expect(gasless.sendSwapBatch).toHaveBeenCalledWith(expect.objectContaining({ batch: BATCH }));
  expect(privy.sendTransaction).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
  // Both references are recorded: the operation identifies it inside the bundler's transaction.
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "submitted", tradeId: "t2", hash: `0x${"ab".repeat(32)}`, userOpHash: `0x${"cd".repeat(32)}` }));
  authorized.sponsored = false;
});

it("shows an onchain swap in human units and walks prepare → sign → submitted → status", async () => {
  privy.sendTransaction.mockImplementation(async ({ method }) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_accounts") return [BATCH.sender];
    if (method === "eth_call") return `0x${"3b9aca00".padStart(64, "0")}`;
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "eth_gasPrice") return "0x1";
    if (method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
    return "0xde0b6b3a7640000";
  });
  gasless.sendSwapBatch.mockResolvedValue({ userOpHash: `0x${"cd".repeat(32)}`, hash: `0x${"ab".repeat(32)}` });
  await render(PREVIEW_STATE);
  const card = Array.from(container.querySelectorAll(".hub-trade--crypto")).at(-1)!;
  expect(card.textContent).toContain("Swap · Uniswap on Base");
  expect(card.textContent).toContain("25 USDC");
  expect(card.textContent).toContain("0.006069 WETH");
  expect(card.textContent).toContain("Proposed by");
  expect(card.textContent).toContain("Waiting for your signature");
  expect(card.textContent).not.toContain("25000000");
  const sign = Array.from(card.querySelectorAll("button")).find(b => b.textContent === "Review & sign in wallet")!;
  await act(async () => sign.click());
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect(privy.switchChain).not.toHaveBeenCalled();
  expect(privy.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
  const actions = events.posted.filter((p): p is { action: string } => typeof (p as { action?: unknown }).action === "string").map(p => p.action);
  expect(actions).toEqual(["prepare", "submitted", "status"]);
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "submitted", tradeId: "t2", hash: `0x${"ab".repeat(32)}` }));
});

it("explains that a small mainnet buy is blocked by the fee, not by the price", async () => {
  // The exact case from the field: plenty of USDC for the purchase, nowhere near
  // enough for Ethereum gas, and the panel used to quote Base's fee at them.
  privy.sendTransaction.mockImplementation(async ({ method }: { method: string }) =>
    method === "eth_chainId" ? "0x1" : method === "eth_accounts" ? [PREVIEW_WALLET] : method === "eth_call" ? `0x${(3340000).toString(16)}` : "0x0"); // 3.34 USDC, no ETH
  await render(PREVIEW_STATE, <TradeView />);
  await setValue(container.querySelector("#buy-search") as HTMLInputElement, "pepe");
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
  await act(async () => (Array.from(container.querySelectorAll(".hub-buy-result")).find(b => b.textContent?.includes("PEPE")) as HTMLElement).click());
  await setValue(container.querySelector("#buy-amount") as HTMLInputElement, "0.2");
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  // The fee quoted is Ethereum's, never the default chain's.
  expect(container.textContent).toContain("up to $16");
  expect(container.textContent).not.toContain("$0.5 is held back");
  expect(container.textContent).toContain("the network fee on Ethereum is up to $16");
  // And it points somewhere the same money would actually work.
  expect(container.textContent).toMatch(/on (Base|Arbitrum|Optimism|Polygon) costs about \$/);
  expect((container.querySelector(".hub-buy-submit") as HTMLButtonElement).disabled).toBe(true);
});

it("tells the buyer what is missing instead of letting a short balance reach the wallet", async () => {
  privy.sendTransaction.mockImplementation(async ({ method }: { method: string }) =>
    method === "eth_chainId" ? "0x2105" : method === "eth_accounts" ? [PREVIEW_WALLET] : method === "eth_call" ? "0x2faf080" : "0x0"); // 50 USDC, no ETH
  await render(PREVIEW_STATE, <TradeView />);
  await setValue(container.querySelector("#buy-search") as HTMLInputElement, "bnvda");
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
  await act(async () => (Array.from(container.querySelectorAll(".hub-buy-result")).find(b => b.textContent?.includes("BNVDA")) as HTMLElement).click());
  await setValue(container.querySelector("#buy-amount") as HTMLInputElement, "100");
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect(container.textContent).toContain("You have 50.00 USDC");
  expect((container.querySelector(".hub-buy-submit") as HTMLButtonElement).disabled).toBe(true);
  // Having no ETH is no longer a reason to stop: the fee comes out of USDC.
  await setValue(container.querySelector("#buy-amount") as HTMLInputElement, "25");
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect((container.querySelector(".hub-buy-submit") as HTMLButtonElement).disabled).toBe(false);
});

it("lets the user buy a tokenized stock with dollars from the Trade page", async () => {
  await render(PREVIEW_STATE, <TradeView />);
  expect(container.textContent).toContain("A little of what you believe in.");
  expect(container.textContent).toContain("0x1111…1111");
  await setValue(container.querySelector("#buy-search") as HTMLInputElement, "bnvda");
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
  const option = Array.from(container.querySelectorAll(".hub-buy-result")).find(b => b.textContent?.includes("BNVDA"))!;
  expect(option.textContent).toContain("Tokenized stock");
  await act(async () => option.click());
  expect(container.textContent).toContain("Backed NVIDIA");
  await setValue(container.querySelector("#buy-amount") as HTMLInputElement, "25");
  const form = container.querySelector("form.hub-buy-form")!;
  await act(async () => { form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "propose", chainId: 8453, wallet: PREVIEW_WALLET, tokenIn: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", tokenOut: PREVIEW_TOKENS[1].address, amount: "25", slippageBps: 50, note: "Buy $25.00 of BNVDA" }));
  expect(container.querySelector(".hub-swap-result .hub-trade--crypto")).not.toBeNull();
});

it("keeps the advanced swap-by-contract form behind a toggle", async () => {
  await render(PREVIEW_STATE, <TradeView />);
  expect(container.querySelector("form.hub-swap-form")).toBeNull();
  const toggle = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.startsWith("More ways to buy"))!;
  await act(async () => toggle.click());
  const form = container.querySelector("form.hub-swap-form")!;
  const submit = form.querySelector("button[type=submit]") as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  await setValue(form.querySelector("input[aria-label='Amount in USDC']") as HTMLInputElement, "25");
  await setValue(form.querySelector("input[placeholder^='0x… on']") as HTMLInputElement, "0x4200000000000000000000000000000000000006");
  expect(submit.disabled).toBe(false);
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "propose", chainId: 8453, wallet: PREVIEW_WALLET, tokenIn: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", tokenOut: "0x4200000000000000000000000000000000000006", amount: "25", slippageBps: 50 }));
  expect(container.querySelector(".hub-swap-result .hub-trade--crypto")).not.toBeNull();
});

it("shows chat threads with a quiet count, starts a new chat through the server, and explains when chats are full", async () => {
  const second = { ...newChat("2026-09-14T20:00:00.000Z", "11111111-1111-4111-8111-111111111111"), title: "Nuclear names", updatedAt: "2026-09-14T20:00:00.000Z" };
  await render({ ...PREVIEW_STATE, chats: [...PREVIEW_STATE.chats, second] }, <HomeView />, { ...PREVIEW_ACCOUNT, usage: { ...PREVIEW_ACCOUNT.usage, chats: 17 } });
  expect(container.querySelector(".hub-chat-title")?.textContent).toContain("what happened with VRT today?");
  expect(container.querySelector(".hub-usage")?.textContent).toBe("17 of 20 chats");
  expect(container.querySelector(".site-header-actions .hub-account-credits")?.textContent).toBe("$4.61");
  await act(async () => (container.querySelector(".hub-chat-title") as HTMLButtonElement).click());
  const options = Array.from(container.querySelectorAll(".hub-chat-item strong")).map(n => n.textContent);
  expect(options).toEqual(["what happened with VRT today?", "Nuclear names"]);
  expect(container.querySelector(".hub-chat-list .hub-limit-hint")?.textContent).toContain("3 chats left");
  const create = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "New chat") as HTMLButtonElement;
  expect(create.disabled).toBe(false);
  await act(async () => create.click());
  expect(events.posted).toContainEqual({ action: "chat", op: "create" });
  await act(async () => root.unmount());
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await render(PREVIEW_STATE, <HomeView />, { ...PREVIEW_ACCOUNT, usage: { ...PREVIEW_ACCOUNT.usage, chats: 20 } });
  const full = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "New chat") as HTMLButtonElement;
  expect(full.disabled).toBe(true);
  expect(full.dataset.tooltip).toMatch(/Delete an old chat/);
  expect(container.querySelector(".hub-usage")?.classList.contains("is-full")).toBe(true);
});

it("disables the composer plainly when credits run out", async () => {
  await render(PREVIEW_STATE, <HomeView />, { ...PREVIEW_ACCOUNT, credits: { ...PREVIEW_ACCOUNT.credits, balanceMicros: 1_000 } });
  expect((container.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
  expect(container.querySelector(".hub-composer-meta")?.textContent).toMatch(/used your Free plan credits/);
  expect(container.querySelector(".site-header-actions .hub-account-credits")?.textContent).toBe("< $0.01");
  expect(container.querySelector(".site-header-actions .hub-account-credits")?.classList.contains("is-empty")).toBe(true);
});

it("counts follows and learned assets on the profile and explains the cap with what to do", async () => {
  const interests = ["NVDA", "VRT", "CRWV", "CEG", "OKLO"].map(s => ({ id: s, symbol: s, name: s, kind: "stock" as const }));
  const inferred = Array.from({ length: 25 }, (_, i) => ({ id: `A${i}`, weight: .3, confidence: .5, count: 3, updatedAt: "2026-09-14T00:00:00Z" }));
  await render({ ...PREVIEW_STATE, profile: { ...PREVIEW_STATE.profile, interests }, inferred }, <ProfileView />, PREVIEW_ACCOUNT);
  const pills = Array.from(container.querySelectorAll(".hub-usage")).map(n => n.textContent);
  expect(pills).toContain("5 of 5 followed");
  expect(pills).toContain("25 of 25 remembered");
  const hints = Array.from(container.querySelectorAll(".hub-limit-hint.is-full")).map(n => n.textContent ?? "");
  expect(hints.some(h => /follow 5 assets.*Unfollow one/.test(h))).toBe(true);
  expect(hints.some(h => /remember 25 assets.*paused learning/.test(h))).toBe(true);
  expect(container.querySelectorAll(".hub-facet").length).toBeGreaterThan(3);
  expect(container.querySelector(".hub-identity .hub-identity-name")?.textContent).toBe("Michael");
  expect(container.querySelector("details[name=profile-settings]")).toBeNull();
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>(".hub-chiplist input"));
  expect(inputs[0].disabled).toBe(true);
  expect(inputs[1].disabled).toBe(false);
  expect(container.querySelector(".hub-plan-summary")?.textContent).toMatch(/Free plan · \$4\.61 credits left/);
});

it("draws the identity header from what the person has actually done", async () => {
  await render(PREVIEW_STATE, <ProfileView />, PREVIEW_ACCOUNT);
  expect(container.querySelector(".hub-identity-name")?.textContent).toBe("Michael");
  expect(container.querySelector(".hub-identity-line")?.textContent).toBe("AI × Energy");
  expect(container.querySelector(".hub-identity-signature")?.textContent).toMatch(/^AUR·[0-9A-F]{4}\s+·\s+DAY \d+$/);
  // One lobe per theme held, and the ring that carries the progression.
  expect(container.querySelectorAll(".hub-identity .hub-aura [data-lobe]").length).toBe(2);
  expect(container.querySelector(".hub-identity .hub-aura")?.getAttribute("aria-label")).toMatch(/AI × Energy/);
  const tallies = Array.from(container.querySelectorAll(".hub-tally")).map(n => n.textContent);
  expect(tallies).toContain("23signals");
  expect(tallies).toContain("4watching");
  expect(container.querySelectorAll(".hub-milestone").length).toBe(8);
  expect(container.querySelectorAll(".hub-milestone.is-earned").length).toBeGreaterThan(0);
  expect(container.querySelector(".hub-progress-copy h2")?.textContent).toBeTruthy();
});

it("still composes an identity for someone who has not chosen anything yet", async () => {
  const blank = { ...PREVIEW_STATE, profile: { ...PREVIEW_STATE.profile, thesis: "", themes: [], interests: [], completedAt: null }, inferred: [], events: [], trades: [], preferences: [], dislikes: [] };
  await render(blank, <ProfileView />, PREVIEW_ACCOUNT);
  expect(container.querySelectorAll(".hub-identity .hub-aura [data-lobe]").length).toBe(3);
  expect(container.querySelector(".hub-identity-line")?.textContent).toBe("Still open");
  expect(container.querySelector(".hub-identity-stage")?.textContent).toBe("Forming");
  expect(container.querySelector(".hub-identity-thesis")).toBeNull();
  expect(container.querySelectorAll(".hub-milestone.is-earned").length).toBe(0);
  expect(container.querySelector(".hub-progress-copy p")?.textContent).toMatch(/believe/);
});


it("dismisses a discovery card after saving the preference and links directly to its details", async () => {
  await render(PREVIEW_STATE, <AssetGrid assets={[PREVIEW_ASSETS.OKLO]} discovery />);
  expect(container.querySelector(".hub-discovery-main")?.getAttribute("href")).toBe("/explore/stock/OKLO");
  expect(container.querySelector(".hub-discovery-price")?.textContent).toContain("Stock");
  expect(container.querySelector(".hub-discovery-price")?.textContent).not.toContain("market cap");
  await act(async () => (container.querySelector(".hub-discovery-dismiss") as HTMLButtonElement).click());
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "signal", signal: "dismissed", target: "OKLO" }));
  expect(container.querySelector(".hub-discovery-card")).toBeNull();
});

it("opens one account menu on hover: identity, credits, a wallet row that reveals details, then sign out last", async () => {
  privy.sendTransaction.mockImplementation(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x2105" : method === "eth_call" ? "0x17d7840" : "0xde0b6b3a7640000");
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await render(PREVIEW_STATE, <HomeView />, PREVIEW_ACCOUNT);
  expect(container.querySelectorAll(".site-header-actions > *").length).toBe(1);
  expect(container.querySelector(".site-nav-cta")).toBeNull();
  const account = container.querySelector(".hub-account") as HTMLElement;
  const trigger = account.querySelector(".hub-account-trigger") as HTMLButtonElement;
  expect(trigger.textContent).toContain("Michael");
  expect(trigger.querySelector(".hub-account-aura")).not.toBeNull();
  expect(trigger.querySelector("svg[aria-label='Your personalized agent badge']")).toBeNull();
  const menu = account.querySelector(".hub-account-menu") as HTMLElement;
  expect(menu.hidden).toBe(true);
  // A pointer click focuses the trigger first; it should stay open rather than
  // having that focus-open immediately toggled closed by the click.
  await act(async () => {
    trigger.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    trigger.focus();
    trigger.click();
  });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect(menu.hidden).toBe(false);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(Array.from(menu.children).map(n => n.className.split(" ")[0])).toEqual(["hub-account-pane", "hub-account-foot"]);
  expect(menu.querySelector(".hub-account-who")?.textContent).toBe("MichaelFree plan");
  expect(menu.querySelector(".hub-account-head .hub-account-aura")).not.toBeNull();
  expect(menu.querySelector(".hub-account-credits")?.textContent).toBe("$4.61");
  // The card stays quiet: no separators, no raw address, no explanatory copy.
  expect(menu.textContent).not.toContain("·");
  expect(menu.textContent).not.toContain("0x1111");
  expect(menu.textContent).not.toMatch(/provider|network\b/i);
  const walletRow = menu.querySelector(".hub-account-wallet") as HTMLButtonElement;
  expect(walletRow.textContent).toBe("Wallet25 USDC");
  const balanceRequests = privy.sendTransaction.mock.calls.length;
  expect(balanceRequests).toBeGreaterThan(0);
  await act(async () => walletRow.click());
  const detail = menu.querySelector(".hub-account-pane.is-detail") as HTMLElement;
  expect(menu.querySelector(".hub-account-head")).toBeNull();
  expect(detail.querySelector(".hub-account-qr svg")?.getAttribute("aria-label")).toBe(`QR code for ${PREVIEW_WALLET}`);
  expect(detail.querySelector(".hub-account-address")?.textContent).toBe(PREVIEW_WALLET);
  expect(Array.from(detail.querySelectorAll(".hub-account-facts div")).map(d => d.textContent)).toEqual(["NetworkBase", "USDC25", "ETH1"]);
  expect(document.activeElement).toBe(detail.querySelector(".hub-account-back"));
  const copy = detail.querySelector(".hub-account-copy") as HTMLButtonElement;
  await act(async () => copy.click());
  expect(writeText).toHaveBeenCalledWith(PREVIEW_WALLET);
  expect(copy.textContent).toBe("Copied");
  expect(menu.querySelector(".hub-account-foot .hub-account-signout")).not.toBeNull();
  await act(async () => (detail.querySelector(".hub-account-back") as HTMLButtonElement).click());
  expect(menu.querySelector(".hub-account-head")).not.toBeNull();
  await act(async () => trigger.click());
  await act(async () => trigger.click());
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect(privy.sendTransaction).toHaveBeenCalledTimes(balanceRequests);
  // Reopening after a close always lands on the identity card, not the last wallet.
  expect(menu.querySelector(".hub-account-pane.is-summary")).not.toBeNull();
  const signOut = menu.querySelector(".hub-account-foot .hub-account-signout") as HTMLButtonElement;
  expect(signOut.textContent).toBe("Sign out");
  await act(async () => signOut.click());
  expect(privy.logout).toHaveBeenCalledTimes(1);
  await act(async () => account.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(menu.hidden).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  privy.sendTransaction.mockReset();
});

it("surfaces brief contextual thoughts once and respects a quiet period", async () => {
  await render(PREVIEW_STATE);
  const announce = (id: string) => window.dispatchEvent(new CustomEvent('rubicon:presence', { detail: { kind: 'revisit', asset: { id, symbol: id, name: id, themes: ['energy'] } } }));
  await act(async () => { announce('VRT'); });
  expect(container.querySelector('.ambient-nudge')?.textContent).toContain('your Energy thesis');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss thought"]')!.click());
  await act(async () => { announce('VRT'); announce('CEG'); });
  expect(container.querySelector('.ambient-nudge')).toBeNull();
});

it("sends from the orb through the shared conversation", async () => {
  events.script = [{ type: 'text', text: 'Your thesis focuses on energy infrastructure.' }];
  await render(PREVIEW_STATE);
  await act(async () => container.querySelector<HTMLButtonElement>('.ambient-orb')!.click());
  const input = container.querySelector<HTMLTextAreaElement>('.ambient-panel textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'What is my thesis?');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector<HTMLButtonElement>('.ambient-panel [aria-label="Send message"]')!.disabled).toBe(false);
  await act(async () => container.querySelector('.ambient-panel form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(input.value).toBe('');
});

it("opens a contextual purchase from chat with the requested amount and restores focus on close", async () => {
  await render(PREVIEW_STATE);
  await type("buy $500 of NVDA");
  const sendButton = container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
  sendButton.focus();
  await act(async () => sendButton.click());
  const dialog = container.querySelector<HTMLDialogElement>('.rubicon-purchase')!;
  expect(dialog.open).toBe(true);
  expect((dialog.querySelector('#buy-search') as HTMLInputElement).value).toBe('NVDA');
  expect(events.posted).toHaveLength(0);
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
  await act(async () => dialog.querySelector<HTMLButtonElement>('.hub-buy-result')!.click());
  expect((dialog.querySelector('#buy-amount') as HTMLInputElement).value).toBe('500');
  expect(dialog.textContent).toContain('Tokenized stock exposure');
  expect(events.posted).toHaveLength(0);
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close purchase"]')!.click());
  expect(dialog.open).toBe(false);
  expect(container.querySelector('.hub-conversation')).not.toBeNull();
  expect(document.activeElement).toBe(container.querySelector('.hub-composer textarea'));
});

it("opens additional destinations by shortcut without duplicating the permanent navigation", async () => {
  await render(PREVIEW_STATE);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
  const panel = container.querySelector<HTMLElement>('.rubicon-portals')!;
  expect(panel).not.toBeNull();
  expect(Array.from(panel.querySelectorAll('a')).map(n => n.getAttribute('href'))).toEqual(['/thesis', '/agents']);
  expect(panel.textContent).not.toMatch(/Home|Explore|Memory/);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(container.querySelector('.rubicon-portals')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('.rubicon-more-trigger'));
});

it("leaves Home calm, and keeps the thesis in what reaching for something reveals", async () => {
  await render(PREVIEW_STATE);

  // The thesis no longer holds a section of its own above the conversation.
  expect(container.querySelector(".wv-thesis")).toBeNull();
  expect(container.querySelector(".hub-home")?.children.length).toBeLessThanOrEqual(2);

  // Explanations are attached to a deliberate control, not the whole message.
  expect(container.querySelector(".hub-row-content[aria-describedby]")).toBeNull();
  const said = Array.from(container.querySelectorAll<HTMLElement>(".hub-row.is-assistant .hub-why-trigger"));
  expect(said.length).toBeGreaterThan(0);
  expect(said.some(node => node.getAttribute("aria-describedby") === GLOSS_ID)).toBe(true);
  // And it is reachable without a pointer.
  expect(said.filter(node => node.getAttribute("aria-describedby") === GLOSS_ID).every(node => node.tabIndex === 0)).toBe(true);
});

it("keeps distinct account borders without labels covering the actions", async () => {
  localStorage.removeItem("rubicon:account-discovered:v1");
  await render(PREVIEW_STATE, <HomeView />, PREVIEW_ACCOUNT);
  const trigger = container.querySelector<HTMLButtonElement>(".hub-account-trigger")!;
  const open = async () => act(async () => {
    trigger.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    trigger.focus(); trigger.click();
  });

  await open();
  const menu = container.querySelector<HTMLElement>(".hub-account-menu")!;
  expect(menu.hidden).toBe(false);

  expect(menu.querySelector(".hub-discover-tag")).toBeNull();
  expect(Array.from(menu.querySelectorAll("[data-discover]")).map(t => t.getAttribute("data-discover"))).toEqual(["profile", "plan", "wallet", "signout"]);

  // Borders belong to actions.
  const actions = Array.from(menu.querySelectorAll<HTMLElement>("[data-discover]"));
  expect(actions.every(node => node.matches("a, button") || !!node.querySelector("a, button"))).toBe(true);
  // Each action retains its own border color.
  expect(menu.querySelectorAll("[data-discover]").length).toBe(4);

  // The introductory animation finishes.
  await act(async () => { await new Promise(r => setTimeout(r, 2800)); });
  expect(menu.classList.contains("is-discovering")).toBe(false);
  expect(container.querySelector(".hub-discover-tag")).toBeNull();

  // Opening it again retains the settled borders.
  await open(); await open();
  expect(container.querySelector(".hub-account-menu")?.classList.contains("is-discovering")).toBe(false);
  // What stays is the chevron already on every row.
  expect(container.querySelectorAll(".hub-account-chevron").length).toBeGreaterThan(0);
});

it("keeps the shortcut without printing it on the page", async () => {
  await render(PREVIEW_STATE);
  const trigger = container.querySelector<HTMLButtonElement>(".rubicon-more-trigger")!;
  expect(trigger.querySelector("kbd")).toBeNull();
  expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Meta+k Control+k");
  expect(container.querySelector(".rubicon-command footer")).toBeNull();
  expect(container.textContent).not.toContain("Enter to open");
});

it("draws what the agent knows as a shape, with the gaps visible", async () => {
  await render(PREVIEW_STATE, <ProfileView />, PREVIEW_ACCOUNT);
  const stats = identityStats(PREVIEW_STATE, PREVIEW_STATE.agent ? [PREVIEW_STATE.agent] : []);
  const areas = knowledgeOf(PREVIEW_STATE, stats, identityDepth(PREVIEW_STATE, stats));

  const bodies = Array.from(container.querySelectorAll<HTMLElement>(".hub-knowledge-area"));
  expect(bodies).toHaveLength(areas.length);
  // Size is how much it holds; colour is how sure it is. Both are read, not printed.
  expect(bodies[0].style.getPropertyValue("--known")).toBe(String(areas[0].known));
  expect(bodies[0].style.getPropertyValue("--sure")).toBe(String(areas[0].confidence));
  // A gap is marked as one, so the empty places are the visible thing.
  expect(bodies.filter(b => b.dataset.gap).length).toBe(areas.filter(a => a.gap).length);
  // Reaching for an area reveals it rather than the page stating it.
  expect(bodies[0].getAttribute("aria-describedby")).toBe(GLOSS_ID);
  expect(bodies.every(b => (b.getAttribute("aria-label") ?? "").length > 0)).toBe(true);

  // Choosing an area goes to where that part of the person is actually edited.
  expect(areas.every(area => container.querySelector(`[data-facet="${area.facet}"]`))).toBe(true);
});

it("wears one accent derived from the worldview, and none of its own", async () => {
  await render(PREVIEW_STATE, <ProfileView />, PREVIEW_ACCOUNT);
  const profile = container.querySelector<HTMLElement>(".hub-profile")!;
  // Every tone on the page is a shade of the identity accent set high in the tree.
  for (const token of ["--aura-glow", "--aura-glow-2", "--aura-deep"]) {
    expect(profile.style.getPropertyValue(token)).toMatch(/var\(--id-(accent|accent-soft|accent-deep|wash)\)/);
  }
  const layout = container.querySelector<HTMLElement>(".hub-layout")!;
  const accent = layout.style.getPropertyValue("--id-accent");
  expect(accent).toMatch(/^#[0-9a-f]{6}$/);
  // The accent follows what the person believes, not a colour chosen for them.
  const palette = identityPalette("preview-user", PREVIEW_STATE.profile.themes, PREVIEW_STATE.inferred,
    identityDepth(PREVIEW_STATE, identityStats(PREVIEW_STATE, PREVIEW_STATE.agent ? [PREVIEW_STATE.agent] : [])));
  expect(accent).toBe(palette.accent);
});
