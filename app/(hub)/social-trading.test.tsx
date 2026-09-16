// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { profileKey } from "../../lib/socialtrading/profile";

const session = vi.hoisted(() => ({ ready: true, authenticated: true, user: { id: "alice" } as { id: string } | null, login: vi.fn() }));
const config = vi.hoisted(() => ({ configured: true }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => session, useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn(), state: { status: "initial" } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/" }));
vi.mock("../providers", () => ({ usePrivyConfigured: () => config.configured }));
import { SocialTrading, ProfileFlow } from "./social-trading";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)", media: query,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  localStorage.clear();
  config.configured = true;
  Object.assign(session, { ready: true, authenticated: true, user: { id: "alice" } });
  push.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<SocialTrading />)); }
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button, [role='button']")).find(b => b.textContent?.includes(label) || b.getAttribute("aria-label")?.includes(label));
  expect(button, label).toBeTruthy();
  await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
async function type(selector: string, value: string) {
  const input = container.querySelector(selector) as HTMLInputElement;
  const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function setRange(label: string, value: string) {
  const input = container.querySelector(`input[type="range"][aria-label="${label}"]`) as HTMLInputElement;
  expect(input, label).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("keeps profile fields hidden until an authenticated session is ready", async () => {
  session.ready = false;
  await render();
  expect(container.querySelector("textarea")).toBeNull();
  session.ready = true; session.authenticated = false;
  await render();
  expect(container.textContent).toContain("Sign in");
  expect(container.querySelector("textarea")).toBeNull();
  config.configured = false;
  await render();
  expect(container.textContent).toContain("Sign-in is unavailable");
});

it("completes the compact flow with explicit automatic limits, then saves before exploring", async () => {
  await render();
  expect(container.querySelector("#interest-search")).toBeNull();
  expect(container.querySelector('input[type="radio"]')).toBeNull();
  expect(container.querySelector("[aria-label='Step 1 of 3']")).not.toBeNull();
  expect(container.textContent).toContain("Your agent is learning you");
  expect(container.textContent).toContain("Badge attributes");
  await click("Continue");
  expect(container.textContent).toContain("Choose how much you know");
  await setRange("Investment knowledge", "4");
  await click("Continue");
  await type("textarea", "AI infrastructure will grow.");
  await click("Continue");
  expect(container.querySelector("[aria-label='Step 3 of 3']")).not.toBeNull();
  expect(container.querySelector("#interest-search")).toBeNull();
  expect(container.textContent).toContain("Eyes · Spectacles");
  expect(container.querySelector("svg circle[cx='86'][r='7']")).not.toBeNull();
  await act(async () => (container.querySelector('input[value="automatic"]') as HTMLInputElement).click());
  await click("Meet my agent");
  expect(container.textContent).toContain("Enter a positive USD amount");
  const inputs = container.querySelectorAll('input[type="number"]');
  for (const [index, value] of ["25", "100", "500"].entries()) {
    inputs[index].id = `limit-${index}`;
    await type(`#limit-${index}`, value);
  }
  await click("Meet my agent");
  expect(push).toHaveBeenCalledWith("/");
  const saved = JSON.parse(localStorage.getItem(profileKey("alice"))!);
  expect(saved.completedAt).toBeTruthy();
  expect(saved.step).toBe(6);
  expect(saved.themes).toContain("ai");
  session.user = { id: "bob" };
  await render();
  expect(container.textContent).toContain("How much do you know about investing?");
});


it("lets experienced users write a thesis and restores their notification-only summary", async () => {
  await render();
  await setRange("Investment knowledge", "4");
  await click("Continue");
  await type("textarea", "Long-term energy demand.");
  await click("Continue");
  expect(container.querySelector('input[type="number"]')).toBeNull();
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Meet my agent");
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.textContent).toContain("Long-term energy demand.");
  expect(container.textContent).toContain("Meet your agent");
});

it("keeps users on their profile when browser storage fails", async () => {
  await render();
  await setRange("Investment knowledge", "4");
  await click("Continue");
  await type("textarea", "Infrastructure.");
  await click("Continue");
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  const save = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  await click("Meet my agent");
  expect(push).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Your profile could not be saved");
  expect(container.textContent).not.toContain("Saved in this browser");
  save.mockRestore();
});

it("creates a fresh agent from onboarding alone, without a name field, and without overwriting the existing profile", async () => {
  localStorage.setItem(profileKey("alice"), "existing-profile");
  const complete = vi.fn();
  await act(async () => root.render(<ProfileFlow userId="alice" persist={false} agentCreation onComplete={complete} />));
  expect(container.textContent).toContain("How much do you know about investing?");
  await setRange("Investment knowledge", "4");
  await click("Continue");
  await type("textarea", "AI and healthcare will change the world");
  await click("Continue");
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Create agent");
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ thesis: "AI and healthcare will change the world", themes: ["ai", "healthcare"], permission: "notify", step: 6 }));
  expect(localStorage.getItem(profileKey("alice"))).toBe("existing-profile");
});

it("guides newer investors through the short test and saves the answers for the agent", async () => {
  await render();
  await setRange("Investment knowledge", "1");
  await click("Continue");
  expect(container.textContent).toContain("What kind of change creates opportunity?");
  await click("Human progress");
  await click("Continue");
  expect(container.textContent).toContain("How much should ethics and impact shape your investments?");
  expect(container.textContent).not.toContain("responsible AI");
  await setRange("How much should ethics and impact shape your investments?", "4");
  expect(container.textContent).not.toContain("responsible AI");
  await click("Continue");
  expect(container.textContent).toContain("How important is responsible AI");
  expect(container.textContent).toContain("Your 2031 prediction");
  await setRange("How important is responsible AI to your outlook?", "3");
  expect(container.textContent).not.toContain("AI safety");
  await click("Continue");
  expect(container.textContent).toContain("AI safety");
  await click("AI safety");
  await click("Continue");
  await click("Precision medicine and AI");
  await click("Continue");
  const stored = JSON.parse(localStorage.getItem(profileKey("alice"))!);
  expect(stored.investorAnswers).toMatchObject({ knowledge: 1, opportunityDrivers: ["Human progress"], esgPriority: 4, aiPriority: 3, technologies: ["AI safety"] });
  expect(stored.thesis).toContain("Precision medicine and AI");
  expect(container.textContent).toContain("How should your agent act?");
});

it("changes the novice path toward defense when impact is a low priority", async () => {
  await render();
  await setRange("Investment knowledge", "0");
  await click("Continue");
  await click("Resilience & security");
  await click("Continue");
  await setRange("How much should ethics and impact shape your investments?", "0");
  expect(container.textContent).not.toContain("AI as a competitive advantage");
  await click("Continue");
  expect(container.textContent).toContain("AI as a strategic advantage");
  await setRange("How important is AI as a strategic advantage?", "4");
  await click("Continue");
  expect(container.textContent).toContain("Defense technology");
  await click("Defense technology");
  await click("Continue");
  expect(container.textContent).toContain("Where could conflict reshape markets?");
  await click("Ukraine");
  expect(JSON.parse(localStorage.getItem(profileKey("alice"))!).investorAnswers.conflictCountries).toContain("Ukraine");
  await click("Continue");
  expect(container.textContent).toContain("AI-enabled defense and cybersecurity");
});
