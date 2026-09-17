import { PERMISSIONS, type InvestorAnswers } from "../profile";
import { THEMES } from "../themes";
import type { HubState } from "../types";
import { agentThemes } from "./naming";

/**
 * How an agent talks and thinks is owned by Rubicon, not typed in by the user.
 * It is read from what onboarding revealed and from what the agent has learned
 * since, so it keeps shifting as the user talks to it. Nothing here is a rule:
 * permissions and tool rules in the calling prompt always win.
 */
const DEPTH: Record<number, string> = {
  0: "Explain like a patient friend: define a term the first time it appears, skip jargon, one idea at a time, and say plainly what a move would mean for them.",
  1: "Explain like a patient friend: define a term the first time it appears, skip jargon, one idea at a time, and say plainly what a move would mean for them.",
  2: "Assume they know the basics. Explain the why behind a move, not the vocabulary.",
  3: "Talk peer to peer: precise, dense, comfortable with valuation and market structure, no hand-holding.",
  4: "Talk peer to peer: precise, dense, comfortable with valuation and market structure, no hand-holding.",
};
const LENS: Record<string, string> = {
  "Breakthrough innovation": "new technology opening new markets",
  "Resilience & security": "scarcity, security and stability",
  "Human progress": "longer, healthier, cleaner lives",
  "Everyday shifts": "how people live and spend",
};
const IMPACT: Record<number, string> = {
  0: "Returns lead; mention impact only when it moves the numbers.",
  1: "Returns lead; mention impact only when it moves the numbers.",
  2: "Weigh returns and impact together.",
  3: "Impact matters as much as returns: raise ethical and environmental angles unprompted.",
  4: "Impact matters as much as returns: raise ethical and environmental angles unprompted.",
};
const STANCE: Record<keyof typeof PERMISSIONS, string> = {
  notify: "Never push toward action. Surface, explain, and let them decide in their own time.",
  approve: "Propose when something fits and expect them to decide; never assume a yes.",
  automatic: "Be decisive inside their limits and say clearly what you did and why.",
};

const list = (items: readonly string[], max = 6) => items.filter(Boolean).slice(0, max).join(", ");
const EMPTY_ANSWERS: InvestorAnswers = {
  knowledge: null, guidedTest: false, opportunityDrivers: [], esgPriority: null, aiPriority: null,
  technologies: [], conflictCountries: [], geopoliticalThesis: "", futureVision: "",
};

export function agentVoice(state: HubState): string {
  const p = state.profile, a = p.investorAnswers ?? EMPTY_ANSWERS;
  const themes = agentThemes(p).map(id => THEMES.find(t => t.id === id)!.name);
  const lenses = a.opportunityDrivers.map(d => LENS[d] ?? d.toLowerCase()).filter(Boolean);
  const lines = [
    themes.length ? `Your beat is ${themes.join(" and ")}, seen through their thesis.` : "Your beat is whatever their thesis points at.",
    a.knowledge === null ? DEPTH[2] : DEPTH[a.knowledge],
    lenses.length ? `They see opportunity in ${lenses.join("; ")}. Frame ideas through that lens first.` : "",
    a.esgPriority === null ? "" : IMPACT[a.esgPriority],
    (a.aiPriority ?? 0) >= 3 ? "Responsible AI is a live theme in their outlook; treat it as such." : "",
    a.technologies.length ? `Be fluent in ${list(a.technologies)}.` : "",
    a.geopoliticalThesis ? `Their geopolitical read: “${a.geopoliticalThesis.slice(0, 240)}”.` : a.conflictCountries.length ? `They watch ${list(a.conflictCountries, 8)} geopolitically.` : "",
    a.futureVision && a.futureVision !== p.thesis ? `Their five to ten year view: “${a.futureVision.slice(0, 240)}”.` : "",
    a.onboarding ? `Their confidence in their beliefs is ${["exploratory", "a few hunches", "some clear views", "strong convictions"][a.onboarding.confidence ?? 0]}. ${ (a.onboarding.confidence ?? 0) < 2 ? "Offer possibilities without presenting them as established beliefs." : "Start from their stated views and test the assumptions behind them." }` : "",
    a.onboarding?.dislikes.length ? `Strong dislikes (preferences, not hard trading restrictions): ${a.onboarding.dislikes.join(", ")}.` : "",
    STANCE[p.permission],
    state.preferences.length ? `Lean into what they have said they care about: ${list(state.preferences)}.` : "",
    state.dislikes.length ? `Go easy on what they asked to see less of: ${list(state.dislikes)}.` : "",
    "When they tell you how they want you to talk or what to focus on, take it on through update_profile rather than asking them to change a setting.",
  ].filter(Boolean);
  return lines.join(" ");
}
