import { isThemeId, type ThemeId } from "./themes";

export const ASSETS = [
  { id: "nvda", symbol: "NVDA", name: "Nvidia", kind: "stock" },
  { id: "crwv", symbol: "CRWV", name: "CoreWeave", kind: "stock" },
  { id: "btc", symbol: "BTC", name: "Bitcoin", kind: "crypto" },
  { id: "eth", symbol: "ETH", name: "Ethereum", kind: "crypto" },
  { id: "coin", symbol: "COIN", name: "Coinbase", kind: "stock" },
] as const;

export type Interest = { id: string; name: string; symbol?: string; kind: "stock" | "crypto" | "custom" };
export const PERMISSIONS = {
  notify: "Notify me",
  approve: "Ask before acting",
  automatic: "Act within my limits",
} as const;
export type Permission = keyof typeof PERMISSIONS;
export type Limits = { perTrade: string; daily: string; weekly: string };
export type InvestorAnswers = {
  knowledge: number | null;
  guidedTest: boolean;
  opportunityDrivers: string[];
  esgPriority: number | null;
  aiPriority: number | null;
  technologies: string[];
  conflictCountries: string[];
  geopoliticalThesis: string;
  futureVision: string;
};

// Explicit preferences stay separate from future behavioral learning. Learning
// must never change permissions or limits; those require an explicit user edit.
export type PreferenceSignal = {
  interestId: string;
  action: "read" | "ignore" | "follow" | "buy" | "sell";
  occurredAt: string;
};
export type InvestingProfile = {
  version: 3;
  /** Stable visual identity, retained as the agent’s choices evolve. */
  avatarSeed?: string;
  userId: string;
  thesis: string;
  investorAnswers: InvestorAnswers;
  themes: ThemeId[];
  interests: Interest[];
  permission: Permission;
  permissionConfigured: boolean;
  limits: Limits;
  learning: {
    signals: PreferenceSignal[];
    inferredInterests: { interestId: string; affinity: number; updatedAt: string }[];
  };
  step: 1 | 2 | 3 | 4 | 5 | 6;
  completedAt: string | null;
  updatedAt: string;
};

export function newProfile(userId: string): InvestingProfile {
  return {
    version: 3, userId, thesis: "", investorAnswers: { knowledge: null, guidedTest: false, opportunityDrivers: [], esgPriority: null, aiPriority: null, technologies: [], conflictCountries: [], geopoliticalThesis: "", futureVision: "" }, themes: [], interests: [], permission: "notify", permissionConfigured: false,
    limits: { perTrade: "", daily: "", weekly: "" },
    learning: { signals: [], inferredInterests: [] },
    step: 1, completedAt: null, updatedAt: new Date().toISOString(),
  };
}

// Keep the original storage slot; readProfile migrates its versioned content.
export function profileKey(userId: string) {
  return `rubicon:socialtrading:v1:${encodeURIComponent(userId)}`;
}

export function limitsError(limits: Limits): string | null {
  const values = [limits.perTrade, limits.daily, limits.weekly];
  if (values.some(value => !/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Math.round(Number(value) * 100)))) {
    return "Enter a positive USD amount with up to two decimal places for each limit.";
  }
  if (Number(limits.perTrade) > Number(limits.daily) || Number(limits.daily) > Number(limits.weekly)) {
    return "Your per-trade limit must fit within your daily limit, and your daily limit within your weekly limit.";
  }
  return null;
}

