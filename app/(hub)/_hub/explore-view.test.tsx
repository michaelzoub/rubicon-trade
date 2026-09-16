// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_ACCOUNT, PREVIEW_ASSETS, PREVIEW_STATE } from "../../preview/fixture";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: async () => "token", ready: true, authenticated: true, user: { id: "preview-user", linkedAccounts: [] } }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/explore" }));
import { HubProvider } from "./hub-provider";
import { ExploreView, mergeKinds } from "./explore-view";
import { constellation } from "./explore-hero";

let container: HTMLDivElement, root: Root;
const calls: Record<string, string>[] = [];
const api = {
  market: async (_t: unknown, params: Record<string, string>) => {
    calls.push(params);
    const all = Object.values(PREVIEW_ASSETS);
    return { assets: params.kind === "crypto" ? all.filter(a => a.kind === "crypto") : all.filter(a => a.kind === "stock").filter(a => !params.q || `${a.symbol} ${a.name} ${a.themes.join(" ")}`.toLowerCase().includes(params.q.toLowerCase())) };
  },
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  calls.length = 0;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async () => { await act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT} api={api}><ExploreView /></HubProvider>)); await act(async () => { await new Promise(r => setTimeout(r, 10)); }); };
const tab = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>(".hub-lens-item")).find(b => b.textContent === label)!;

it("opens a spatial market and assembles reasoning when an idea is selected", async () => {
  await render();
  expect(Array.from(container.querySelectorAll(".hub-lens-item")).map(b => b.textContent)).toEqual(["For you", "Themes", "New", "Moving"]);
  expect(tab("For you").getAttribute("aria-selected")).toBe("true");
  const objects = Array.from(container.querySelectorAll<HTMLButtonElement>(".wv-market-object"));
  expect(objects.some(a => a.textContent?.includes("DOGE"))).toBe(true);
  expect(objects.some(a => a.textContent?.includes("VRT"))).toBe(true);
  await act(async () => objects.find(a => a.textContent?.includes("VRT"))!.click());
  expect(container.querySelector('[aria-label="Decision workspace"]')?.textContent).toContain("YOUR BELIEF");
  expect(container.querySelector(".hub-explore-results .hub-part-title")?.textContent).toBe("Picked for you");
  const grid = Array.from(container.querySelectorAll(".gravity-all .hub-asset")).map(c => c.getAttribute("data-asset"));
  expect(grid).toContain("DOGE");
  expect(grid).toContain("VRT");
  expect(calls.map(c => c.kind).sort()).toEqual(["crypto", "stock"]);
});

it("shows theme orbs under Themes and loads a theme when one is chosen", async () => {
  await render();
  await act(async () => tab("Themes").click());
  const orbs = container.querySelectorAll<HTMLButtonElement>(".hub-orb");
  expect(orbs).toHaveLength(6);
  expect(Array.from(container.querySelectorAll(".hub-orb.is-yours strong")).map(n => n.textContent)).toEqual(["Energy", "AI"]);
  expect(container.textContent).toContain("Pick a theme");
  const energy = Array.from(orbs).find(o => o.querySelector("strong")?.textContent === "Energy")!;
  await act(async () => energy.click());
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect(energy.getAttribute("aria-pressed")).toBe("true");
  expect(calls.at(-1)).toEqual(expect.objectContaining({ kind: "stock", q: "energy" }));
  expect(container.querySelector(".hub-explore-results .hub-part-title")?.textContent).toBe("Energy in your world");
  expect(container.textContent).toContain("becoming more interested in energy");
});

it("ranks by the agent's score when it has one and alternates kinds when it does not", () => {
  const stock = (id: string, score?: number) => ({ ...PREVIEW_ASSETS.VRT, id, symbol: id, score });
  const coin = (id: string, score?: number) => ({ ...PREVIEW_ASSETS.DOGE, id, symbol: id, score });
  expect(mergeKinds([stock("A"), stock("B")], [coin("X")]).map(a => a.id)).toEqual(["A", "X", "B"]);
  expect(mergeKinds([stock("A", .2), stock("B", .9)], [coin("X", .5)]).map(a => a.id)).toEqual(["B", "X", "A"]);
  // The field holds up to ten, alternating so neither kind buries the other.
  // Order no longer implies position — `plot` places each card from its data.
  expect(constellation([stock("A"), stock("B"), stock("C"), stock("D"), stock("E"), coin("X"), coin("Y"), coin("Z")]).map(a => a.id)).toEqual(["A", "X", "B", "Y", "C", "Z", "D", "E"]);
  const many = Array.from({ length: 9 }, (_, i) => stock(`S${i}`)).concat(Array.from({ length: 9 }, (_, i) => coin(`C${i}`)));
  expect(constellation(many)).toHaveLength(10);
});
