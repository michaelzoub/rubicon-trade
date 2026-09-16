import { isThemeId } from "./themes";
import "server-only";
import { PrivyClient } from "@privy-io/node";
import { serviceClient } from "@/lib/supabase";
import { readProfile, type InvestingProfile } from "./profile";
import { defaultAgent, normalizeAgent, type AgentConfig } from "./agents/config";
import { generatedAgentDescription, generatedAgentName } from "./agents/naming";
import { CHAT_ID, newChat, normalizeChats } from "./chats";
import { profileViolation, violationMessage, type LimitViolation } from "./limits";
import { DEFAULT_PLAN, LIMIT_COPY, type LimitKey, type PlanLimits } from "./plans";
import type { HubState } from "./types";

/** Machine-readable detail beside the message, so clients can tell a plan limit from a transient failure. */
export type HubErrorDetails = { code: "limit"; limit: LimitKey; remedy: string } | { code: "credits" };
export class HubError extends Error { constructor(public status: number, message: string, public details?: HubErrorDetails) { super(message); } }
/** A plan cap the request would cross. 422: the request is well-formed, the plan says no. */
export class LimitError extends HubError {
  constructor(public violation: LimitViolation) { super(422, violation.message, { code: "limit", limit: violation.key, remedy: LIMIT_COPY[violation.key].remedy }); }
}
export const assertWithin = (violation: LimitViolation | null) => { if (violation) throw new LimitError(violation); };
export const creditsError = (message = "You’re out of credits, so your agent can’t run right now. Your profile, chats, and history stay exactly as they are.") => new HubError(402, message, { code: "credits" });

