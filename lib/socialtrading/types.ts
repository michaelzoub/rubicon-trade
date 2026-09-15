import type { InvestingProfile } from "./profile";

export type AssetKind = "stock" | "crypto";
export type Asset = {
  id: string; symbol: string; name: string; kind: AssetKind;
  price: number | null; change: number | null; asOf: string | null;
  source: "Massive" | "CoinGecko" | "Robinhood"; marketCap?: number; volume?: number;
  logo?: string; description?: string; themes: string[]; reason?: string; score?: number;
  /** Crypto only: verified token contract per supported EVM chain id, from CoinGecko platforms. */
  contracts?: Record<string, string>;
  /** Short personalization label, e.g. "Strong match for your energy thesis". */
  label?: string; labelTone?: "match" | "related" | "explore" | "ignored" | "emerging" | "muted";
  chart: { time: number; price: number }[];
  news: { title: string; url: string; publishedAt: string; source?: string }[];
};
export type SignalAction = "opened" | "ignored" | "dismissed" | "followup" | "watched" | "removed" | "approved" | "rejected";
export type LearnedInterest = { id: string; weight: number; confidence: number; count: number; updatedAt: string };
export type ActivityKind = "learning" | "profile" | "trade" | "agent";
export type ActivityEvent = { id: string; at: string; kind: ActivityKind; text: string; detail?: string; tradeId?: string };

export type ProfileChange = { field: string; label: string; before?: string; after?: string };
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "assets"; assets: Asset[]; title?: string }
  | { type: "asset"; asset: Asset }
  | { type: "profile_update"; changes: ProfileChange[] }
  | { type: "explanation"; reasons: string[]; target?: string }
  | { type: "trade"; tradeId: string }
  | { type: "news"; items: Asset["news"]; title?: string }
  | { type: "notice"; text: string };
export type Message = { id: string; role: "user" | "assistant"; at: string; parts: MessagePart[]; status?: "streaming" | "done" | "error";
  /** Set when a scheduled run reached out rather than replying to the user. */
  via?: "background" };
/** One conversation thread with an agent. Plans cap how many a user may keep across all agents. */
export type Chat = { id: string; title: string; createdAt: string; updatedAt: string; messages: Message[] };

export type TradeStatus = "blocked" | "approval_required" | "reserved" | "submitted" | "confirmed" | "rejected" | "failed" | "unknown";
/** Who created the intent. Agent trades face the agent's mode and limits; user trades are the user's own decision. Missing means agent (legacy). */
export type TradeInitiator = "agent" | "user";
export type TradeIntent = {
  crypto?: import("@/lib/crypto/types").CryptoTrade;
  initiator?: TradeInitiator;
  id: string; asset: { id: string; symbol: string; name: string; kind: AssetKind }; side: "buy" | "sell"; value: number;
  estimatedPrice: number | null; estimatedQuantity: number | null; resultingExposure: number | null;
  createdAt: string; status: TradeStatus;
  reasoning: string;
  policy: { allowed: boolean; reason: string; at: string };
  approval?: { decision: "approved" | "rejected"; at: string };
  brokerage?: { provider: "robinhood"; status: "not_connected" | "pending" | "submitted" | "filled" | "rejected" | "unknown"; orderId?: string; at: string; detail?: string };
};
export type HubState = {
  agent?: import("./agents/config").AgentConfig;
  revision: number; profile: InvestingProfile; dislikes: string[]; preferences: string[];
  inferred: LearnedInterest[]; signals: { id: string; action: SignalAction; target: string; at: string }[];
  chats: Chat[]; events: ActivityEvent[]; trades: TradeIntent[];
  brokerage?: { provider: "robinhood"; connected: boolean; buyingPower?: number | null; checkedAt?: string };
};

/** Server-sent events streamed by the chat route. */
export type ChatEvent =
  | { type: "message"; id: string; at: string }
  | { type: "text"; text: string }
  | { type: "part"; part: Exclude<MessagePart, { type: "text" }> }
  | { type: "status"; text: string }
  | { type: "state"; state: HubState }
  | { type: "account"; account: import("./plans").AccountSummary }
  | { type: "done" }
  | { type: "error"; message: string };