export function readProfile(raw: string | null, userId: string): InvestingProfile {
  const fresh = newProfile(userId);
  if (!raw) return fresh;
  try {
    const p = JSON.parse(raw);
    if (![1, 2, 3].includes(p.version) || p.userId !== userId || typeof p.thesis !== "string" || p.thesis.length > 4000 ||
      !Object.hasOwn(PERMISSIONS, p.permission) || !(p.version === 1 ? [1, 2, 3, 4] : p.version === 2 ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6]).includes(p.step) ||
      !Array.isArray(p.interests) || p.interests.length > 50 ||
      !p.interests.every((i: Interest) => i && typeof i.id === "string" && typeof i.name === "string" && i.name.length <= 100 &&
        (i.symbol === undefined || typeof i.symbol === "string") && ["stock", "crypto", "custom"].includes(i.kind)) ||
      !p.limits || ![p.limits.perTrade, p.limits.daily, p.limits.weekly].every(v => typeof v === "string")) return fresh;
    const permissionConfigured = typeof p.permissionConfigured === "boolean" ? p.permissionConfigured : p.step === (p.version === 1 ? 4 : p.version === 2 ? 5 : 6);
    // Versions 1–2 had separate thesis/theme/interest screens. The compact
    // flow folds those into step 2 while preserving permission and completion.
    const storedStep = p.version === 1 ? (p.step >= 4 ? 6 : p.step === 3 ? 5 : 2)
      : p.version === 2 ? (p.step >= 5 ? 6 : p.step === 4 ? 5 : 2)
      : [3, 4].includes(p.step) ? 2 : p.step;
    const themes: ThemeId[] = Array.isArray(p.themes) ? [...new Set<ThemeId>(p.themes.filter(isThemeId))] : [];
    const legacy = p.version < 3;
    const rawAnswers = p.investorAnswers;
    const investorAnswers: InvestorAnswers = legacy ? { ...fresh.investorAnswers, knowledge: 4, futureVision: p.thesis }
      : rawAnswers && typeof rawAnswers === "object" ? {
        knowledge: Number.isInteger(rawAnswers.knowledge) && rawAnswers.knowledge >= 0 && rawAnswers.knowledge <= 4 ? rawAnswers.knowledge : null,
        guidedTest: !!rawAnswers.guidedTest,
        opportunityDrivers: Array.isArray(rawAnswers.opportunityDrivers) ? rawAnswers.opportunityDrivers.filter((v: unknown): v is string => typeof v === "string").slice(0, 4) : [],
        esgPriority: Number.isInteger(rawAnswers.esgPriority) && rawAnswers.esgPriority >= 0 && rawAnswers.esgPriority <= 4 ? rawAnswers.esgPriority : null,
        aiPriority: Number.isInteger(rawAnswers.aiPriority) && rawAnswers.aiPriority >= 0 && rawAnswers.aiPriority <= 4 ? rawAnswers.aiPriority : null,
        technologies: Array.isArray(rawAnswers.technologies) ? rawAnswers.technologies.filter((v: unknown): v is string => typeof v === "string").slice(0, 12) : [],
        conflictCountries: Array.isArray(rawAnswers.conflictCountries) ? rawAnswers.conflictCountries.filter((v: unknown): v is string => typeof v === "string").slice(0, 30) : [],
        geopoliticalThesis: typeof rawAnswers.geopoliticalThesis === "string" ? rawAnswers.geopoliticalThesis.slice(0, 1000) : "",
        futureVision: typeof rawAnswers.futureVision === "string" ? rawAnswers.futureVision.slice(0, 1000) : "",
      } : fresh.investorAnswers;
    const step = investorAnswers.knowledge === null ? 1 : !p.thesis.trim() ? 2 : storedStep === 6 && (!permissionConfigured || (p.permission === "automatic" && limitsError(p.limits))) ? 5 : storedStep;
    // No behavioral collector ships with onboarding. Do not trust arbitrary
    // inferred preferences from browser storage until that feature exists.
    return { ...fresh, thesis: p.thesis, investorAnswers, themes, interests: p.interests, permission: p.permission,
      avatarSeed: typeof p.avatarSeed === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(p.avatarSeed) ? p.avatarSeed : undefined,
      permissionConfigured,
      limits: p.limits, step, completedAt: step === 6 && typeof p.completedAt === "string" ? p.completedAt : null };
  } catch {
    return fresh;
  }
}
