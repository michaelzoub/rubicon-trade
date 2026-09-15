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

// Explicit preferences stay separate from future behavioral learning. Learning
// must never change permissions or limits; those require an explicit user edit.
export type PreferenceSignal = {
  interestId: string;
  action: "read" | "ignore" | "follow" | "buy" | "sell";
  occurredAt: string;
};
export type InvestingProfile = {
  version: 2;
  userId: string;
  thesis: string;
  themes: ThemeId[];
  interests: Interest[];
  permission: Permission;
  permissionConfigured: boolean;
  limits: Limits;
  learning: {
    signals: PreferenceSignal[];
    inferredInterests: { interestId: string; affinity: number; updatedAt: string }[];
  };
  step: 1 | 2 | 3 | 4 | 5;
  completedAt: string | null;
  updatedAt: string;
};

export function newProfile(userId: string): InvestingProfile {
  return {
    version: 2, userId, thesis: "", themes: [], interests: [], permission: "notify", permissionConfigured: false,
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
    if (![1, 2].includes(p.version) || p.userId !== userId || typeof p.thesis !== "string" || p.thesis.length > 4000 ||
      !Object.hasOwn(PERMISSIONS, p.permission) || !(p.version === 1 ? [1, 2, 3, 4] : [1, 2, 3, 4, 5]).includes(p.step) ||
      !Array.isArray(p.interests) || p.interests.length > 50 ||
      !p.interests.every((i: Interest) => i && typeof i.id === "string" && typeof i.name === "string" && i.name.length <= 100 &&
        (i.symbol === undefined || typeof i.symbol === "string") && ["stock", "crypto", "custom"].includes(i.kind)) ||
      !p.limits || ![p.limits.perTrade, p.limits.daily, p.limits.weekly].every(v => typeof v === "string")) return fresh;
    const permissionConfigured = typeof p.permissionConfigured === "boolean" ? p.permissionConfigured : p.step === (p.version === 1 ? 4 : 5);
    const storedStep = p.version === 1 && p.step > 1 ? p.step + 1 : p.step;
    const themes: ThemeId[] = Array.isArray(p.themes) ? [...new Set<ThemeId>(p.themes.filter(isThemeId))] : [];
    const step = !p.thesis.trim() ? 1 : storedStep === 5 && (!permissionConfigured || (p.permission === "automatic" && limitsError(p.limits))) ? 4 : storedStep;
    // No behavioral collector ships with onboarding. Do not trust arbitrary
    // inferred preferences from browser storage until that feature exists.
    return { ...fresh, thesis: p.thesis, themes, interests: p.interests, permission: p.permission,
      permissionConfigured,
      limits: p.limits, step, completedAt: step === 5 && typeof p.completedAt === "string" ? p.completedAt : null };
  } catch {
    return fresh;
  }
}
