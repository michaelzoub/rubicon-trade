import "server-only";
import { limitsError, PERMISSIONS, type InvestingProfile, type Interest, type Permission } from "../profile";
import { isThemeId, THEMES, type ThemeId } from "../themes";
import { inferredThemes, personalize, recordEvent, relevance, themeName } from "../personalization";
import { agentServices, type AgentServices } from "../agents/services";
import { describeLimits, proposeTrade } from "../trades";
import { DEFAULT_PLAN, followedAssets, LIMIT_COPY, type PlanLimits } from "../plans";
import type { Asset, HubState, MessagePart, ProfileChange, TradeIntent } from "../types";

/** OpenAI-style tool schemas (what OpenRouter forwards to the model). */
export const TOOL_SCHEMAS = [
  { type: "function", function: { name: "get_profile", description: "Read the user's full investing profile: thesis, themes, watchlist, explicit preferences, dislikes, agent mode, limits, and what has been inferred from behavior.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "update_profile", description: "Change the user's explicit profile because they asked. Use for: new interests or themes, watching/unwatching assets, things to show less of, thesis edits, agent mode, or spending limits. Only call when the user clearly asked for the change.", parameters: { type: "object", properties: {
    thesis: { type: "string", description: "Replacement thesis text, only if the user asked to change it." },
    add_themes: { type: "array", items: { type: "string", enum: THEMES.map(t => t.id) } }, remove_themes: { type: "array", items: { type: "string", enum: THEMES.map(t => t.id) } },
    add_interests: { type: "array", description: "Assets or ideas to watch.", items: { type: "object", properties: { symbol: { type: "string" }, name: { type: "string" }, kind: { type: "string", enum: ["stock", "crypto", "custom"] } }, required: ["name", "kind"] } },
    remove_interests: { type: "array", items: { type: "string" }, description: "Symbols or names to stop watching." },
    add_preferences: { type: "array", items: { type: "string" }, description: "Topics the user said they care about, e.g. 'nuclear'." }, remove_preferences: { type: "array", items: { type: "string" } },
    add_dislikes: { type: "array", items: { type: "string" }, description: "Things to show less of, e.g. 'memecoins'." }, remove_dislikes: { type: "array", items: { type: "string" } },
    permission: { type: "string", enum: ["notify", "approve", "automatic"], description: "Agent mode." },
    limits: { type: "object", properties: { perTrade: { type: "string" }, daily: { type: "string" }, weekly: { type: "string" } }, description: "USD amounts as strings with up to two decimals. Include only the fields the user changed." },
  } } } },
  { type: "function", function: { name: "search_assets", description: "Search stocks or crypto by name, ticker, or idea. Results are ranked for this user and include price, change, and a relevance label.", parameters: { type: "object", properties: { query: { type: "string" }, kind: { type: "string", enum: ["stock", "crypto"] } }, required: ["query", "kind"] } } },
  { type: "function", function: { name: "get_asset", description: "Full detail for one asset: price, change, chart, recent news, market facts, and why it matters to this user. Use a ticker for stocks and a CoinGecko id (e.g. 'bitcoin') for crypto.", parameters: { type: "object", properties: { id: { type: "string" }, kind: { type: "string", enum: ["stock", "crypto"] }, show_card: { type: "boolean", description: "Show the asset card inline (default true)." }, show_news: { type: "boolean", description: "Show recent news inline (default false)." } }, required: ["id", "kind"] } } },
  { type: "function", function: { name: "list_ipos", description: "Recent and upcoming IPOs, ranked for this user.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "trending_crypto", description: "Crypto assets trending right now, ranked and filtered for this user.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "explain_relevance", description: "Explain, from the user's own profile and behavior, why an asset was or would be surfaced. Shows an explanation card.", parameters: { type: "object", properties: { id: { type: "string" }, kind: { type: "string", enum: ["stock", "crypto"] } }, required: ["id", "kind"] } } },
  { type: "function", function: { name: "propose_trade", description: "Propose a trade. The server checks the user's mode and limits deterministically and shows a confirmation card. Never claim a trade happened; report what the tool returns.", parameters: { type: "object", properties: { id: { type: "string", description: "Ticker or CoinGecko id." }, kind: { type: "string", enum: ["stock", "crypto"] }, side: { type: "string", enum: ["buy", "sell"] }, value_usd: { type: "number" }, reasoning: { type: "string", description: "One or two sentences tying the trade to the user's thesis." } }, required: ["id", "kind", "side", "value_usd", "reasoning"] } } },
  { type: "function", function: { name: "recall_activity", description: "Recent activity and learning events: what the agent inferred, profile changes, trades.", parameters: { type: "object", properties: { limit: { type: "number" } } } } },
] as const;

