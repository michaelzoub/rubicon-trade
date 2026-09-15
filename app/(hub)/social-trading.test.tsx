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
import { SocialTrading } from "./social-trading";

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
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes(label));
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}
async function type(selector: string, value: string) {
  const input = container.querySelector(selector) as HTMLInputElement;
  const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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

it("completes the flow with custom interests and explicit automatic limits, then saves before exploring", async () => {
  await render();
  expect(container.querySelector("#interest-search")).toBeNull();
  expect(container.querySelector('input[type="radio"]')).toBeNull();
  expect(container.querySelector("[aria-label='Step 1 of 5']")).not.toBeNull();
  expect(container.textContent).toContain("Your agent is learning you");
  const avatar = container.querySelector("svg[aria-label='Your personalized agent badge']")!.innerHTML;
  await click("Continue");
  expect(container.textContent).toContain("Add a few words");
  await type("textarea", "AI infrastructure will grow.");
  await click("Continue");
  expect(container.querySelector("#interest-search")).toBeNull();
  expect(container.querySelector("svg[aria-label='Your personalized agent badge']")!.innerHTML).toBe(avatar);
  await click("AI");
  await click("Energy");
  expect(container.textContent).toContain("2 themes shaping your profile");
  expect(container.querySelector("svg[aria-label='Your personalized agent badge']")!.innerHTML).not.toBe(avatar);
  await click("Continue");
  expect(container.textContent).toContain("Power infrastructure");
  await click("NVDA");
  await type("#interest-search", "Clean energy");
  await click("Add");
  expect(container.textContent).toContain("Watching · 2");
  await click("Continue");
  await act(async () => (container.querySelector('input[value="automatic"]') as HTMLInputElement).click());
  await click("Create my profile");
  expect(container.textContent).toContain("Enter a positive USD amount");
  const inputs = container.querySelectorAll('input[type="number"]');
  for (const [index, value] of ["25", "100", "500"].entries()) {
    inputs[index].id = `limit-${index}`;
    await type(`#limit-${index}`, value);
  }
  await click("Create my profile");
  expect(container.textContent).toContain("$25.00 per trade");
  expect(container.querySelector("form")).toBeNull();
  expect(container.textContent).toContain("Energy × AI");
  await click("Edit profile");
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("AI infrastructure will grow.");
  await click("Continue"); await click("Continue"); await click("Continue"); await click("Create my profile");
  await click("Meet your agent");
  expect(push).toHaveBeenCalledWith("/");
  expect(JSON.parse(localStorage.getItem(profileKey("alice"))!).completedAt).toBeTruthy();
  session.user = { id: "bob" };
  await render();
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
});


it("lets users skip interests and restores their notification-only summary on return", async () => {
  await render();
  await type("textarea", "Long-term energy demand.");
  await click("Continue");
  await click("Continue");
  await click("Continue");
  expect(container.querySelector('input[type="number"]')).toBeNull();
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Create my profile");
  expect(container.textContent).toContain("Notify me");
  expect(container.textContent).toContain("0 assets");
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.textContent).toContain("Long-term energy demand.");
  expect(container.textContent).toContain("Meet your agent");
});

it("keeps users on their profile when browser storage fails", async () => {
  await render();
  await type("textarea", "Infrastructure.");
  await click("Continue"); await click("Continue"); await click("Continue");
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Create my profile");
  const save = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  await click("Meet your agent");
  expect(push).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Your profile could not be saved");
  expect(container.textContent).not.toContain("Saved in this browser");
  save.mockRestore();
});
