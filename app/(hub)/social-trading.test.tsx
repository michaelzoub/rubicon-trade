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

/** The two shared foundations, then the opening AI chart and the map. Everyone
 * lands on the same base questions before the deck covers the other domains. */
async function pickFamiliarity(experienced = true) {
  if (experienced) for (const concept of FAMILIARITY_CONCEPTS) await click(concept.label);
  await click("Continue");
}
async function foundation(level = "Experienced", confidence = "I know what I believe") {
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
const branch = (...priors: { id: string; category: string; text: string; direction: "yes" | "no" | "unsure" }[]) =>
  nextPrediction({ ...newOnboarding(), responses: priors }, 3)!;
const opening = (direction: "yes" | "no" = "yes") => ({ ...basePrediction(3), direction });
async function uncertain() {
  await sweep();
  // The opening AI view is the only decided one left to carry the thesis.
  await click("AI"); await click("Continue");
  await click("I’m open to everything"); await click("Continue");
}
it("requires explicit foundation answers and carries only the views that were actually taken", async () => {
  await render();
  await foundation("Unknown grounds", "I’m here to explore");
  await uncertain();
  expect(container.textContent).toContain("Your outlook. Your rules.");
  await click("Meet my agent");
  expect(container.textContent).toContain("Choose how your agent should act");
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Meet my agent");
  const saved = JSON.parse(localStorage.getItem(profileKey("alice"))!);
  expect(saved.completedAt).toBeTruthy();
  expect(saved.investorAnswers.familiarityTier).toBe(1);
  expect(saved.investorAnswers.familiarityScore).toBe(0);
  expect(saved.investorAnswers.selectedConceptIds).toEqual([]);
  expect(saved.investorAnswers.knowledge).toBe(0);
  // Every card after the opening chart was answered "not sure", so the opening
  // view is the only one allowed to shape the thesis or the themes.
  expect(saved.themes).toEqual(["ai"]);
  expect(saved.thesis).toContain(basePrediction(0).text);
  expect(saved.thesis.split("\n")).toHaveLength(1);
  expect(saved.investorAnswers.onboarding.responses).toHaveLength(DECK_SIZE + 1);
  expect(push).toHaveBeenCalledWith("/");
});
it("saves disagreement, confidence, horizon, own beliefs and reversible dislikes", async () => {
  const complete = vi.fn();
  await act(async () => root.render(<ProfileFlow userId="alice" persist={false} onComplete={complete} />));
  await foundation();
  // The first remaining domain after the AI chart, not a branch off the answer.
  const first = branch(opening());
  await click("I don’t see it");
  for (let i = 1; i < DECK_SIZE; i++) await click("Not sure");
  await click(first.text); await type("textarea", "Healthcare can improve."); await click("Continue");
  expect(container.textContent).toContain("Draw your prediction");
  await place(first.category, "90", "11"); await click("Continue");
  await click("Tobacco"); await click("Memecoins"); await click("Tobacco");
  await click("Continue");
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Meet my agent");
  const p = complete.mock.calls[0][0];
  expect(p.investorAnswers.familiarityTier).toBe(4);
  expect(p.investorAnswers.familiarityScore).toBe(30);
  expect(p.investorAnswers.knowledge).toBe(3);
  expect(p.thesis).toContain("I do not expect"); expect(p.thesis).toContain("90%");
  expect(p.investorAnswers.onboarding.dislikes).toEqual(["Memecoins"]);
  expect(p.investorAnswers.onboarding.responses.find((r: { id: string }) => r.id === first.id)).toMatchObject({ direction: "no", confidence: 90, years: 11 });
  // The opening chart's own answer keeps the conviction it was given.
  expect(p.investorAnswers.onboarding.responses[0]).toMatchObject({ id: basePrediction(3).id, direction: "yes", confidence: 84, years: 6 });
  expect(localStorage.getItem(profileKey("alice"))).toBeNull();
});
it("puts the world map in front of everyone and keeps the countries", async () => {
  const complete = vi.fn();
  await act(async () => root.render(<ProfileFlow userId="alice" persist={false} onComplete={complete} />));
  await click("I know what I believe"); await click("Continue");
  await pickFamiliarity(true);
  await place("Society and work", "70", "4"); await click("Continue");
  expect(container.textContent).toContain("Where could conflict reshape markets?");
  await click("Russia");
  expect(container.textContent).toContain("1 country selected");
  await type("textarea", "Energy security decides the decade."); await click("Continue");
  await sweep(); await click("AI"); await click("Continue");
  await click("I’m open to everything"); await click("Continue");
  expect(container.textContent).toContain("Watching Russia");
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Meet my agent");
  const p = complete.mock.calls[0][0];
  expect(p.investorAnswers.conflictCountries).toEqual(["Russia"]);
  expect(p.investorAnswers.geopoliticalThesis).toBe("Energy security decides the decade.");
});
it("skips the conviction chart when the opening chart already answered it", async () => {
  await render(); await foundation();
  await sweep();
  // The AI view is the only decided one, and it already carries its conviction.
  await click("AI"); await click("Continue");
  expect(container.textContent).not.toContain("Draw your prediction");
  expect(container.textContent).toContain("What doesn’t belong in your future?");
});
it("validates automatic limits and handles failed completion", async () => {
  const complete = vi.fn().mockRejectedValue(new Error("network"));
  await act(async () => root.render(<ProfileFlow userId="alice" persist={false} agentCreation onComplete={complete} />));
  await foundation(); await uncertain();
  await act(async () => (container.querySelector('input[value="automatic"]') as HTMLInputElement).click());
  await click("Create agent"); expect(container.textContent).toContain("Enter a positive USD amount");
  const inputs = container.querySelectorAll('input[type="number"]');
  for (const [i, value] of ["25", "100", "500"].entries()) { inputs[i].id = `limit-${i}`; await type(`#limit-${i}`, value); }
  await click("Create agent"); expect(complete).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("Please try again");
});
it("restores a partial swipe deck and allows undo", async () => {
  await render(); await foundation();
  const first = branch(opening());
  expect(container.textContent).toContain(first.text);
  await click("I see it");
  const second = branch(opening(), { ...first, direction: "yes" });
  await act(async () => root.unmount()); root = createRoot(container); await render();
  expect(container.textContent).toContain(second.text);
  await click("Undo last swipe");
  expect(container.textContent).toContain(first.text);
});
it("keeps users on their profile when browser storage fails", async () => {
  await render(); await foundation(); await uncertain();
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  const save = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  await click("Meet my agent"); expect(push).not.toHaveBeenCalled(); expect(container.textContent).toContain("Your profile could not be saved"); save.mockRestore();
});
