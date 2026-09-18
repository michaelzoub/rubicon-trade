// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetNews } from "./asset-news";

let container: HTMLDivElement, root: Root;
const items = ["First", "Second", "Third", "Fourth"].map((title, index) => ({ title, url: `https://example.com/${index}`, source: "Market source", publishedAt: "2026-09-17T12:00:00Z" }));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("shows all headlines in an accessible scroll feed without buttons", async () => {
  await act(async () => root.render(<AssetNews items={items} />));
  const links = container.querySelectorAll<HTMLAnchorElement>(".hub-news-layer");
  expect(links).toHaveLength(4);
  expect(Array.from(links).map(link => link.getAttribute("href"))).toEqual(items.map(item => item.url));
  expect(container.querySelector('[role="region"]')?.getAttribute("tabindex")).toBe("0");
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("details")).toBeNull();
});

it("handles one headline without unnecessary controls", async () => {
  await act(async () => root.render(<AssetNews items={items.slice(0, 1)} />));
  expect(container.querySelectorAll(".hub-news-layer")).toHaveLength(1);
  expect(container.querySelector(".hub-news-pagination")).toBeNull();
});

it("renders nothing when there are no headlines", async () => {
  await act(async () => root.render(<AssetNews items={[]} />));
  expect(container.innerHTML).toBe("");
});
