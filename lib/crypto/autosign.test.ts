// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const signTypedData = vi.fn(async () => ({ signature: "0xsig" }));
const signMessage = vi.fn(async () => ({ signature: "0xmsg" }));
const rpc = vi.fn(async () => "0x1");
vi.mock("@privy-io/node", () => ({ PrivyClient: class { wallets() { return { ethereum: () => ({ signTypedData, signMessage }) }; } } }));
vi.mock("./rpc", () => ({ rpc: (...a: unknown[]) => rpc(...(a as [])) }));

vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app");
vi.stubEnv("PRIVY_APP_SECRET", "secret");
vi.stubEnv("PRIVY_AUTHORIZATION_KEY", "wallet-auth:key");
const { delegatedProvider } = await import("./autosign");
const WALLET = "0xf21219da75e62254aab31ba7c919dd3bd9621790";
const provider = () => delegatedProvider("wallet-1", WALLET, 8453);
/** Exactly what the Permit2 signature looks like on the way to the enclave. */
const permit = { domain: { name: "Permit2", chainId: 8453, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" }, types: { PermitSingle: [{ name: "details", type: "PermitDetails" }] }, primaryType: "PermitSingle", message: { spender: "0x1" } };

beforeEach(() => vi.clearAllMocks());

it("renames primaryType to the primary_type Privy requires", async () => {
  await provider().request({ method: "eth_signTypedData_v4", params: [WALLET, JSON.stringify(permit)] });
  const sent = signTypedData.mock.calls[0][1].params.typed_data as Record<string, unknown>;
  // Privy rejects `primaryType` outright: "Unrecognized key(s) in object".
  expect(sent).not.toHaveProperty("primaryType");
  expect(sent.primary_type).toBe("PermitSingle");
  // Everything else travels untouched, or the signature covers the wrong thing.
  expect(sent.domain).toEqual(permit.domain);
  expect(sent.types).toEqual(permit.types);
  expect(sent.message).toEqual(permit.message);
});

it("accepts the object form as well as the JSON string form", async () => {
  await provider().request({ method: "eth_signTypedData_v4", params: [WALLET, permit] });
  expect((signTypedData.mock.calls[0][1].params.typed_data as Record<string, unknown>).primary_type).toBe("PermitSingle");
});

it("leaves an already-correct primary_type alone", async () => {
  const { primaryType, ...snake } = permit;
  await provider().request({ method: "eth_signTypedData_v4", params: [WALLET, { ...snake, primary_type: primaryType }] });
  const sent = signTypedData.mock.calls[0][1].params.typed_data as Record<string, unknown>;
  expect(sent.primary_type).toBe("PermitSingle");
  expect(sent).not.toHaveProperty("primaryType");
});

it("still refuses to broadcast a raw transaction", async () => {
  await expect(provider().request({ method: "eth_sendTransaction", params: [{}] })).rejects.toThrow(/sponsored operations only/);
});
