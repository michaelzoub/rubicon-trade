// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { FAMILIARITY_CONCEPTS } from "../../lib/socialtrading/familiarity";
import { profileKey } from "../../lib/socialtrading/profile";
import { DECK_SIZE, basePrediction, newOnboarding, nextPrediction } from "../../lib/socialtrading/onboarding";

const session = vi.hoisted(() => ({ ready: true, authenticated: true, user: { id: "alice" } as { id: string } | null, login: vi.fn() }));
const config = vi.hoisted(() => ({ configured: true }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@privy-io/react-auth", () => ({ useSign7702Authorization: () => ({ signAuthorization: vi.fn() }), usePrivy: () => session, getAccessToken: vi.fn(async () => null), useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn(), state: { status: "initial" } }) }));
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
  window.history.replaceState({}, "", "/?onboarding=tree");
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

/** The two shared foundations, then the opening AI chart and the map. Everyone
 * lands on the same base questions before the deck covers the other domains. */
async function pickFamiliarity(experienced = true) {
  if (experienced) for (const concept of FAMILIARITY_CONCEPTS) await click(concept.label);
  await click("Continue");
}
async function foundation(level = "Experienced", confidence = "Clear views") {
  await click(confidence); await click("Continue");
  await pickFamiliarity(level === "Experienced");
  await place("Society and work", "84", "6"); await click("Continue");
  await click("Continue");   // Past the map, which nobody has to fill in.
}
/** Places the dot on whichever chart is asking about `category`. */
async function place(category: string, sure: string, years: string) {
  await setRange(`How sure you are: ${category}`, sure);
  await setRange(`How far ahead you are looking: ${category}`, years);
}
/** Throws every remaining domain card the run offers, all the same way. */
async function sweep(label = "Not sure") {
  for (let i = 0; i < DECK_SIZE; i++) await click(label);
}
/** The first card the deck picks after a given opening answer. */


const log = (m: string, v: unknown) => require("node:fs").appendFileSync("/tmp/zz.log", m + " " + String(v) + "\n");
it("DEBUG dump", async () => {
  await render();
  await foundation("Unknown grounds", "I\u2019m here to explore");
  log("AFTER FOUNDATION:", container.textContent?.slice(0, 500));
  for (let i = 0; i < DECK_SIZE; i++) {
    const btn = Array.from(container.querySelectorAll("button, [role='button']")).find(b => b.textContent?.includes("Not sure"));
    if (!btn) { log("NO BUTTON at i=" + i + " DOM:", container.textContent?.slice(0, 600)); break; }
    await act(async () => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    log("swiped i=" + i, "");
  }
});
