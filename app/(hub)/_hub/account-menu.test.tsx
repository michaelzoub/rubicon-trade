// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("./identity-aura", () => ({ IdentityAura: () => null }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({}), useWallets: () => ({ wallets: [] }) }));
vi.mock("./wallets", () => ({ useLinkedWallets: () => [] }));
vi.mock("../../providers", () => ({ usePrivyConfigured: () => true }));
import { BaseSwitch, type WalletEntry } from "./account-menu";

it.each([false, true])("switches the selected wallet and reports success or rejection (reject=%s)", async reject => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const switchToBase = vi.fn(async () => { if (reject) throw new Error("User rejected the network switch."); });
  const wallet: WalletEntry = { address: `0x${"11".repeat(20)}`, kind: "Embedded wallet", connected: true, switchToBase };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<BaseSwitch wallet={wallet} />));
    expect(container.textContent).toContain("Switch wallet to Base");
    await act(async () => container.querySelector("button")!.click());
    expect(switchToBase).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(reject ? "User rejected" : "Wallet is now on Base");
    if (!reject) expect(container.textContent).toContain("Existing funds are not bridged");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
