// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_ACCOUNT, PREVIEW_STATE } from "../../preview/fixture";

vi.mock("@privy-io/react-auth", () => ({
  useSign7702Authorization: () => ({ signAuthorization: vi.fn(async () => ({ r: "0x1", s: "0x2", yParity: 0, address: "0x0", chainId: 8453, nonce: 0 })) }),
  usePrivy: () => ({ getAccessToken: async () => "token", ready: true, authenticated: true, user: { id: "preview-user", linkedAccounts: [] } }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/activity" }));
import { HubProvider } from "./hub-provider";
import { ActivityView, needsYou } from "./activity-view";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async () => act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT}><ActivityView /></HubProvider>));

it("reads the week back in words and flags the trades that need the person", async () => {
  await render();
  const beads = Array.from(container.querySelectorAll(".hub-pulse-bead")).map(b => b.textContent);
  expect(beads[2]).toContain("2 trades waiting for you");
  expect(container.querySelector(".hub-pulse-bead.is-live")).not.toBeNull();
  expect(container.querySelectorAll(".hub-event").length).toBe(PREVIEW_STATE.events.length);
  const flagged = container.querySelectorAll(".hub-event.is-urgent");
  expect(flagged).toHaveLength(2);
  expect(flagged[0].querySelector(".hub-event-flag")?.textContent).toBe("Needs you");
  expect(flagged[0].classList.contains("hub-priority-card")).toBe(true);
  expect(container.querySelectorAll(".hub-day").length).toBeGreaterThan(3);
  expect(container.querySelector(".hub-event.is-learning .hub-event-medallion")).not.toBeNull();
});

it("narrows the feed through the lens without losing the day grouping", async () => {
  await render();
  const trades = Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-lens-item")).find(b => b.textContent === "Trades")!;
  await act(async () => trades.click());
  expect(container.querySelectorAll(".hub-event").length).toBe(2);
  expect(container.querySelectorAll(".hub-day").length).toBe(1);
  expect(Array.from(container.querySelectorAll(".hub-event")).every(e => e.classList.contains("is-trade"))).toBe(true);
});

it("knows which trades are waiting on a signature or approval", () => {
  const [stock, swap] = PREVIEW_STATE.trades;
  expect(needsYou(stock)).toBe(true);
  expect(needsYou({ ...stock, status: "confirmed" })).toBe(false);
  expect(needsYou({ ...swap, status: "reserved" })).toBe(true);
  expect(needsYou({ ...swap, status: "reserved", crypto: { ...swap.crypto!, phase: "issued" } })).toBe(false);
  expect(needsYou(undefined)).toBe(false);
});
