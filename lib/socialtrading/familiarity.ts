export const FAMILIARITY_TITLE = "Which of these concepts are you familiar with?";

export const FAMILIARITY_CONCEPTS = [
  { id: 1, label: "Stock", weight: 1 },
  { id: 2, label: "Interest rate", weight: 1 },
  { id: 3, label: "Diversification", weight: 2 },
  { id: 4, label: "ETF", weight: 2 },
  { id: 5, label: "Compound interest", weight: 2 },
  { id: 6, label: "Dividend", weight: 2 },
  { id: 7, label: "Index fund", weight: 3 },
  { id: 8, label: "Risk tolerance", weight: 3 },
  { id: 9, label: "Asset allocation", weight: 3 },
  { id: 10, label: "Expense ratio", weight: 3 },
  { id: 11, label: "P/E ratio", weight: 4 },
  { id: 12, label: "Options contract", weight: 4 },
] as const;

export const FAMILIARITY_MAX_SCORE = FAMILIARITY_CONCEPTS.reduce((sum, concept) => sum + concept.weight, 0);

export type FamiliarityTier = 1 | 2 | 3 | 4;
export type FamiliarityConceptId = (typeof FAMILIARITY_CONCEPTS)[number]["id"];
export type FamiliarityResult = {
  familiarityTier: FamiliarityTier;
  familiarityScore: number;
  selectedConceptIds: number[];
};

export const FAMILIARITY_TIER_LABELS: Record<FamiliarityTier, string> = {
  1: "New to investing",
  2: "Getting started",
  3: "Comfortable investing",
  4: "Experienced investor",
};

const WEIGHTS = new Map<number, number>(FAMILIARITY_CONCEPTS.map(concept => [concept.id, concept.weight]));
const VALID_IDS = new Set<number>(FAMILIARITY_CONCEPTS.map(concept => concept.id));

export function isFamiliarityTier(value: unknown): value is FamiliarityTier {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function knowledgeFromTier(tier: FamiliarityTier): number {
  return tier - 1;
}

export function familiarityFields(result: FamiliarityResult) {
  return {
    knowledge: knowledgeFromTier(result.familiarityTier),
    familiarityTier: result.familiarityTier,
    familiarityScore: result.familiarityScore,
    selectedConceptIds: result.selectedConceptIds,
  };
}

export function scoreFamiliarity(selectedConceptIds: readonly number[]): FamiliarityResult {
  const selectedConceptIdsUnique = [...new Set(selectedConceptIds.filter(id => VALID_IDS.has(id)))].sort((a, b) => a - b);
  const familiarityScore = selectedConceptIdsUnique.reduce((sum, id) => sum + (WEIGHTS.get(id) ?? 0), 0);
  const familiarityTier: FamiliarityTier = familiarityScore <= 6 ? 1 : familiarityScore <= 14 ? 2 : familiarityScore <= 22 ? 3 : 4;
  return { familiarityTier, familiarityScore, selectedConceptIds: selectedConceptIdsUnique };
}

export function readSelectedConceptIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  for (const value of raw) {
    if (typeof value === "number" && Number.isInteger(value) && VALID_IDS.has(value) && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

export function shuffleFamiliarityConcepts<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}
