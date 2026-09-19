"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { profileKey, limitsError, type InvestingProfile } from "@/lib/socialtrading/profile";
import { CONVICTION_LEAD, CONVICTION_TITLE, DECK_LEAD, DECK_TITLE, newOnboarding, onboardingPortrait, onboardingThesis, type OnboardingAnswers } from "@/lib/socialtrading/onboarding";
import { applyAnswer, type CardKind } from "@/lib/socialtrading/onboarding-cards";
import { DEFAULT_PLAN } from "@/lib/socialtrading/plans";
import { suggestedThemes } from "@/lib/socialtrading/themes";
import { LoadingState } from "../_components/ui";
import { FAMILIARITY_TITLE, familiarityFields, scoreFamiliarity, type FamiliarityResult } from "@/lib/socialtrading/familiarity";
import { getNextProfileProbe, MAX_PROBES, type Probe } from "@/lib/socialtrading/profile-probe";
import { newProfileModel, recordEvidence, type Evidence, type ProbeAnswer, type ProfileModel } from "@/lib/socialtrading/profile-model";
import { FoundationScale, SmoothRange, intervalAt } from "./onboarding-drag";
import { FamiliarityCheck } from "./familiarity-check";
import { GeographyMap } from "./onboarding-geo";
import { PredictionPad } from "./onboarding-chart";
import { PredictionDeck, DealingDeck } from "./onboarding-deck";
import { OnboardingAgentPeek } from "./onboarding-agent";
import { OnboardingCard } from "./onboarding-card";
import { OnboardingRules } from "./onboarding-rules";
import { fetchNextProbe, type ProbeFetcher } from "./onboarding-client";
import { useProfileStore, useRunLog, type ArmProps } from "./onboarding-session";
import "./onboarding.css";

/** Two foundations, up to seven probes, then the rules. Seven is a ceiling:
 * a run that runs out of worthwhile questions stops short of it. */
const TOTAL = 2 + MAX_PROBES + 1;
const SEEDS = { clarity: -2, knowledge: -1 } as const;

/** A probe kind names an interaction; a card kind names an answer shape.
 * `applyAnswer` speaks the second, so the two are mapped rather than merged.
 *
 * `map` is deliberately absent from the parameter type. A map answer goes
 * straight into `ownBelief` and never reaches `applyAnswer`, so the compiler
 * proves that branch cannot exist rather than us carrying a line that never
 * runs. The one call site narrows with `answer.kind === "map"` first. */
const cardKind = (kind: Exclude<Probe["kind"], "map">): CardKind =>
  kind === "spectrum" ? "scale" : kind === "choice" ? "binary" : kind;

/**
 * The adaptive arm. The two foundations seed a profile model; after that every
 * answer is recorded as evidence, sent to Jev to be read, and the sequencer
 * returns the next probe from what it still does not know. Nothing here decides
 * what an answer means — that is the model's job, on the next turn.
 */