const LIMIT_KEYS: LimitKey[] = ["follows", "preferenceItems", "learnedAssets", "thesisChars", "chats", "agents", "enabledAgents"];
/** Postgres is the last gate: its `LIMIT_*` and agent-cap exceptions become the same errors the server raises itself. */
export function translateDatabaseError(error: { message?: string; hint?: string | null } | null | undefined, limits: PlanLimits): HubError | null {
  const message = error?.message ?? "";
  const key = message.startsWith("LIMIT_") ? LIMIT_KEYS.find(k => message.startsWith(`LIMIT_${k}`)) : message.includes("AGENT_COUNT_LIMIT") ? "agents" : message.includes("AGENT_LIMIT") ? "enabledAgents" : undefined;
  if (!key) return null;
  const limit = Number(error?.hint?.match(/\d+/)?.[0] ?? limits[key]);
  return new LimitError({ key, used: limit, limit, message: violationMessage(key, limit, key === "agents" || key === "chats" ? "Your plan" : undefined) });
}
export async function authenticate(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HubError(401, "Sign in to continue.");
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID, appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new HubError(503, "Sign-in is not configured.");
  try { return (await new PrivyClient({ appId, appSecret }).utils().auth().verifyAccessToken(token)).user_id; }
  catch { throw new HubError(401, "Your session expired. Sign in again."); }
}
export function database() {
  try { return serviceClient(); } catch { throw new HubError(503, "Your private workspace is not connected yet. Please try again after setup."); }
}
/** Fills defaults for state saved before a field existed. Legacy `messages` become one chat. */
export function normalizeState(raw: Record<string, unknown>, agentId: string, enabled: boolean, revision: number, userId?: string): HubState {
  const { messages: _legacy, ...rest } = raw as Record<string, unknown> & { messages?: unknown };
  // Database rows can predate fields added to the profile schema. Normalize
  // the persisted profile at the server boundary so chat/runtime code never
  // receives a partially-shaped InvestingProfile (for example, without
  // investorAnswers.opportunityDrivers).
  const rawProfile = rest.profile && typeof rest.profile === "object" ? rest.profile as Record<string, unknown> : {};
  const profileUserId = userId ?? (typeof rawProfile.userId === "string" ? rawProfile.userId : "");
  const profile = readProfile(JSON.stringify({ ...rawProfile, userId: profileUserId }), profileUserId);
  return { ...(rest as unknown as HubState), profile, chats: normalizeChats(raw), agent: normalizeAgent(raw.agent, agentId, enabled), revision };
}
export async function loadState(userId: string, agentId = "default"): Promise<HubState | null> {
  const { data, error } = await database().from("socialtrading_agents").select("state,revision,enabled").eq("user_id", userId).eq("agent_id", agentId).maybeSingle();
  if (error) throw new HubError(503, "Your private workspace could not be loaded.");
  if (!data) return null;
  return normalizeState(data.state, agentId, data.enabled === true, data.revision, userId);
}
/** Every agent the user owns, oldest first, with the column-backed enabled flag. */
export async function listAgents(userId: string): Promise<AgentConfig[]> {
  const { data, error } = await database().from("socialtrading_agents").select("agent_id,enabled,agent:state->agent,themes:state->profile->themes").eq("user_id", userId).order("updated_at", { ascending: true });
  if (error) throw new HubError(503, "Your agents could not be loaded.");
  return (data ?? []).map(row => ({ ...normalizeAgent(row.agent, row.agent_id, row.enabled === true), themes: Array.isArray(row.themes) ? row.themes.filter(isThemeId) : [] }));
}
/** Flips scheduled runs for one agent. Postgres enforces the per-user cap; this only translates the outcome. */
export async function setAgentEnabled(userId: string, agentId: string, enabled: boolean, limits: PlanLimits) {
  const { data, error } = await database().rpc("socialtrading_agent_set_enabled", { p_user_id: userId, p_agent_id: agentId, p_enabled: enabled });
  if (error) throw new HubError(503, "This agent could not be updated. Please retry.");
  if (data === null) throw new HubError(404, "Agent not found.");
  if (data === false) throw new LimitError({ key: "enabledAgents", used: limits.enabledAgents, limit: limits.enabledAgents, message: `Only ${limits.enabledAgents} agents can run at once on this plan. Pause another agent first.` });
}
/** Removes an agent and everything it owns. The last agent stays so the hub always has somewhere to land. */
export async function deleteAgent(userId: string, agentId: string) {
  const agents = await listAgents(userId);
  if (!agents.some(a => a.id === agentId)) throw new HubError(404, "Agent not found.");
  if (agents.length <= 1) throw new HubError(400, "Keep at least one agent. Create another before deleting this one.");
  const { error } = await database().from("socialtrading_agents").delete().eq("user_id", userId).eq("agent_id", agentId);
  if (error) throw new HubError(503, "This agent could not be deleted. Please retry.");
}
export async function initialize(userId: string, input: InvestingProfile, limits: PlanLimits, userName?: string) {
  const profile = readProfile(JSON.stringify(input), userId);
  if (!profile.completedAt) throw new HubError(400, "Complete your investing profile first.");
  assertWithin(profileViolation(null, { profile, dislikes: [], preferences: [] }, limits));
  const themes = profile.themes.map(t => t[0].toUpperCase() + t.slice(1)).join(" × ");
  const agent = { ...defaultAgent(), name: generatedAgentName(profile, userName, userId), description: generatedAgentDescription(profile) };
  const state: HubState = { agent, revision: 0, profile, dislikes: [], preferences: [], inferred: [], signals: [], trades: [], chats: [newChat()], brokerage: { provider: "robinhood", connected: false },
    events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), kind: "profile", text: "Your agent started with your investing worldview", detail: [themes, profile.interests.length ? `Watching ${profile.interests.map(i => i.symbol || i.name).slice(0, 6).join(", ")}` : ""].filter(Boolean).join(". ") || undefined }] };
  const { error } = await database().from("socialtrading_agents").upsert({ user_id: userId, agent_id: "default", revision: 0, state }, { onConflict: "user_id,agent_id", ignoreDuplicates: true });
  if (error) throw translateDatabaseError(error, limits) ?? new HubError(503, "Your profile could not be saved.");
  return (await loadState(userId))!;
}
/** Inserts a brand-new agent. Postgres enforces the per-plan agent and chat caps; this translates the outcome. */
export async function insertAgent(userId: string, state: HubState, limits: PlanLimits) {
  const { error } = await database().from("socialtrading_agents").insert({ user_id: userId, agent_id: state.agent!.id, state, revision: 0, enabled: false });
  if (error) throw translateDatabaseError(error, limits) ?? new HubError(503, "Your agent could not be created.");
}
/** Per chat. Older turns fall off; the chat itself stays. */
export const MAX_MESSAGES = 200;
export async function saveState(userId: string, state: HubState, limits?: PlanLimits) {
  state.profile.updatedAt = new Date().toISOString();
  for (const chat of state.chats) if (chat.messages.length > MAX_MESSAGES) chat.messages.splice(0, chat.messages.length - MAX_MESSAGES);
  delete (state as HubState & { messages?: unknown }).messages;
  const { data, error } = await database().rpc("socialtrading_agent_save", { p_agent_id: state.agent?.id ?? "default", p_user_id: userId, p_revision: state.revision, p_state: state });
  if (error) throw translateDatabaseError(error, limits ?? DEFAULT_PLAN.limits) ?? new HubError(503, "Your changes could not be saved. Please retry.");
  if (!data) throw new HubError(409, "Your workspace changed in another tab. Refresh before trying again.");
  state.revision++;
  return state;
}
export function failure(error: unknown) {
  if (error instanceof HubError) return Response.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
  if (error instanceof Error && "code" in error && (error as { code: unknown }).code === "credits") return failure(creditsError(error.message));
  return Response.json({ error: "This request could not be completed. Please try again." }, { status: 502 });
}
export async function bodyOf(request: Request) {
  const raw = await request.text();
  if (raw.length > 32_000) throw new HubError(413, "This message is too long.");
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; } catch { throw new HubError(400, "Invalid request."); }
}

export function requestedChat(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !CHAT_ID.test(value)) throw new HubError(400, "Invalid chat.");
  return value;
}
export function requestedAgent(value: unknown): string {
  if (value === undefined || value === null) return "default";
  if (typeof value !== "string" || !/^(default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(value)) throw new HubError(400, "Invalid agent.");
  return value;
}
