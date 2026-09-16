// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_ACCOUNT, PREVIEW_STATE } from "@/app/preview/fixture";
import { MODELS, modelsForPlan } from "@/lib/socialtrading/models";
import { PLANS } from "@/lib/socialtrading/plans";
import { HubProvider } from "./hub-provider";
import { PlansView } from "./plans-view";

const privy = vi.hoisted(() => ({ getAccessToken: async () => "token" }));
vi.mock("@privy-io/react-auth", () => ({ useSign7702Authorization: () => ({ signAuthorization: vi.fn() }), usePrivy: () => privy }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/plans" }));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const text = () => document.body.textContent ?? "";

async function render(account = PREVIEW_ACCOUNT) {
  await act(async () => {
    root.render(<HubProvider userId="u-1" name="Michael" initial={structuredClone(PREVIEW_STATE)} initialAccount={account}
      api={{}} chatStream={async () => { throw new Error("no chat in this test"); }}><PlansView /></HubProvider>);
  });
}

it("shows all three tiers with their prices", async () => {
  await render();
  for (const plan of Object.values(PLANS)) expect(text()).toContain(plan.name);
  expect(text()).toContain("$5");
  expect(text()).toContain("$20");
});

it("prices free as $0 rather than saying Free twice", async () => {
  await render();
  const free = [...container.querySelectorAll("[data-plan-card]")][0];
  expect(free.querySelector(".hub-plan-amount")?.textContent).toBe("$0");
  expect(free.textContent?.match(/Free/g) ?? []).toHaveLength(1);
});

it("lists every model in the catalogue across the three cards", async () => {
  await render();
  for (const model of MODELS) expect(text(), model.id).toContain(model.name);
});

it("puts the frontier models on the top card only", async () => {
  await render();
  const cards = [...container.querySelectorAll("[data-plan-card]")];
  expect(cards).toHaveLength(3);
  const free = cards[0].textContent ?? "";
  for (const m of MODELS.filter(m => m.tier === "frontier")) expect(free).not.toContain(m.name);
  const pro = cards[2].textContent ?? "";
  for (const m of MODELS.filter(m => m.tier === "frontier")) expect(pro).toContain(m.name);
});

it("marks the plan you are on and offers no button for it", async () => {
  await render();
  const current = container.querySelector(".hub-plan-card.is-current");
  expect(current?.textContent).toContain("Your plan");
  expect(current?.querySelector(".hub-plan-cta")).toBeNull();
});

it("disables the paid buttons and says why", async () => {
  await render();
  const buttons = [...container.querySelectorAll<HTMLButtonElement>(".hub-plan-cta")];
  expect(buttons).toHaveLength(2);
  for (const b of buttons) expect(b.disabled).toBe(true);
  expect(text()).toContain("Opening soon");
});

it("names what each paid tier inherits, so the ladder is cumulative on its face", async () => {
  await render();
  const rule = (i: number) => container.querySelectorAll("[data-plan-card]")[i].querySelector(".hub-plan-rule")?.textContent;
  expect(rule(0)).toBe("Fast models");
  expect(rule(1)).toBe("Free +");
  expect(rule(2)).toBe("Free & Plus +");
});

it("gives every card an orb and a crest, and the badge to one card only", async () => {
  await render();
  expect(container.querySelectorAll(".hub-plan-orb")).toHaveLength(3);
  expect(container.querySelectorAll(".hub-plan-crest")).toHaveLength(3);
  expect(container.querySelectorAll(".hub-plan-badge")).toHaveLength(1);
  expect(container.querySelector(".hub-plan-card.is-featured .hub-plan-badge")).not.toBeNull();
});

it("tones each card by plan, so the CSS has something to hang the palette on", async () => {
  await render();
  const cards = [...container.querySelectorAll("[data-plan-card]")];
  expect(cards[0].className).toContain("is-free");
  expect(cards[1].className).toContain("is-plus");
  expect(cards[2].className).toContain("is-pro");
});

it("raises exactly one card", async () => {
  await render();
  expect(container.querySelectorAll(".hub-plan-card.is-featured")).toHaveLength(1);
});

it("sends you to the plans it knows about when the account is missing", async () => {
  await render(null as unknown as typeof PREVIEW_ACCOUNT);
  // No account means no plan yet, so free is the one marked.
  const current = container.querySelector(".hub-plan-card.is-current");
  expect(current?.textContent).toContain(PLANS.free.name);
});

it("shows the room each tier gives, read from the plan's own limits", async () => {
  await render();
  const pro = [...container.querySelectorAll("[data-plan-card]")][2].textContent ?? "";
  expect(pro).toContain("Unlimited");
  expect(modelsForPlan("pro")).toHaveLength(MODELS.length);
});