export function AdaptiveOnboarding({ userId, name, onComplete, completing = false, serverError = "", persist = true, agentCreation = false, plan = DEFAULT_PLAN, variant, forced, fetchProbe = fetchNextProbe }: ArmProps & { fetchProbe?: ProbeFetcher }) {
  const router = useRouter();
  const { profile, setProfile, loaded, storageError } = useProfileStore(userId, persist);
  const log = useRunLog(variant, forced);
  const [index, setIndex] = useState<number>(SEEDS.clarity);
  const [model, setModel] = useState<ProfileModel>(newProfileModel);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const a = profile.investorAnswers.onboarding ?? newOnboarding();
  const knowledge = profile.investorAnswers.knowledge;
  const busy = completing || saving;

  function update(patch: Partial<OnboardingAnswers>, extra: Partial<InvestingProfile> = {}) {
    setError("");
    setProfile(p => { const current = p.investorAnswers.onboarding ?? newOnboarding(); return { ...p, ...extra, completedAt: null, updatedAt: new Date().toISOString(), investorAnswers: { ...p.investorAnswers, ...extra.investorAnswers, onboarding: { ...current, ...patch } } }; });
  }

  /** One turn. A failed request falls back to the local sequencer over the
   * model we already hold, so an unreachable endpoint walks the seven domains
   * rather than stranding anyone mid-run. */
  const advance = useCallback(async (current: ProfileModel) => {
    setLoading(true);
    try {
      const result = await fetchProbe({ model: current, knowledge, confidence: a.confidence, answers: a });
      log.setSource(result.model.source === "jev" ? "jev" : "fallback");
      setModel(result.model);
      setProbe(result.probe);
      setDone(!result.probe);
    } catch {
      log.setSource("fallback");
      const local = getNextProfileProbe(current, { knowledge: knowledge ?? 0, confidence: a.confidence ?? 0, answers: a });
      setProbe(local);
      setDone(!local);
    } finally { setLoading(false); }
  }, [fetchProbe, knowledge, a, log]);

  useEffect(() => {
    if (!loaded || index < 0 || probe || done || loading) return;
    void advance(model);
    // `advance` closes over the answers, which change on every write; re-running
    // on that identity would fire a turn per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, index, probe, done, loading]);

  /** An answer is two separate writes: the evidence entry, and the same answer
   * folded into `OnboardingAnswers` so the thesis reads identically to the
   * other two arms. Neither one touches `beliefs`. */
  function answerProbe(p: Probe, answer: ProbeAnswer) {
    const entry: Evidence = { id: p.id, at: new Date().toISOString(), kind: p.kind, prompt: p.title, topics: p.topics, answer };
    const next = recordEvidence(model, entry);
    setModel(next);
    setProbe(null);
    // A map probe always yields a map answer. Narrowing on both keeps that
    // guarantee visible to the compiler rather than asserting it.
    if (p.kind === "map" && answer.kind === "map") update({ ownBelief: `${a.ownBelief} ${p.title} ${answer.regions.join(", ")}.`.trim().slice(0, 300) });
    else if (p.kind !== "map" && answer.kind !== "map") update(applyAnswer(a, { id: p.id, kind: cardKind(p.kind), title: p.title, lead: p.lead, category: p.category, ...(p.options ? { options: p.options } : {}) }, answer));
    void advance(next);
  }

  // Identify the position by a stable string. While a turn is in flight there
  // is no probe at all — logging that gap would invent questions that never showed.
  const logged = done ? { id: "rules", kind: "rules" }
    : index === SEEDS.clarity ? { id: "clarity", kind: "scale" }
    : index === SEEDS.knowledge ? { id: "knowledge", kind: "chips" }
    : probe ? { id: probe.id, kind: probe.kind } : null;
  useEffect(() => {
    if (loaded && logged) log.enter(logged.id, logged.kind);
  }, [loaded, logged?.id, logged?.kind, log]);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [index, probe?.id]);

  function next() {
    if (index === SEEDS.clarity && a.confidence === null) return setError("Choose how sure you are about the future.");
    if (index === SEEDS.knowledge) { completeKnowledge(scoreFamiliarity(profile.investorAnswers.selectedConceptIds ?? [])); return; }
    // Clarity hands over to knowledge; knowledge hands over to the probe loop,
    // which is index 0 and from there is driven by the sequencer, not the index.
    setIndex(SEEDS.knowledge);
  }
  function completeKnowledge(result: FamiliarityResult) {
    update({}, { investorAnswers: { ...profile.investorAnswers, ...familiarityFields(result) } });
    setIndex(0);
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
  const waiting = index >= 0 && !probe && !done;
  const swiping = waiting || (!!probe && !done && probe.kind === "choice");
  const step = swiping ? model.turn + 1 : Math.min(TOTAL, model.turn + 3);
  const total = swiping ? MAX_PROBES : TOTAL;
  const title = index === SEEDS.clarity ? CONVICTION_TITLE
    : index === SEEDS.knowledge ? FAMILIARITY_TITLE
    : done ? "Your outlook. Your rules."
    : swiping ? DECK_TITLE
    : probe?.title ?? "Reading what you have told us…";
  const lead = index === SEEDS.clarity ? CONVICTION_LEAD : swiping ? DECK_LEAD : probe && !done && ["chips", "text", "map", "pad"].includes(probe.kind) ? probe.lead : "";

  return <div className="socialtrading-layout onb" aria-label="Build your Rubicon profile">
    <div className="socialtrading-question">
      <div className="onb-stage" key={`${index}-${probe?.id ?? ""}`}>
        <OnboardingCard
          title={title} lead={lead || undefined} step={step} total={total} countLabel={swiping ? "Prediction" : undefined} error={error || serverError}
          onBack={index === SEEDS.clarity ? undefined : back}
          onNext={done ? finish : waiting ? undefined : probe?.kind === "choice" ? undefined : next}
          nextLabel={done ? busy ? "Saving your profile…" : agentCreation ? "Create agent" : "Meet my agent" : "Continue"}
          busy={busy || loading}
          hint={storageError ? <p className="onb-error" role="status">{storageError}</p> : undefined}
        >
          <h1 ref={heading} tabIndex={-1} className="sr-only outline-none">{title}</h1>
          {index === SEEDS.clarity && <FoundationScale kind="clarity" value={a.confidence} onChange={confidence => update({ confidence })} />}
          {index === SEEDS.knowledge && <FamiliarityCheck showTitle={false} hideContinue busy={busy} initialSelectedIds={profile.investorAnswers.selectedConceptIds} onChange={ids => update({}, { investorAnswers: { ...profile.investorAnswers, selectedConceptIds: ids } })} onComplete={completeKnowledge} />}
          {waiting && <DealingDeck backs={2} />}
          {probe && !done && <ProbeInput probe={probe} remaining={Math.max(1, MAX_PROBES - model.turn - 1)} onAnswer={answer => answerProbe(probe, answer)} />}
          {done && <OnboardingRules
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

/** One probe's input. Every kind is a component onboarding already has — the
 * arm is a test of the sequencing, not of the widgets. `choice` commits itself
 * on the swipe; every other kind answers on each interaction, so the card's
 * Continue button simply moves on. */
function ProbeInput({ probe, remaining = 1, onAnswer }: { probe: Probe; remaining?: number; onAnswer: (value: ProbeAnswer) => void }) {
  const [position, setPosition] = useState(0.5);
  const [regions, setRegions] = useState<string[]>([]);
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState("");

  if (probe.kind === "choice") return <PredictionDeck card={{ id: probe.id, category: probe.category, text: probe.title }}
    backs={remaining} onVote={direction => onAnswer({ kind: "binary", direction })} />;

  if (probe.kind === "spectrum") {
    const stops = probe.options ?? [];
    return <SmoothRange value={position} label={probe.title} valueText={stops[intervalAt(position)] ?? ""}
      onChange={setPosition} onCommit={value => onAnswer({ kind: "scale", value: intervalAt(value) })} />;
  }

  if (probe.kind === "map") return <GeographyMap selected={regions} thesis=""
    onSelected={next => { setRegions(next); onAnswer({ kind: "map", regions: next }); }} onThesis={() => {}} />;

  if (probe.kind === "pad") return <PredictionPad response={{ id: probe.id, category: probe.category, text: probe.title, direction: "yes" }}
    onChange={patch => onAnswer({ kind: "pad", confidence: patch.confidence ?? 75, years: patch.years ?? 7 })} />;

  if (probe.kind === "chips") return <div className="onb-chip-grid">{(probe.options ?? []).map(option => {
    const on = chips.includes(option);
    return <button type="button" key={option} aria-pressed={on} onClick={() => { const nextChips = on ? chips.filter(c => c !== option) : [...chips, option]; setChips(nextChips); onAnswer({ kind: "chips", values: nextChips }); }}><span className="onb-check">{on ? <Check size={13} /> : "+"}</span>{option}</button>;
  })}</div>;

  return <label className="onb-field">Your answer<textarea maxLength={300} value={text} onChange={e => { setText(e.target.value); onAnswer({ kind: "text", value: e.target.value }); }} placeholder="In your own words…" /></label>;
}
