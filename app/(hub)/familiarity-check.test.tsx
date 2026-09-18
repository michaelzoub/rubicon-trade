// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FAMILIARITY_CONCEPTS, FAMILIARITY_TIER_LABELS, FAMILIARITY_TITLE } from "../../lib/socialtrading/familiarity";
import { FamiliarityCheck } from "./familiarity-check";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes(label));
  expect(button, label).toBeTruthy();
  await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

it("lets Continue fire with nothing selected and does not reveal the silent tier", async () => {
  const onComplete = vi.fn();
  await act(async () => root.render(<FamiliarityCheck onComplete={onComplete} />));
  expect(container.textContent).toContain(FAMILIARITY_TITLE);
  expect(container.textContent).not.toContain("Select any you're familiar with");
  expect(container.querySelectorAll(".onb-familiarity-chip")).toHaveLength(FAMILIARITY_CONCEPTS.length);
  for (const label of Object.values(FAMILIARITY_TIER_LABELS)) expect(container.textContent).not.toContain(label);
  expect(container.textContent).not.toMatch(/tier|score/i);
  await click("Continue");
  expect(onComplete).toHaveBeenCalledWith({ familiarityTier: 1, familiarityScore: 0, selectedConceptIds: [] });
});

it("toggles chips, marks the selected state accessibly, and scores on Continue", async () => {
  const onComplete = vi.fn();
  await act(async () => root.render(<FamiliarityCheck onComplete={onComplete} showTitle={false} />));
  expect(container.textContent).not.toContain(FAMILIARITY_TITLE);
  await click("Stock");
  await click("Options contract");
  const stock = Array.from(container.querySelectorAll<HTMLButtonElement>(".onb-familiarity-chip")).find(b => b.textContent?.includes("Stock"));
  expect(stock?.getAttribute("aria-pressed")).toBe("true");
  expect(stock?.querySelector(".onb-check")).toBeNull();
  await click("Stock");
  expect(stock?.getAttribute("aria-pressed")).toBe("false");
  await click("Continue");
  expect(onComplete).toHaveBeenCalledWith({ familiarityTier: 1, familiarityScore: 4, selectedConceptIds: [12] });
});

it("hides its own Continue when a host card already has one", async () => {
  await act(async () => root.render(<FamiliarityCheck onComplete={vi.fn()} hideContinue />));
  expect(Array.from(container.querySelectorAll("button")).some(b => b.textContent?.includes("Continue"))).toBe(false);
});

it("randomizes display order without changing the concept set", async () => {
  const order = () => Array.from(container.querySelectorAll(".onb-familiarity-chip")).map(b => b.textContent?.trim());
  await act(async () => root.render(<FamiliarityCheck onComplete={vi.fn()} />));
  const first = order();
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<FamiliarityCheck onComplete={vi.fn()} />));
  const second = order();
  expect([...first].sort()).toEqual([...second].sort());
  expect(first).toHaveLength(12);
});
