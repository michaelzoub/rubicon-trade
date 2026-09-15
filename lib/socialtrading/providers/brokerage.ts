import "server-only";
import { createDecipheriv } from "node:crypto";
import type { AssetKind } from "../types";
import { database } from "../server";

/** Brokerage = execution and account source of truth. Robinhood today; the
 * interface exists so another brokerage can replace or supplement it. */
export type BrokerageStatus = { connected: boolean; buyingPower?: number | null; checkedAt: string; detail?: string };
export type BrokerageOrder = { symbol: string; kind: AssetKind; side: "buy" | "sell"; notionalUsd: number; clientId: string };
export type BrokerageResult = { status: "submitted" | "filled" | "rejected" | "unknown"; orderId?: string; detail?: string };
export interface Brokerage {
  readonly provider: "robinhood";
  status(userId: string): Promise<BrokerageStatus>;
  placeOrder(userId: string, order: BrokerageOrder): Promise<BrokerageResult>;
}
export class BrokerageNotConnected extends Error { constructor() { super("Robinhood is not connected for this account."); } }

/** Minimal MCP (Streamable HTTP, JSON-RPC 2.0) client. */
async function mcp<T>(url: string, token: string, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(url, {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  if (!response.ok) throw new Error(`Robinhood MCP responded ${response.status}.`);
  const text = await response.text();
  // Streamable HTTP may answer as JSON or as a single SSE frame.
  const json = text.trimStart().startsWith("{") ? text : text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
  const parsed = JSON.parse(json) as { result?: T; error?: { message: string } };
  if (parsed.error) throw new Error(parsed.error.message);
  return parsed.result as T;
}

/** Per-user tokens are stored encrypted (AES-256-GCM, key from the server env).
 * The connect flow that writes them is separate; nothing here mints tokens. */
async function userToken(userId: string): Promise<string | null> {
  const key = process.env.SOCIALTRADING_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) return null;
  const { data } = await database().from("socialtrading_connections").select("encrypted_tokens").eq("user_id", userId).maybeSingle();
  if (!data?.encrypted_tokens) return null;
  try {
    const [iv, tag, body] = String(data.encrypted_tokens).split(".").map(part => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    decipher.setAuthTag(tag);
    const tokens = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as { access_token?: string; expires_at?: string };
    if (!tokens.access_token || (tokens.expires_at && Date.parse(tokens.expires_at) < Date.now())) return null;
    return tokens.access_token;
  } catch { return null; }
}

type ToolResult = { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
function parseOrder(result: ToolResult): BrokerageResult {
  const text = result.content?.map(c => c.text ?? "").join("\n") ?? "";
  let payload: Record<string, unknown> = result.structuredContent ?? {};
  if (!Object.keys(payload).length) { try { payload = JSON.parse(text); } catch { /* free text */ } }
  if (result.isError) return { status: "rejected", detail: text.slice(0, 500) || "Robinhood rejected the order." };
  const orderId = typeof payload.id === "string" ? payload.id : typeof payload.order_id === "string" ? payload.order_id : undefined;
  const state = String(payload.state ?? payload.status ?? "").toLowerCase();
  // Only an explicit fill from Robinhood counts as confirmed. Everything else stays open.
  if (orderId && /^(filled|executed|complete)/.test(state)) return { status: "filled", orderId, detail: text.slice(0, 500) };
  if (/reject|cancel|fail/.test(state)) return { status: "rejected", orderId, detail: text.slice(0, 500) };
  if (orderId) return { status: "submitted", orderId, detail: text.slice(0, 500) };
  return { status: "unknown", detail: text.slice(0, 500) || "Robinhood did not return an order reference." };
}

export const robinhood: Brokerage = {
  provider: "robinhood",
  async status(userId) {
    const checkedAt = new Date().toISOString();
    const url = process.env.ROBINHOOD_MCP_URL;
    if (!url) return { connected: false, checkedAt, detail: "Robinhood Agentic Trading is not configured." };
    const token = await userToken(userId);
    if (!token) return { connected: false, checkedAt };
    try {
      const tools = await mcp<{ tools: { name: string }[] }>(url, token, "tools/list");
      return { connected: tools.tools.length > 0, checkedAt };
    } catch (error) { return { connected: false, checkedAt, detail: error instanceof Error ? error.message : "Robinhood is unreachable." }; }
  },
  async placeOrder(userId, order) {
    const url = process.env.ROBINHOOD_MCP_URL;
    const token = url ? await userToken(userId) : null;
    if (!url || !token) throw new BrokerageNotConnected();
    const result = await mcp<ToolResult>(url, token, "tools/call", {
      name: process.env.ROBINHOOD_ORDER_TOOL ?? "place_order",
      arguments: { symbol: order.symbol, asset_type: order.kind === "crypto" ? "crypto" : "equity", side: order.side, notional: order.notionalUsd, type: "market", time_in_force: "gfd", client_order_id: order.clientId },
    });
    return parseOrder(result);
  },
};

export const brokerage: Brokerage = robinhood;
