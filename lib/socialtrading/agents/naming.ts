import type { InvestingProfile } from "../profile";
import { THEMES, suggestedThemes, type ThemeId } from "../themes";

type NamingProfile = Pick<InvestingProfile, "themes" | "thesis">;

const FITTING_NAMES: Record<ThemeId | "general", readonly string[]> = {
  ai: ["Signal Forge", "Bright Circuit", "Pattern Scout"],
  energy: ["Gridline", "Power Current", "Northstar Energy"],
  tech: ["Frontier Signal", "New Stack", "Horizon Lab"],
  crypto: ["Block Current", "Open Ledger", "Chain Scout"],
  healthcare: ["Vital Horizon", "Longview Health", "Life Signal"],
  consumer: ["Market Mosaic", "Everyday Signal", "Main Street Scout"],
  general: ["Northstar", "Longview", "Signal Scout"],
};

const hash = (value: string) => [...value].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 7);
const cleanUserName = (value?: string) => value?.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{N}'’._-]/gu, "").slice(0, 30) || "";

export function agentThemes(profile: NamingProfile): ThemeId[] {
  return [...new Set(profile.themes.length ? profile.themes : suggestedThemes(profile.thesis))].slice(0, 2);
}

export function generatedAgentName(profile: NamingProfile, userName?: string, seed = profile.thesis): string {
  const themes = agentThemes(profile);
  const owner = cleanUserName(userName);
  if (owner && themes.length) {
    const sectors = themes.map(id => THEMES.find(theme => theme.id === id)!.name).join(" & ");
    return `${owner}${owner.endsWith("s") ? "’" : "’s"} ${sectors} agent`;
  }
  if (owner) return `${owner}${owner.endsWith("s") ? "’" : "’s"} investing agent`;
  const family = FITTING_NAMES[themes[0] ?? "general"];
  return family[hash(seed) % family.length];
}

export function generatedAgentDescription(profile: NamingProfile): string {
  const themes = agentThemes(profile).map(id => THEMES.find(theme => theme.id === id)!.name);
  return themes.length ? `${themes.join(" × ")} through your point of view` : "Shaped around your investing point of view";
}
