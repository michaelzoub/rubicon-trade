// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const { switchChain } = vi.hoisted(() => ({ switchChain: vi.fn(async () => {}) }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: [{ address: `0x${"11".repeat(20)}`, switchChain }] }) }));
import { DepositFunds } from "./deposit-funds";

it("defaults deposits to Base and can switch back to Base from another network", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<DepositFunds />));
    const select = container.querySelector("select")!;
    expect(select.value).toBe("8453");
    await act(async () => { select.value = "1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.textContent).toContain("Send native USDC on Ethereum");
    await act(async () => { select.value = "8453"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Switch wallet to Base")!.click());
    expect(switchChain).toHaveBeenCalledWith(8453);
    expect(container.textContent).toContain("Wallet switched to Base.");
    expect(container.textContent).toContain("switching here does not bridge funds");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
