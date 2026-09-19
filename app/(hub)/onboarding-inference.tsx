"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { profileKey, limitsError, type InvestingProfile } from "@/lib/socialtrading/profile";
import { newOnboarding, onboardingPortrait, onboardingThesis, predictions, PREDICTION_COUNT, CONVICTION_LEAD, CONVICTION_TITLE, DECK_LEAD, DECK_TITLE, type OnboardingAnswers } from "@/lib/socialtrading/onboarding";
import { applyAnswer, type Card, type CardAnswer } from "@/lib/socialtrading/onboarding-cards";
import { DEFAULT_PLAN } from "@/lib/socialtrading/plans";
import { suggestedThemes } from "@/lib/socialtrading/themes";
import { LoadingState } from "../_components/ui";
import { FAMILIARITY_TITLE, familiarityFields, scoreFamiliarity, type FamiliarityResult } from "@/lib/socialtrading/familiarity";
import { FoundationScale } from "./onboarding-drag";
import { FamiliarityCheck } from "./familiarity-check";
import { PredictionPad } from "./onboarding-chart";
import { PredictionDeck, DealingDeck } from "./onboarding-deck";
import { OnboardingAgentPeek } from "./onboarding-agent";
import { OnboardingCard } from "./onboarding-card";
import { OnboardingRules } from "./onboarding-rules";
import { fetchPredictionDeck, type DeckFetcher } from "./onboarding-client";
import { useProfileStore, useRunLog, type ArmProps } from "./onboarding-session";
import "./onboarding.css";

/** Two foundations, then seven inferred swipe cards — one per domain — then the rules. */
const TOTAL = 2 + PREDICTION_COUNT + 1;
const SEEDS = { clarity: -2, knowledge: -1 } as const;

/** The inference arm: after two shared foundations, the agent writes the seven
 * domain predictions from the person's knowledge level. Swipes fill the
 * profile; they do not choose the next swipe. When the model is unavailable it
 * falls back to the knowledge-level bank and records that, so a fallback run is
 * never counted as inference. */
