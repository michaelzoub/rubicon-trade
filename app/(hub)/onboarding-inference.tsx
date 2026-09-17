"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, MessageSquare, SlidersHorizontal, Sparkles } from "lucide-react";
import { profileKey, PERMISSIONS, limitsError, type InvestingProfile, type Permission } from "@/lib/socialtrading/profile";
import { newOnboarding, onboardingThesis, predictions, type OnboardingAnswers } from "@/lib/socialtrading/onboarding";
import { applyAnswer, type Card, type CardAnswer } from "@/lib/socialtrading/onboarding-cards";
import { DEFAULT_PLAN } from "@/lib/socialtrading/plans";
import { suggestedThemes } from "@/lib/socialtrading/themes";
import { generatedAgentName } from "@/lib/socialtrading/agents/naming";
import { LoadingState } from "../_components/ui";
import { ProfileCard } from "./profile-card";
import { FoundationScale } from "./onboarding-drag";
import { PredictionPad } from "./onboarding-chart";
import { PredictionDeck } from "./onboarding-deck";
import { OnboardingCard } from "./onboarding-card";
import { fetchNextCard, type CardFetcher } from "./onboarding-client";
import { useProfileStore, useRunLog, type ArmProps } from "./onboarding-session";
import "./onboarding.css";

const PERMISSION_ICONS = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal };
/** Two foundations, one seed view, up to four written cards, then the rules. */
const MAX_GENERATED = 4, TOTAL = 3 + MAX_GENERATED + 1;
const SEEDS = { clarity: -3, knowledge: -2, seed: -1 } as const;

const seedCard = (knowledge: number): Card => {
  const first = predictions(knowledge)[0];
  return { id: "seed-0", kind: "binary", title: first.text, lead: "", category: first.category };
};

/** The inference arm: after three shared foundations, the agent writes each next
 * question from what it has already learned. When the model is unavailable it
 * falls back to the tree's questions and records that, so a fallback run is
 * never counted as inference. */
