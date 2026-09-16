import type { Interest } from "./profile";
import { suggestedThemes, type ThemeId } from "./themes";

// A bounded classification catalog keeps previews fast and explainable.
// Asset examples are discovery links, never automatically followed holdings.
export const TOPICS = [
  { id: "data-centers", name: "Data centers", themes: ["ai", "tech"], keywords: /data\s*cent(?:er|re)|cloud infrastructure|hyperscal/i, assets: ["crwv", "msft"] },
  { id: "power-grid", name: "Power infrastructure", themes: ["energy", "ai"], keywords: /power|grid|electric|nuclear|energy/i, assets: ["ceg"] },
  { id: "semiconductors", name: "Semiconductors", themes: ["ai", "tech"], keywords: /semiconductor|chip|gpu|silicon/i, assets: ["nvda"] },
  { id: "ai-applications", name: "AI applications", themes: ["ai", "tech"], keywords: /\bai\b|artificial intelligence|inference|automation/i, assets: ["msft", "nvda"] },
  { id: "digital-money", name: "Digital money", themes: ["crypto"], keywords: /digital money|bitcoin|payments|store of value/i, assets: ["btc", "coin"] },
  { id: "decentralized-finance", name: "Decentralized finance", themes: ["crypto"], keywords: /defi|decentralized finance|smart contract|ethereum/i, assets: ["eth"] },
  { id: "biotech", name: "Biotech & longevity", themes: ["healthcare"], keywords: /biotech|longevity|drug|pharma|medicine/i, assets: ["lly"] },
  { id: "medical-technology", name: "Medical technology", themes: ["healthcare", "tech"], keywords: /medical|surgical|health tech|robotic surgery/i, assets: ["isrg"] },
  { id: "consumer-trends", name: "Consumer trends", themes: ["consumer"], keywords: /consumer|retail|shopping|commerce/i, assets: ["cost", "amzn"] },
  { id: "cloud-software", name: "Cloud & software", themes: ["tech"], keywords: /cloud|software|saas/i, assets: ["msft", "amzn"] },
] satisfies { id: string; name: string; themes: ThemeId[]; keywords: RegExp; assets: string[] }[];

export function classifyTopic(interest: Pick<Interest, "id" | "name">) {
  const exact = TOPICS.find(t => `theme:${t.id}` === interest.id || t.name.toLowerCase() === interest.name.toLowerCase());
  return exact ? [exact] : TOPICS.filter(t => t.keywords.test(interest.name));
}

export function topicSuggestions(themes: ThemeId[], thesis: string, query = ""): Interest[] {
  const inferred = suggestedThemes(thesis);
  const score = (topic: typeof TOPICS[number]) => topic.themes.reduce((n, t) => n + (themes.includes(t) ? 3 : 0) + (inferred.includes(t) ? 1 : 0), 0) + (topic.keywords.test(thesis) ? 2 : 0);
  return TOPICS.filter(t => `${t.name} ${t.themes.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()) || (!!query.trim() && t.keywords.test(query)))
    .sort((a, b) => score(b) - score(a))
    .map(t => ({ id: `theme:${t.id}`, name: t.name, kind: "custom" }));
}
