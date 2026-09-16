import type { ThemeId } from "../themes";
/**
 * Serializable agent identity. Everything here is system-owned: the name and
 * description come from naming.ts, the voice from personality.ts, tools are all
 * on, and outreach uses Rubicon defaults. Credentials belong in server-side
 * connection storage.
 */
export type NotificationThreshold = "low" | "medium" | "high";
export type NotificationPreferences = {
  /** How often a scheduled run may wake this agent. The cron itself runs every 30 minutes. */
  cadenceMinutes: number;
  /** Minimum relevance a finding must reach before the agent reaches out. */
  threshold: NotificationThreshold;
  /** Cap on reach-outs per UTC day. */
  maxPerDay: number;
};
export type AgentConfig = {
  id: string;
  /** Theme metadata returned by the agent list for its portrait. */
  themes?: ThemeId[];
  badge?: { seed: string; traits: ReturnType<typeof import("../avatar").avatarTraits>; ai: boolean };
  name: string;
  description: string;
  capabilities: string[];
  createdAt: string;
  /** Server-owned. Whether scheduled runs wake this agent. Mirrors the `enabled` column. */
  enabled: boolean;
  notifications: NotificationPreferences;
};
export const CAPABILITIES = [
  { id: "profile", name: "Profile & learning", description: "Read and update this agent’s interests and preferences." },
  { id: "market", name: "Market research", description: "Research stocks, crypto, onchain data and news with Massive, CoinGecko, DexScreener and DefiLlama." },
  { id: "trading", name: "Trade proposals", description: "Propose trades under this agent’s mode and spending limits. Never used by scheduled runs." },
] as const;
/** At most this many agents per user may be enabled for scheduled runs. Enforced again in Postgres. */
export const MAX_ENABLED_AGENTS = 2;
export const CADENCES = [
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Hourly" },
  { minutes: 180, label: "Every 3 hours" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 1440, label: "Once a day" },
] as const;
export const THRESHOLDS: { id: NotificationThreshold; label: string; description: string }[] = [
  { id: "low", label: "Anything interesting", description: "Reach out for anything that touches my thesis or watchlist." },
  { id: "medium", label: "Worth a look", description: "Only when something meaningful changed for what I follow." },
  { id: "high", label: "Only what matters", description: "Only significant moves, news, or opportunities tied to my thesis." },
];
export const MAX_NOTIFICATIONS_PER_DAY = 12;
export const defaultNotifications = (): NotificationPreferences => ({ cadenceMinutes: 60, threshold: "medium", maxPerDay: 3 });
export function defaultAgent(id = "default"): AgentConfig {
  return { id, name: "My agent", description: "", capabilities: CAPABILITIES.map(c => c.id), createdAt: new Date().toISOString(), enabled: false, notifications: defaultNotifications() };
}
/** Fills defaults for configurations stored before a field existed. Never trusts `enabled` from the blob. */
export function normalizeAgent(input: unknown, id: string, enabled = false): AgentConfig {
  const base = defaultAgent(id);
  if (!input || typeof input !== "object") return { ...base, enabled };
  const p = input as Partial<AgentConfig>;
  const n = (p.notifications && typeof p.notifications === "object" ? p.notifications : {}) as Partial<NotificationPreferences>;
  return {
    ...base,
    name: typeof p.name === "string" && p.name.trim() ? p.name : base.name,
    description: typeof p.description === "string" ? p.description : "",
    capabilities: Array.isArray(p.capabilities) ? p.capabilities.filter((c): c is string => typeof c === "string" && CAPABILITIES.some(k => k.id === c)) : base.capabilities,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : base.createdAt,
    enabled,
    notifications: {
      cadenceMinutes: CADENCES.some(c => c.minutes === n.cadenceMinutes) ? n.cadenceMinutes! : base.notifications.cadenceMinutes,
      threshold: THRESHOLDS.some(t => t.id === n.threshold) ? n.threshold! : base.notifications.threshold,
      maxPerDay: Number.isInteger(n.maxPerDay) && n.maxPerDay! >= 1 && n.maxPerDay! <= MAX_NOTIFICATIONS_PER_DAY ? n.maxPerDay! : base.notifications.maxPerDay,
    },
  };
}
export const agentSelectionKey = (userId: string) => `rubicon:active-agent:${encodeURIComponent(userId)}`;