export function InferenceOnboarding({ userId, name, onComplete, completing = false, serverError = "", persist = true, agentCreation = false, plan = DEFAULT_PLAN, variant, forced, nextCard = fetchNextCard }: ArmProps & { nextCard?: CardFetcher }) {
  const router = useRouter();
  const { profile, setProfile, loaded, storageError } = useProfileStore(userId, persist);
  const log = useRunLog(variant, forced);
  const [index, setIndex] = useState<number>(SEEDS.clarity);
  const [cards, setCards] = useState<Card[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const requested = useRef(0);
  const a = profile.investorAnswers.onboarding ?? newOnboarding();
  const knowledge = profile.investorAnswers.knowledge;
  const busy = completing || saving;
  const card = index >= 0 ? cards[index] : index === SEEDS.seed && knowledge !== null ? seedCard(knowledge) : undefined;
  const atRules = done && index >= cards.length;

  function update(patch: Partial<OnboardingAnswers>, extra: Partial<InvestingProfile> = {}) {
    setError("");
    setProfile(p => { const current = p.investorAnswers.onboarding ?? newOnboarding(); return { ...p, ...extra, completedAt: null, updatedAt: new Date().toISOString(), investorAnswers: { ...p.investorAnswers, ...extra.investorAnswers, onboarding: { ...current, ...patch } } }; });
  }
  const answer = (c: Card, value: CardAnswer) => update(applyAnswer(a, c, value));

  /** Asks for the next card once per position. A failure drops the arm onto the
   * tree's remaining questions rather than stranding anyone mid-onboarding. */
  const request = useCallback(async (position: number) => {
    if (requested.current > position) return;
    requested.current = position + 1;
    setLoading(true); setNotice("");
    const controller = new AbortController();
    try {
      const result = await nextCard({
        confidence: a.confidence, knowledge,
        priors: a.responses.map(r => ({ text: r.text, direction: r.direction, category: r.category, ...(r.confidence ? { confidence: r.confidence } : {}), ...(r.years ? { years: r.years } : {}) })),
        ownBelief: a.ownBelief, asked: cards.map(c => c.title), kinds: cards.map(c => c.kind),
      }, controller.signal);
      if (result.done) setDone(true); else setCards(list => [...list, result.card]);
    } catch {
      // The tree's own questions, so the run still finishes and still produces a thesis.
      const remaining = predictions(knowledge ?? 0).slice(cards.length + 1, cards.length + 2)[0];
      log.setSource("fallback");
      setNotice("Your agent couldn’t write this one, so here’s a standard question.");
      if (remaining) setCards(list => [...list, { id: `fallback-${remaining.id}`, kind: "binary", title: remaining.text, lead: "", category: remaining.category }]);
      else setDone(true);
    } finally { setLoading(false); }
  }, [a.confidence, a.responses, a.ownBelief, cards, knowledge, log, nextCard]);

  useEffect(() => {
    if (!loaded || index < 0 || done) return;
    if (index >= cards.length && cards.length < MAX_GENERATED) void request(cards.length);
    else if (index >= cards.length) setDone(true);
  }, [index, cards.length, done, loaded, request]);

  // Identify the position by a stable string. The seed card is rebuilt on every
  // render, and while a generated card is in flight there is no card at all —
  // logging either of those by object identity invented cards that never showed.
  const position = atRules ? { id: "rules", kind: "rules" }
    : index === SEEDS.clarity ? { id: "clarity", kind: "scale" }
    : index === SEEDS.knowledge ? { id: "knowledge", kind: "scale" }
    : card ? { id: card.id, kind: card.kind } : null;
  useEffect(() => {
    if (loaded && position) log.enter(position.id, position.kind);
  }, [loaded, position?.id, position?.kind, log]);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [index]);

  function next() {
    if (index === SEEDS.clarity && a.confidence === null) return setError("Choose how clear the future feels to you.");
    if (index === SEEDS.knowledge && knowledge === null) return setError("Choose a stop on your investing journey.");
    if (card && card.kind === "pad" && !a.responses.some(r => r.confidence !== undefined)) return setError("Place the dot to continue.");
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

  if (!loaded) return <LoadingState label="Loading your profile…" />;
  const positive = a.responses.filter(r => r.direction === "yes" && a.strongest.includes(r.id)).map(r => r.text).join(" ");
  const preview: InvestingProfile = { ...profile, thesis: a.strongest.length || a.ownBelief.trim() ? onboardingThesis(a) : "", themes: suggestedThemes(`${positive} ${a.ownBelief}`), step: atRules ? 5 : index >= 1 ? 4 : index >= 0 ? 3 : 2 };
  const step = Math.min(TOTAL, index + 4);
  const title = index === SEEDS.clarity ? "How much of the future already feels clear to you?" : index === SEEDS.knowledge ? "How familiar does investing feel?" : atRules ? "Your outlook. Your rules." : card?.title ?? "Your agent is thinking…";
  // A generated card may need a second line; the fixed scenes never do, and a
  // card you answer by swiping or dragging explains itself without one.
  const lead = index >= 0 && card && !["binary", "pad"].includes(card.kind) ? card.lead : "";

  return <div className="socialtrading-layout onb" aria-label="Build your Rubicon profile">
    <div className="socialtrading-question">
      <div className="onb-stage" key={`${index}-${card?.id ?? ""}`}>
        <OnboardingCard
          title={title} lead={lead || undefined} quietTitle={card?.kind === "binary" && !atRules} step={step} total={TOTAL} error={error || serverError}
          onBack={index === SEEDS.clarity ? undefined : back}
          onNext={atRules ? finish : loading ? undefined : card?.kind === "binary" ? undefined : next}
          nextLabel={atRules ? busy ? "Saving your profile…" : agentCreation ? "Create agent" : "Meet my agent" : "Continue"}
          busy={busy || loading}
          hint={<>
            {notice && <p className="onb-hint">{notice}</p>}
            {storageError && <p className="onb-error" role="status">{storageError}</p>}
          </>}
        >
          <h1 ref={heading} tabIndex={-1} className="sr-only outline-none">{title}</h1>
          {index === SEEDS.clarity && <FoundationScale kind="clarity" value={a.confidence} onChange={confidence => update({ confidence })} />}
          {index === SEEDS.knowledge && <FoundationScale kind="knowledge" value={knowledge} onChange={value => update({ responses: [], strongest: [] }, { investorAnswers: { ...profile.investorAnswers, knowledge: value } })} />}
          {loading && !card && <div className="onb-thinking" role="status"><Sparkles size={18} strokeWidth={1.6} /><span>Reading what you’ve told it so far…</span></div>}
          {card && !atRules && <CardInput card={card} answers={a} onAnswer={value => { answer(card, value); if (value.kind === "binary") setIndex(i => i + 1); }} />}
          {atRules && <>
            <div className="onb-summary"><Sparkles size={18} strokeWidth={1.6} /><div><p>{onboardingThesis(a)}</p></div></div>
            <fieldset className="onb-permissions"><legend>How should your agent act?</legend>{(Object.entries(PERMISSIONS) as [Permission, string][]).map(([value, label]) => { const PermissionIcon = PERMISSION_ICONS[value]; const selected = profile.permissionConfigured && profile.permission === value; return <label key={value} className="onb-option"><input type="radio" name="permission" value={value} checked={selected} onChange={() => update({}, { permission: value, permissionConfigured: true })} /><PermissionIcon size={17} strokeWidth={1.5} aria-hidden="true" /><span>{label}</span><span className="onb-check" aria-hidden="true">{selected && <Check size={12} />}</span></label>; })}</fieldset>
            {profile.permissionConfigured && profile.permission === "automatic" && <div className="onb-limits">{([["perTrade", "Maximum per trade"], ["daily", "Daily limit"], ["weekly", "Weekly limit"]] as const).map(([key, label]) => <label key={key}>{label} · USD<input type="number" inputMode="decimal" min="0.01" step="0.01" value={profile.limits[key]} onChange={e => update({}, { limits: { ...profile.limits, [key]: e.target.value } })} /></label>)}</div>}
          </>}
        </OnboardingCard>
      </div>
    </div>
    <ProfileCard profile={preview} name={name} agentName={agentCreation ? generatedAgentName(preview, name, userId) : undefined} />
  </div>;
}

/** One generated card's input. Every kind is a plain control — the arm is a test
 * of the questions, not of the widgets. */
function CardInput({ card, answers, onAnswer }: { card: Card; answers: OnboardingAnswers; onAnswer: (value: CardAnswer) => void }) {
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [scale, setScale] = useState<number | null>(null);
  // A written question is thrown exactly like one of the deck's, so the two arms
  // ask for an instinct with the same gesture.
  if (card.kind === "binary") return <PredictionDeck card={{ id: card.id, category: card.category, text: card.title }}
    onVote={direction => onAnswer({ kind: "binary", direction })} />;
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
