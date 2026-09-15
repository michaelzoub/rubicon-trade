// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatEvent, HubState } from "@/lib/socialtrading/types";
import { PREVIEW_ACCOUNT, PREVIEW_CHAT, PREVIEW_STATE, PREVIEW_TOKENS, PREVIEW_WALLET } from "../../preview/fixture";
import { newChat } from "@/lib/socialtrading/chats";

const events = vi.hoisted(() => ({ script: [] as ChatEvent[], posted: [] as unknown[] }));
const privy = vi.hoisted(() => ({ sendTransaction: vi.fn(), linkWallet: vi.fn(), connectWallet: vi.fn(), createWallet: vi.fn(), switchChain: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: async () => "token", ready: true, authenticated: true, user: { id: "preview-user", linkedAccounts: [{ type: "wallet", chainType: "ethereum", address: "0x1111111111111111111111111111111111111111", walletClientType: "privy" }] }, linkWallet: privy.linkWallet, connectWallet: privy.connectWallet, createWallet: privy.createWallet }),
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
        if (body.action === "prepare") return { state: { ...PREVIEW_STATE, revision: 13 }, transaction: { chainId: 8453, from: PREVIEW_WALLET, to: "0x2222222222222222222222222222222222222222", data: "0xabcdef", value: "0" }, step: "swap", expiresAt: Date.now() + 60_000 };
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
import { ProfileView } from "./profile-view";
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

it("renders the agent management navigation, the conversation and the living profile card", async () => {
  await render(PREVIEW_STATE);
  expect(Array.from(container.querySelectorAll(".hub-nav-link")).map(a => a.textContent)).toEqual(["Home", "Explore", "Buy", "Activity", "Manage agents", "Profile"]);
  expect(container.querySelectorAll(".hub-row").length).toBe(PREVIEW_STATE.chats[0].messages.length);
  expect(container.textContent).toContain("Michael’s agent");
  expect(container.querySelector(".hub-trade")?.textContent).toContain("Approve");
  expect(container.querySelector(".socialtrading-profile-card")?.textContent).toContain("Ask before acting");
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

it("shows an onchain swap in human units and walks prepare → sign → submitted → status", async () => {
  privy.sendTransaction.mockResolvedValue(`0x${"ab".repeat(32)}`);
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
  expect(privy.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction", params: [expect.objectContaining({ to: "0x2222222222222222222222222222222222222222", chainId: "0x2105" })] }));
  const actions = events.posted.filter((p): p is { action: string } => typeof (p as { action?: unknown }).action === "string").map(p => p.action);
  expect(actions).toEqual(["prepare", "submitted", "status"]);
  expect(events.posted).toContainEqual(expect.objectContaining({ action: "submitted", tradeId: "t2", hash: `0x${"ab".repeat(32)}` }));
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
  expect(container.querySelector(".site-header-actions .hub-credits")?.textContent).toBe("$4.61 credits");
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
  expect(full.title).toMatch(/Delete an old chat/);
  expect(container.querySelector(".hub-usage")?.classList.contains("is-full")).toBe(true);
});

it("disables the composer plainly when credits run out", async () => {
  await render(PREVIEW_STATE, <HomeView />, { ...PREVIEW_ACCOUNT, credits: { ...PREVIEW_ACCOUNT.credits, balanceMicros: 1_000 } });
  expect((container.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(true);
  expect(container.querySelector(".hub-composer-meta")?.textContent).toMatch(/used your Free plan credits/);
  expect(container.querySelector(".site-header-actions .hub-credits")?.textContent).toBe("< $0.01 credits · empty");
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
  expect(container.querySelector(".hub-plan-note")?.textContent).toMatch(/follow up to 5 assets/);
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>(".hub-chiplist input"));
  expect(inputs[0].disabled).toBe(true);
  expect(inputs[1].disabled).toBe(false);
  expect(container.querySelector(".hub-plan-summary")?.textContent).toMatch(/Free plan · \$4\.61 credits left/);
});