export function InferenceOnboarding({ userId, name, onComplete, completing = false, serverError = "", persist = true, agentCreation = false, plan = DEFAULT_PLAN, variant, forced, fetchDeck = fetchPredictionDeck }: ArmProps & { fetchDeck?: DeckFetcher }) {
  const router = useRouter();
  const { profile, setProfile, loaded, storageError } = useProfileStore(userId, persist);
  const log = useRunLog(variant, forced);
  const [index, setIndex] = useState<number>(SEEDS.clarity);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const requested = useRef(0);
  const a = profile.investorAnswers.onboarding ?? newOnboarding();
  const knowledge = profile.investorAnswers.knowledge;
  const busy = completing || saving;
  const card = index >= 0 ? cards[index] : undefined;
  const atRules = index >= 0 && cards.length > 0 && index >= cards.length;

  function update(patch: Partial<OnboardingAnswers>, extra: Partial<InvestingProfile> = {}) {
    setError("");
    setProfile(p => { const current = p.investorAnswers.onboarding ?? newOnboarding(); return { ...p, ...extra, completedAt: null, updatedAt: new Date().toISOString(), investorAnswers: { ...p.investorAnswers, ...extra.investorAnswers, onboarding: { ...current, ...patch } } }; });
  }
  const answer = (c: Card, value: CardAnswer) => update(applyAnswer(a, c, value));

  /** Asks for the seven-domain pack once. A failure drops the arm onto the
   * knowledge-level bank rather than stranding anyone mid-onboarding. */
  const request = useCallback(async () => {
    if (requested.current) return;
    requested.current = 1;
    setLoading(true);
    const controller = new AbortController();
    try {
      const pack = await fetchDeck({ confidence: a.confidence, knowledge }, controller.signal);
      setCards(pack);
    } catch {
      log.setSource("fallback");
      setCards(predictions(knowledge ?? 0).map(p => ({ id: `fallback-${p.id}`, kind: "binary" as const, title: p.text, lead: "Take a side.", category: p.category })));
    } finally { setLoading(false); }
  }, [a.confidence, knowledge, log, fetchDeck]);

  useEffect(() => {
    if (!loaded || index < 0) return;
    if (!cards.length) void request();
  }, [index, cards.length, loaded, request]);

  // Identify the position by a stable string. While a generated card is in
  // flight there is no card at all — logging that gap invented cards that never showed.
  const position = atRules ? { id: "rules", kind: "rules" }
    : index === SEEDS.clarity ? { id: "clarity", kind: "scale" }
    : index === SEEDS.knowledge ? { id: "knowledge", kind: "chips" }
    : card ? { id: card.id, kind: card.kind } : null;
  useEffect(() => {
    if (loaded && position) log.enter(position.id, position.kind);
  }, [loaded, position?.id, position?.kind, log]);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [index]);

  function next() {
    if (index === SEEDS.clarity && a.confidence === null) return setError("Choose how strong your convictions are.");
    if (index === SEEDS.knowledge) { completeKnowledge(scoreFamiliarity(profile.investorAnswers.selectedConceptIds ?? [])); return; }
    if (card && card.kind === "pad" && !a.responses.some(r => r.confidence !== undefined)) return setError("Place the dot to continue.");
    setIndex(i => i + 1);
  }
  function completeKnowledge(result: FamiliarityResult) {
    const nextKnowledge = familiarityFields(result);
    const knowledgeChanged = profile.investorAnswers.knowledge !== nextKnowledge.knowledge;
    if (knowledgeChanged) { requested.current = 0; setCards([]); }
    update(knowledgeChanged ? { responses: [], strongest: [] } : {}, { investorAnswers: { ...profile.investorAnswers, ...nextKnowledge } });
    setIndex(i => i + 1);
  }
  function back() { log.back(); setIndex(i => Math.max(SEEDS.clarity, i - 1)); }

  async function finish() {
    if (busy) return;
    if (!profile.permissionConfigured) return setError("Choose how your agent should act.");
    if (profile.permission === "automatic") { const e = limitsError(profile.limits); if (e) return setError(e); }
    const thesis = onboardingThesis(a);
    if (thesis.length > plan.limits.thesisChars) return setError("Shorten your own belief to fit your profile.");
    const positive = a.responses.filter(r => r.direction === "yes" && a.strongest.includes(r.id)).map(r => r.text).join(" ");
    const themes = suggestedThemes(`${positive} ${a.ownBelief}`);
    const completed: InvestingProfile = { ...profile, thesis, themes, investorAnswers: { ...profile.investorAnswers, futureVision: thesis }, step: 6, completedAt: new Date().toISOString() };
    setSaving(true); setError("");
    try {
      if (persist) localStorage.setItem(profileKey(userId), JSON.stringify(completed));
      log.finish(thesis, themes);
      if (onComplete) await onComplete(completed); else router.push("/");
    } catch { setError("Your profile could not be saved. Please try again."); }
    finally { setSaving(false); }
  }

  if (!loaded) return <LoadingState label="Loading…" />;
  const waiting = index >= 0 && !card && !atRules;
  const swiping = waiting || (!!card && !atRules && card.kind === "binary");
  const step = swiping ? (waiting ? 1 : index + 1) : Math.min(TOTAL, index + 3);
  const total = swiping ? PREDICTION_COUNT : TOTAL;
  const title = index === SEEDS.clarity ? CONVICTION_TITLE : index === SEEDS.knowledge ? FAMILIARITY_TITLE : atRules ? "Your outlook. Your rules." : DECK_TITLE;
  const lead = index === SEEDS.clarity ? CONVICTION_LEAD : swiping ? DECK_LEAD : index >= 0 && card && !["binary", "pad"].includes(card.kind) ? card.lead : "";

  return <div className="socialtrading-layout onb" aria-label="Build your Rubicon profile">
    <div className="socialtrading-question">
      <div className="onb-stage" key={`${index}-${card?.id ?? ""}`}>
        <OnboardingCard
          title={title} lead={lead || undefined} step={step} total={total} countLabel={swiping ? "Prediction" : undefined} error={error || serverError}
          onBack={index === SEEDS.clarity ? undefined : back}
          onNext={atRules ? finish : waiting ? undefined : card?.kind === "binary" ? undefined : next}
          nextLabel={atRules ? busy ? "Saving your profile…" : agentCreation ? "Create agent" : "Meet my agent" : "Continue"}
          busy={busy || loading}
          hint={storageError ? <p className="onb-error" role="status">{storageError}</p> : undefined}
        >
          <h1 ref={heading} tabIndex={-1} className="sr-only outline-none">{title}</h1>
          {index === SEEDS.clarity && <FoundationScale kind="clarity" value={a.confidence} onChange={confidence => update({ confidence })} />}
          {index === SEEDS.knowledge && <FamiliarityCheck showTitle={false} hideContinue busy={busy} initialSelectedIds={profile.investorAnswers.selectedConceptIds} onChange={ids => update({}, { investorAnswers: { ...profile.investorAnswers, selectedConceptIds: ids } })} onComplete={completeKnowledge} />}
          {waiting && <DealingDeck backs={2} />}
          {card && !atRules && <CardInput card={card} answers={a} remaining={Math.max(0, cards.length - index - 1)} onAnswer={value => { answer(card, value); if (value.kind === "binary") setIndex(i => i + 1); }} />}
          {atRules && <OnboardingRules
            portrait={onboardingPortrait(a)}
            permission={profile.permission}
            configured={profile.permissionConfigured}
            limits={profile.limits}
            onPermission={value => update({}, { permission: value, permissionConfigured: true })}
            onLimit={(key, value) => update({}, { limits: { ...profile.limits, [key]: value } })}
          />}
        </OnboardingCard>
      </div>
    </div>
    <OnboardingAgentPeek profile={profile} name={name} />
  </div>;
}