export type ToolOutcome = { result: unknown; parts: MessagePart[] };
type Args = Record<string, unknown>;
const str = (v: unknown, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : "";
const list = (v: unknown, max = 20) => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map(s => s.trim().slice(0, 100)).slice(0, max) : [];

export function profileSummary(state: HubState) {
  const p = state.profile;
  return {
    thesis: p.thesis, themes: p.themes.map(themeName), watching: p.interests.map(i => i.symbol || i.name),
    preferences: state.preferences, showLess: state.dislikes, mode: PERMISSIONS[p.permission], permissions: describeLimits(p),
    inferred: state.inferred.filter(i => i.confidence >= .25).sort((a, b) => Math.abs(b.weight * b.confidence) - Math.abs(a.weight * a.confidence)).slice(0, 12)
      .map(i => ({ id: isThemeId(i.id) ? themeName(i.id) : i.id, interest: `${Math.round(i.weight * 100)}%`, confidence: `${Math.round(i.confidence * 100)}%`, signals: i.count })),
    inferredThemes: inferredThemes(state).map(themeName),
    brokerage: state.brokerage?.connected ? "Robinhood connected" : "Robinhood not connected: approved orders wait until the user connects.",
  };
}

const compactAsset = (a: Asset) => ({ id: a.id, symbol: a.symbol, name: a.name, kind: a.kind, price: a.price, changePct: a.change === null ? null : Math.round(a.change * 100) / 100, marketCap: a.marketCap, label: a.label, why: a.reason, themes: a.themes.slice(0, 5), asOf: a.asOf });
const rank = (assets: Asset[], state: HubState) => assets.map(a => personalize(a, state)).filter(a => (a.score ?? 0) > -5).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
async function detail(id: string, kind: Asset["kind"], state: HubState, services: AgentServices) {
  const asset = kind === "crypto" ? await services.crypto.detail(id.toLowerCase()) : await services.stocks.detail(id.toUpperCase());
  return personalize(asset, state);
}

export type ProfileUpdateOutcome = { changes: ProfileChange[]; /** What could not be added and why, in words the model can relay. */ skipped: string[] };

/** Applies an explicit profile change under the plan's caps. Additions past a cap are skipped, never truncated silently. */
export function applyProfileUpdate(state: HubState, args: Args, limits: PlanLimits = DEFAULT_PLAN.limits): ProfileUpdateOutcome {
  const p = state.profile, changes: ProfileChange[] = [], skipped: string[] = [];
  const cap = (n: number) => Number.isFinite(n) ? n : Infinity;
  const thesis = str(args.thesis, 4000);
  if (thesis && thesis !== p.thesis) {
    if (thesis.length > cap(limits.thesisChars) && thesis.length > p.thesis.length) skipped.push(`The new point of view is ${thesis.length} characters; this plan allows ${limits.thesisChars}. ${LIMIT_COPY.thesisChars.remedy}`);
    else { changes.push({ field: "thesis", label: "Your point of view", before: p.thesis.slice(0, 80), after: thesis.slice(0, 80) }); p.thesis = thesis; }
  }
  for (const id of list(args.add_themes)) if (isThemeId(id) && !p.themes.includes(id)) { p.themes.push(id); changes.push({ field: "themes", label: "Core interests", after: themeName(id) }); }
  for (const id of list(args.remove_themes)) if (isThemeId(id) && p.themes.includes(id)) { p.themes = p.themes.filter(t => t !== id); changes.push({ field: "themes", label: "Core interests", before: themeName(id) }); }
  if (Array.isArray(args.add_interests)) for (const raw of args.add_interests.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Args, symbol = str(r.symbol, 15).toUpperCase(), name = str(r.name, 100) || symbol, kind = (["stock", "crypto", "custom"] as const).find(k => k === r.kind) ?? (symbol ? "stock" : "custom");
    if (!name || p.interests.length >= 50) continue;
    const interest: Interest = kind === "custom" ? { id: `custom:${name.toLowerCase()}`, name, kind } : { id: kind === "crypto" ? name.toLowerCase().replace(/\s+/g, "-") : symbol, name, symbol: symbol || name.toUpperCase(), kind };
    if (p.interests.some(i => i.id === interest.id || (i.symbol && i.symbol === interest.symbol))) continue;
    if (kind !== "custom" && followedAssets(p.interests) >= cap(limits.follows)) { skipped.push(`${interest.symbol || name}: already following ${limits.follows} of ${limits.follows} assets on this plan. ${LIMIT_COPY.follows.remedy}`); continue; }
    if (p.interests.length >= cap(limits.preferenceItems)) { skipped.push(`${interest.symbol || name}: “Paying attention to” holds ${limits.preferenceItems} items on this plan. ${LIMIT_COPY.preferenceItems.remedy}`); continue; }
    p.interests.push(interest); changes.push({ field: "interests", label: "Paying attention to", after: interest.symbol || interest.name });
  }
  for (const target of list(args.remove_interests)) {
    const hit = p.interests.find(i => i.symbol?.toLowerCase() === target.toLowerCase() || i.name.toLowerCase() === target.toLowerCase() || i.id.toLowerCase() === target.toLowerCase());
    if (hit) { p.interests = p.interests.filter(i => i !== hit); changes.push({ field: "interests", label: "Paying attention to", before: hit.symbol || hit.name }); }
  }
  for (const pref of list(args.add_preferences)) if (!state.preferences.some(x => x.toLowerCase() === pref.toLowerCase()) && state.preferences.length < 50) {
    if (state.preferences.length >= cap(limits.preferenceItems)) { skipped.push(`${pref}: “Things you care about” holds ${limits.preferenceItems} items on this plan. ${LIMIT_COPY.preferenceItems.remedy}`); continue; }
    state.preferences.push(pref); changes.push({ field: "preferences", label: "Things you care about", after: pref });
  }
  for (const pref of list(args.remove_preferences)) { const before = state.preferences.length; state.preferences = state.preferences.filter(x => x.toLowerCase() !== pref.toLowerCase()); if (state.preferences.length !== before) changes.push({ field: "preferences", label: "Things you care about", before: pref }); }
  for (const d of list(args.add_dislikes)) if (!state.dislikes.some(x => x.toLowerCase() === d.toLowerCase()) && state.dislikes.length < 50) {
    if (state.dislikes.length >= cap(limits.preferenceItems)) { skipped.push(`${d}: “Show me less” holds ${limits.preferenceItems} items on this plan. ${LIMIT_COPY.preferenceItems.remedy}`); continue; }
    state.dislikes.push(d); changes.push({ field: "dislikes", label: "Show me less", after: d });
  }
  for (const d of list(args.remove_dislikes)) { const before = state.dislikes.length; state.dislikes = state.dislikes.filter(x => x.toLowerCase() !== d.toLowerCase()); if (state.dislikes.length !== before) changes.push({ field: "dislikes", label: "Show me less", before: d }); }
  const permission = str(args.permission) as Permission;
  if (permission && Object.hasOwn(PERMISSIONS, permission) && permission !== p.permission) { changes.push({ field: "permission", label: "Agent mode", before: PERMISSIONS[p.permission], after: PERMISSIONS[permission] }); p.permission = permission; p.permissionConfigured = true; }
  if (args.limits && typeof args.limits === "object") {
    const next = { ...p.limits } as InvestingProfile["limits"];
    for (const key of ["perTrade", "daily", "weekly"] as const) { const v = (args.limits as Args)[key]; if (typeof v === "number") next[key] = v.toFixed(2); else if (typeof v === "string" && v.trim()) next[key] = v.trim().replace(/^\$/, ""); }
    const error = limitsError(next);
    if (error) throw new Error(error);
    for (const key of ["perTrade", "daily", "weekly"] as const) if (next[key] !== p.limits[key]) changes.push({ field: `limits.${key}`, label: { perTrade: "Per-trade limit", daily: "Daily limit", weekly: "Weekly limit" }[key], before: p.limits[key] ? `$${p.limits[key]}` : undefined, after: `$${next[key]}` });
    p.limits = next;
  }
  if (changes.length) recordEvent(state, "profile", `Updated ${[...new Set(changes.map(c => c.label))].join(", ").toLowerCase()}`, "You told your agent in conversation.");
  return { changes, skipped };
}

export async function executeTool(name: string, args: Args, state: HubState, userId: string, services: AgentServices = agentServices, limits: PlanLimits = DEFAULT_PLAN.limits): Promise<ToolOutcome> {
  switch (name) {
    case "get_profile": return { result: { ...profileSummary(state), plan: { following: `${followedAssets(state.profile.interests)} of ${limits.follows} assets`, itemsPerList: limits.preferenceItems, thesisCharacters: limits.thesisChars } }, parts: [] };
    case "update_profile": {
      const { changes, skipped } = applyProfileUpdate(state, args, limits);
      const skippedNote = skipped.length ? { skipped, instruction: "Tell the user plainly what was not added and the one thing they can do about it. Do not apologise at length." } : {};
      return { result: changes.length ? { updated: changes, profile: profileSummary(state), ...skippedNote } : { updated: [], note: skipped.length ? "Nothing was added because of plan limits." : "Nothing changed; the profile already reflected this.", ...skippedNote }, parts: changes.length ? [{ type: "profile_update", changes }] : [] };
    }
    case "search_assets": {
      const kind = args.kind === "crypto" ? "crypto" : "stock", query = str(args.query, 100);
      const assets = rank(await (kind === "crypto" ? services.crypto.search(query) : services.stocks.search(query)), state).slice(0, 6);
      return { result: assets.map(compactAsset), parts: assets.length ? [{ type: "assets", assets: assets.slice(0, 4), title: query ? `Matches for “${query}”` : undefined }] : [] };
    }
    case "get_asset": {
      const asset = await detail(str(args.id, 100), args.kind === "crypto" ? "crypto" : "stock", state, services);
      const parts: MessagePart[] = [];
      if (args.show_card !== false) parts.push({ type: "asset", asset });
      if (args.show_news === true && asset.news.length) parts.push({ type: "news", items: asset.news.slice(0, 4), title: `Recent on ${asset.symbol}` });
      return { result: { ...compactAsset(asset), volume: asset.volume, description: asset.description?.slice(0, 600), news: asset.news.slice(0, 5).map(n => ({ title: n.title, publishedAt: n.publishedAt })), chartStart: asset.chart[0]?.price ?? null, chartEnd: asset.chart.at(-1)?.price ?? null, chartPoints: asset.chart.length }, parts };
    }
    case "list_ipos": {
      const assets = rank(await services.stocks.ipos(), state).slice(0, 6);
      return { result: assets.map(a => ({ ...compactAsset(a), ipo: a.description })), parts: assets.length ? [{ type: "assets", assets: assets.slice(0, 4), title: "New listings, ranked for you" }] : [] };
    }
    case "trending_crypto": {
      const assets = rank(await services.crypto.trending(), state).slice(0, 6);
      return { result: assets.map(compactAsset), parts: assets.length ? [{ type: "assets", assets: assets.slice(0, 4), title: "Trending, filtered for you" }] : [] };
    }
    case "explain_relevance": {
      const asset = await detail(str(args.id, 100), args.kind === "crypto" ? "crypto" : "stock", state, services);
      const r = relevance(asset, state);
      const reasons = r.reasons.length ? r.reasons : [r.label];
      return { result: { label: r.label, reasons, score: Math.round(r.score * 10) / 10 }, parts: [{ type: "explanation", reasons, target: asset.symbol }] };
    }
    case "propose_trade": {
      const kind = args.kind === "crypto" ? "crypto" : "stock", side = args.side === "sell" ? "sell" : "buy";
      const value = typeof args.value_usd === "number" ? args.value_usd : Number(String(args.value_usd).replace(/[$,]/g, ""));
      if (!Number.isFinite(value) || value <= 0) return { result: { error: "A positive USD amount is required." }, parts: [] };
      let quote: Asset | null = null;
      try { quote = await detail(str(args.id, 100), kind, state, services); } catch { /* quote unavailable: the intent still records without an estimate */ }
      const asset: TradeIntent["asset"] = quote ? { id: quote.id, symbol: quote.symbol, name: quote.name, kind } : { id: str(args.id, 100), symbol: str(args.id, 15).toUpperCase(), name: str(args.id, 100).toUpperCase(), kind };
      const trade = await proposeTrade(state, userId, { asset, side, value, reasoning: str(args.reasoning, 600) }, quote);
      return { result: { tradeId: trade.id, status: trade.status, policy: trade.policy.reason, estimatedPrice: trade.estimatedPrice, estimatedQuantity: trade.estimatedQuantity, brokerage: trade.brokerage?.status ?? "not_attempted", instruction: trade.status === "approval_required" ? "Tell the user the order is waiting for their approval on the card." : trade.status === "blocked" ? "Explain the policy reason plainly." : trade.status === "confirmed" ? "Robinhood filled it." : "Do not say the trade executed; describe the actual status." }, parts: [{ type: "trade", tradeId: trade.id }] };
    }
    case "recall_activity": {
      const limit = Math.min(30, Math.max(1, Number(args.limit) || 15));
      void limits;
      return { result: state.events.slice(-limit).reverse().map(e => ({ at: e.at, kind: e.kind, text: e.text, detail: e.detail })), parts: [] };
    }
    default: return { result: { error: `Unknown tool ${name}` }, parts: [] };
  }
}

export const THEME_IDS: ThemeId[] = THEMES.map(t => t.id);
