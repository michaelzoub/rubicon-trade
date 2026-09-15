export const THEMES = [
  { id: "energy", name: "Energy", note: "Powering what’s next", color: "#a28d53", light: "#f0e7c7", dark: "#665936", keywords: /energy|power|grid|nuclear|solar|electric|uranium|utility/i },
  { id: "tech", name: "Tech", note: "The next building blocks", color: "#6f8fba", light: "#dce8f8", dark: "#3d536f", keywords: /tech|software|cloud|network|comput/i },
  { id: "ai", name: "AI", note: "Intelligence, everywhere", color: "#9383b4", light: "#e9e1f5", dark: "#5b4a78", keywords: /\bai\b|inference|semiconductor|intelligence|data center|gpu|artificial/i },
  { id: "crypto", name: "Crypto", note: "A more open economy", color: "#73a293", light: "#d8eee4", dark: "#42675b", keywords: /crypto|bitcoin|ethereum|blockchain|token|coin|defi|stablecoin/i },
  { id: "healthcare", name: "Healthcare", note: "Better, longer lives", color: "#b5828c", light: "#f2dfe4", dark: "#784f59", keywords: /health|biotech|medicine|drug|longevity|pharma|medical/i },
  { id: "consumer", name: "Consumer", note: "How the world lives", color: "#b89376", light: "#f3e4d8", dark: "#795e4a", keywords: /consumer|retail|brand|shopping|food|restaurant|apparel/i },
] as const;

export type ThemeId = typeof THEMES[number]["id"];
export const isThemeId = (value: unknown): value is ThemeId => THEMES.some(t => t.id === value);
export const suggestedThemes = (thesis: string) => THEMES.filter(theme => theme.keywords.test(thesis)).map(t => t.id);

/** Blend the badge material from explicit themes. Inferred themes tint the
 * blend at a third of the weight so the badge drifts as the agent learns,
 * while the face and identity traits never change. */
export function badgePalette(themes: readonly ThemeId[], fallback = 0, inferred: readonly ThemeId[] = []) {
  const explicit = THEMES.filter(t => themes.includes(t.id)).map(t => ({ theme: t, weight: 1 }));
  const learned = THEMES.filter(t => inferred.includes(t.id) && !themes.includes(t.id)).map(t => ({ theme: t, weight: 1 / 3 }));
  const palettes = explicit.length || learned.length ? [...explicit, ...learned] : [{ theme: THEMES[fallback % THEMES.length], weight: 1 }];
  const total = palettes.reduce((sum, p) => sum + p.weight, 0);
  const blend = (key: "light" | "color" | "dark") => {
    const channels = [1, 3, 5].map(offset => Math.round(palettes.reduce((sum, p) => sum + p.weight * parseInt(p.theme[key].slice(offset, offset + 2), 16), 0) / total));
    return `#${channels.map(c => c.toString(16).padStart(2, "0")).join("")}`;
  };
  return { light: blend("light"), color: blend("color"), dark: blend("dark") };
}
