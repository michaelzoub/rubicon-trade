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
        if (body.action === "prepare") return { state: { ...PREVIEW_STATE, revision: 13 }, batch: BATCH, step: "swap", expiresAt: Date.now() + 60_000 };
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
import { TradeView } from "./trade-view";
import { AssetGrid } from "./parts";
import { ProfileView } from "./profile-view";
import { ActivityView } from "./activity-view";
import type { AccountSummary } from "@/lib/socialtrading/plans";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  events.script = []; events.posted = [];
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
  expect(container.textContent).toContain("I’ve read your thesis");
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
  const dismiss = Array.from(container.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "Not interested in OKLO")!;
  await act(async () => dismiss.click());
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "signal", signal: "dismissed", target: "OKLO", themes: ["energy"] }));
  const approve = Array.from(container.querySelectorAll(".hub-trade button")).find(b => b.textContent === "Approve")!;
  await act(async () => approve.click());
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "trade", tradeId: "t1", decision: "approved" }));
});

it("adds the Rubicon-blue priority treatment only to high-importance cards", async () => {
  await render(PREVIEW_STATE, <AssetGrid assets={[PREVIEW_ASSETS.VRT, PREVIEW_ASSETS.OKLO]} />);
  expect(container.querySelector('[data-asset="VRT"]')?.classList.contains("hub-priority-card")).toBe(true);
  expect(container.querySelector('[data-asset="OKLO"]')?.classList.contains("hub-priority-card")).toBe(false);
});

it("shows an onchain swap in human units and walks prepare → sign → submitted → status", async () => {
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
  expect(privy.switchChain).toHaveBeenCalledWith(8453);
  // The batch goes to the bundler untouched, and no raw transaction is ever sent
  // from the wallet — that path needed ETH the embedded wallet does not hold.
  expect(gasless.sendSwapBatch).toHaveBeenCalledWith(expect.objectContaining({ batch: BATCH }));
  expect(privy.sendTransaction).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
  const actions = events.posted.filter((p): p is { action: string } => typeof (p as { action?: unknown }).action === "string").map(p => p.action);
  expect(actions).toEqual(["prepare", "submitted", "status"]);
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "submitted", tradeId: "t2", hash: `0x${"ab".repeat(32)}`, userOpHash: `0x${"cd".repeat(32)}` }));
});

it("tells the buyer what is missing instead of letting a short balance reach the wallet", async () => {
  privy.sendTransaction.mockImplementation(async ({ method }: { method: string }) =>
    method === "eth_chainId" ? "0x2105" : method === "eth_call" ? "0x2faf080" : "0x0"); // 50 USDC, no ETH
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

it("opens command navigation by shortcut and filters destinations", async () => {
  await render(PREVIEW_STATE);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
  const dialog = container.querySelector<HTMLDialogElement>('.rubicon-command')!;
  expect(dialog.open).toBe(true);
  await setValue(dialog.querySelector('input')!, 'memory');
  expect(Array.from(dialog.querySelectorAll('[data-command]')).map(n => n.textContent)).toEqual(['Memory']);
  await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(dialog.open).toBe(false);
});
