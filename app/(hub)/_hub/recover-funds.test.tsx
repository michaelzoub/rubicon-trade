// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_ACCOUNT, PREVIEW_STATE, PREVIEW_WALLET } from "../../preview/fixture";

const sendTransaction = vi.fn(async ({ method }: { method: string }) =>
  method === "eth_chainId" ? "0x2105" : method === "eth_accounts" ? [PREVIEW_WALLET] : `0x${"ab".repeat(32)}`);
const switchChain = vi.fn();
vi.mock("@privy-io/react-auth", () => ({
  useSign7702Authorization: () => ({ signAuthorization: vi.fn() }),
  usePrivy: () => ({ getAccessToken: async () => "token", ready: true, authenticated: true, user: { id: "u", linkedAccounts: [] }, connectWallet: vi.fn() }),
  useWallets: () => ({ ready: true, wallets: [{ address: PREVIEW_WALLET, walletClientType: "privy", switchChain, getEthereumProvider: async () => ({ request: sendTransaction }) }] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/profile" }));
import { HubProvider } from "./hub-provider";
import { RecoverFunds } from "./recover-funds";

const stranded = { chainId: 8453, chainName: "Base", wallet: PREVIEW_WALLET, token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, balance: "4250000", display: "4.25", kind: "usdc" as const };
const posted: Record<string, unknown>[] = [];
const api = {
  crypto: async (_t: unknown, _r: number, body: Record<string, unknown>) => {
    posted.push(body);
    if (body.action === "holdings") return { holdings: [stranded] };
    if (body.action === "withdraw") return { transaction: { chainId: 8453, from: PREVIEW_WALLET, to: stranded.token, data: "0xa9059cbb", value: "0", nonce: "0x3" } };
    return { state: PREVIEW_STATE };
  },
};
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  posted.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)", media: q, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const setValue = async (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const render = async () => { await act(async () => root.render(<HubProvider userId="u" name="M" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT} api={api}><RecoverFunds /></HubProvider>)); await act(async () => { await new Promise(r => setTimeout(r, 50)); }); };
const inputs = () => Array.from(container.querySelectorAll<HTMLInputElement>(".hub-recover-form input"));
const button = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.includes(text));

it("shows holdings on Base without being asked", async () => {
  await render();
  expect(container.textContent).toContain("4.25 USDC");
  expect(container.textContent).toContain("on Base");
  expect(posted[0]).toMatchObject({ action: "holdings" });
});

it("will not send before an address that could exist has been typed", async () => {
  await render();
  await act(async () => button("Send out")!.click());
  expect((button("Review this transfer") as HTMLButtonElement).disabled).toBe(true);
  await setValue(inputs()[1], "not-an-address");
  expect(container.textContent).toContain("doesn’t look like a wallet address");
  expect((button("Review this transfer") as HTMLButtonElement).disabled).toBe(true);
});

it("refuses an amount larger than the balance", async () => {
  await render();
  await act(async () => button("Send out")!.click());
  await setValue(inputs()[1], `0x${"22".repeat(20)}`);
  await setValue(inputs()[0], "9999");
  expect(container.textContent).toContain("up to 4.25 USDC");
  expect((button("Review this transfer") as HTMLButtonElement).disabled).toBe(true);
});

it("names the amount, network and destination before anything is signed", async () => {
  await render();
  await act(async () => button("Send out")!.click());
  await setValue(inputs()[1], `0x${"22".repeat(20)}`);
  await act(async () => button("Review this transfer")!.click());
  const confirm = container.querySelector(".hub-recover-confirm")!;
  expect(confirm.textContent).toContain("Send 4.25 USDC on Base");
  expect(confirm.textContent).toContain("0x2222…2222");
  expect(confirm.textContent).toContain("cannot be undone");
  // Nothing has been prepared or sent merely by reviewing it.
  expect(posted.some(p => p.action === "withdraw")).toBe(false);
  expect(sendTransaction).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
});

it("sends only after the explicit confirmation, on the right network", async () => {
  await render();
  await act(async () => button("Send out")!.click());
  await setValue(inputs()[1], `0x${"22".repeat(20)}`);
  await act(async () => button("Review this transfer")!.click());
  await act(async () => button("Yes, send it")!.click());
  expect(posted.find(p => p.action === "withdraw")).toMatchObject({ chainId: 8453, wallet: PREVIEW_WALLET, to: `0x${"22".repeat(20)}`, amount: "4250000" });
  expect(switchChain).toHaveBeenCalledWith(8453);
  expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_sendTransaction" }));
  expect(container.textContent).toContain("Sent.");
});