/** One generated card's input. Every kind is a plain control — the arm is a test
 * of the questions, not of the widgets. */
function CardInput({ card, answers, remaining = 1, onAnswer }: { card: Card; answers: OnboardingAnswers; remaining?: number; onAnswer: (value: CardAnswer) => void }) {
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [scale, setScale] = useState<number | null>(null);
  // A written question is thrown exactly like one of the deck's, so the two arms
  // ask for an instinct with the same gesture.
  if (card.kind === "binary") return <PredictionDeck card={{ id: card.id, category: card.category, text: card.title }}
    backs={Math.max(1, remaining)} onVote={direction => onAnswer({ kind: "binary", direction })} />;
  if (card.kind === "pad") {
    const target = [...answers.responses].reverse().find(r => answers.strongest.includes(r.id));
    return <PredictionPad response={target ?? { id: card.id, category: card.category, text: card.title, direction: "yes" }} onChange={patch => onAnswer({ kind: "pad", confidence: patch.confidence ?? 75, years: patch.years ?? 7 })} />;
  }
  if (card.kind === "chips") return <div className="onb-chip-grid">{(card.options ?? []).map(option => {
    const on = chips.includes(option);
    return <button type="button" key={option} aria-pressed={on} onClick={() => { const nextChips = on ? chips.filter(c => c !== option) : [...chips, option]; setChips(nextChips); onAnswer({ kind: "chips", values: nextChips }); }}><span className="onb-check">{on ? <Check size={13} /> : "+"}</span>{option}</button>;
  })}</div>;
  if (card.kind === "scale") return <div className="onb-choices">{(card.options ?? []).map((option, i) => <button key={option} type="button" aria-pressed={scale === i} onClick={() => { setScale(i); onAnswer({ kind: "scale", value: i }); }}><span className="mono">0{i + 1}</span><strong>{option}</strong></button>)}</div>;
  return <label className="onb-field">Your answer<textarea maxLength={300} value={text} onChange={e => { setText(e.target.value); onAnswer({ kind: "text", value: e.target.value }); }} placeholder="In your own words…" /></label>;
}
