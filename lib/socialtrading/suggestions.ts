import { classifyTopic } from "./topics";
import { ASSETS, type Interest } from "./profile";
import { suggestedThemes, type ThemeId } from "./themes";

const CATALOG: (Interest & { themes: ThemeId[] })[] = [
  { ...ASSETS[0], themes: ["ai", "tech"] },
  { ...ASSETS[1], themes: ["ai", "tech"] },
  { ...ASSETS[2], themes: ["crypto"] },
  { ...ASSETS[3], themes: ["crypto"] },
  { ...ASSETS[4], themes: ["crypto"] },
  { id: "ceg", symbol: "CEG", name: "Constellation Energy", kind: "stock", themes: ["energy"] },
  { id: "xom", symbol: "XOM", name: "Exxon Mobil", kind: "stock", themes: ["energy"] },
  { id: "msft", symbol: "MSFT", name: "Microsoft", kind: "stock", themes: ["tech", "ai"] },
  { id: "lly", symbol: "LLY", name: "Eli Lilly", kind: "stock", themes: ["healthcare"] },
  { id: "isrg", symbol: "ISRG", name: "Intuitive Surgical", kind: "stock", themes: ["healthcare", "tech"] },
  { id: "cost", symbol: "COST", name: "Costco", kind: "stock", themes: ["consumer"] },
  { id: "amzn", symbol: "AMZN", name: "Amazon", kind: "stock", themes: ["consumer", "tech"] },
  { id: "theme:power-grid", name: "Power infrastructure", kind: "custom", themes: ["energy", "ai"] },
  { id: "theme:semiconductors", name: "Semiconductors", kind: "custom", themes: ["ai", "tech"] },
  { id: "theme:biotech", name: "Biotech", kind: "custom", themes: ["healthcare"] },
];

// Lightweight local matching, not financial recommendations or inferred holdings.
export function assetSuggestions(themes: ThemeId[], thesis: string, query = "") {
  const inferred = suggestedThemes(thesis);
  const score = (asset: typeof CATALOG[number]) => asset.themes.reduce((n, theme) => n + (themes.includes(theme) ? 3 : 0) + (inferred.includes(theme) ? 1 : 0), 0);
  return CATALOG.filter(asset => `${asset.symbol ?? ""} ${asset.name} ${asset.themes.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => score(b) - score(a));
}

/** Exact topic mappings precede keyword classification for free-form interests. */
export function topicRecommendations(interest: Pick<Interest, "id" | "name">) {
  const topics = classifyTopic(interest);
  const ids = [...new Set(topics.flatMap(t => t.assets))];
  return ids.flatMap(id => {
    const asset = CATALOG.find(a => a.id === id && a.kind !== "custom");
    return asset ? [{ id: asset.id, name: asset.name, symbol: asset.symbol, kind: asset.kind,
      reason: `Related to ${topics.filter(t => t.assets.includes(id)).map(t => t.name.toLowerCase()).join(" and ")}` }] : [];
  }).slice(0, 4);
}
