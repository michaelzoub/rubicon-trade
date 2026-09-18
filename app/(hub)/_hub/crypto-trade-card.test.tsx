// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_STATE, PREVIEW_WALLET } from "../../preview/fixture";

const mocks = vi.hoisted(() => ({ crypto: vi.fn(), request: vi.fn(), sendBatch: vi.fn(), switchChain: vi.fn(), signAuthorization: vi.fn(), wallets: vi.fn() }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ connectWallet: vi.fn() }),
  useWallets: () => ({ wallets: mocks.wallets() }),
  useSign7702Authorization: () => ({ signAuthorization: mocks.signAuthorization }),
}));
vi.mock("./hub-provider", () => ({ useHub: () => ({ state: PREVIEW_STATE, crypto: mocks.crypto, busy: false }) }));
vi.mock("@/lib/crypto/gasless", () => ({ sendSwapBatch: mocks.sendBatch, recoverSwapOperation: vi.fn() }));
import { CryptoTradeCard } from "./crypto-trade-card";

let container: HTMLDivElement, root: Root;
const hash = `0x${"ab".repeat(32)}`, userOpHash = `0x${"cd".repeat(32)}`;
const baseTrade = structuredClone(PREVIEW_STATE.trades[1]);
const trade = { ...baseTrade, initiator: "user" as const, status: "reserved" as const, value: 0.6, crypto: {
  ...baseTrade.crypto!, request: { ...baseTrade.crypto!.request, amount: "600000", tokenOut: "0xb20000000000000000000078ee7ce2fe4908108c" },
  outputAmount: "272775", minimumOutput: "271411",
  display: { tokenIn: { symbol: "USDC", decimals: 6 }, tokenOut: { symbol: "NVDAc", decimals: 8 } },
} };
const batch = { chainId: 8453, sender: PREVIEW_WALLET, calls: [], callData: "0x", paymaster: "circle-usdc" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.wallets.mockReturnValue([{ address: PREVIEW_WALLET, switchChain: mocks.switchChain, getEthereumProvider: async () => ({ request: mocks.request }) }]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  mocks.request.mockImplementation(async ({ method }) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_accounts") return [PREVIEW_WALLET];
    if (method === "eth_call") return `0x${1430308n.toString(16)}`;
    if (method === "eth_getBalance") return "0x0";
    throw new Error(`Unexpected wallet request: ${method}`);
  });
  mocks.crypto.mockImplementation(async ({ action }) => {
    if (action === "prepare") return { quoteId: "fresh-quote", expiresAt: Date.now() + 60000 };
    if (action === "authorize") return { batch, step: "swap", expiresAt: Date.now() + 60000 };
    return {};
  });
  mocks.sendBatch.mockImplementation(async ({ onSubmitted }) => { onSubmitted(userOpHash); return { userOpHash, hash }; });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function buy() {
  await act(async () => root.render(<CryptoTradeCard trade={trade} />));
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Review & sign in wallet")!;
  await act(async () => button.click());
}
it("completes the quote → authorize → batch → submitted → status flow with USDC and zero ETH", async () => {
  await buy();
  expect(mocks.crypto.mock.calls.map(([body]) => body.action)).toEqual(["prepare", "authorize", "submitted", "status"]);
  expect(mocks.crypto).toHaveBeenCalledWith({ action: "authorize", tradeId: trade.id, quoteId: "fresh-quote", signature: undefined });
  expect(mocks.sendBatch).toHaveBeenCalledWith(expect.objectContaining({ batch, signAuthorization: mocks.signAuthorization }));
  expect(mocks.crypto).toHaveBeenCalledWith({ action: "submitted", tradeId: trade.id, hash, userOpHash });
  expect(mocks.request.mock.calls.map(([args]) => args.method)).not.toContain("eth_signTypedData_v4");
  expect(container.textContent).toContain("1.430308 USDC · 0 ETH on Base");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("shows a batch simulation failure and stops before signing or submitting", async () => {
  mocks.crypto.mockImplementation(async ({ action }) => {
    if (action === "prepare") return { quoteId: "fresh-quote", expiresAt: Date.now() + 60000 };
    throw new Error("Purchase simulation failed. Request a fresh quote.");
  });
  await buy();
  expect(mocks.sendBatch).not.toHaveBeenCalled();
  expect(mocks.crypto.mock.calls.map(([body]) => body.action)).toEqual(["prepare", "authorize"]);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("can’t be bought");
});

it("uses Privy's updated wallet after an embedded network switch", async () => {
  const staleRequest = vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x1" : [PREVIEW_WALLET]);
  const staleWallet = { address: PREVIEW_WALLET, switchChain: mocks.switchChain, getEthereumProvider: async () => ({ request: staleRequest }) };
  const updatedWallet = { ...staleWallet, getEthereumProvider: async () => ({ request: mocks.request }) };
  mocks.wallets.mockReturnValue([staleWallet]);
  await buy();
  expect(mocks.switchChain).toHaveBeenCalledWith(8453);
  expect(mocks.crypto).not.toHaveBeenCalled();
  // Privy publishes a new wallet object; the original factory stays on Ethereum.
  mocks.wallets.mockReturnValue([updatedWallet]);
  await act(async () => root.render(<CryptoTradeCard trade={trade} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  expect(mocks.crypto.mock.calls.map(([body]) => body.action)).toEqual(["prepare", "authorize", "submitted", "status"]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelectorAll(".hub-trade-actions button")).toHaveLength(1);
  expect(container.querySelector(".hub-trade-byline")).toBeNull();
  expect(container.querySelector(".hub-trade-status")).toBeNull();
});

it("keeps submitted purchases simple without exposing addresses or transaction references", async () => {
  localStorage.setItem(`rubicon:swap:${PREVIEW_STATE.profile.userId}:${trade.id}:${trade.crypto.step ?? "next"}:operation`, userOpHash);
  await act(async () => root.render(<CryptoTradeCard simple trade={{ ...trade, status: "unknown", crypto: { ...trade.crypto, phase: "issued", hash, detail: `Waiting for two block confirmations: ${hash}`, history: [{ step: "swap", hash, result: "confirmed" }] } }} />));
  expect(container.textContent).toContain("Making it yours");
  expect(container.textContent).not.toContain(hash);
  expect(container.textContent).not.toContain(userOpHash);
  expect(container.textContent).not.toContain(PREVIEW_WALLET);
  expect(container.querySelector("details")).toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(1);
  await act(async () => container.querySelector("button")!.click());
  expect(mocks.crypto).toHaveBeenCalledWith({ action: "status", tradeId: trade.id });
});
