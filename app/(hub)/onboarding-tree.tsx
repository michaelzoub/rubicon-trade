"use client";
import { Bell, Check, MessageSquare, Orbit, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { profileKey, PERMISSIONS, limitsError, type InvestingProfile, type Permission } from "@/lib/socialtrading/profile";
import { CATEGORIES, CONVICTION_TITLE, DECK_SIZE, DECK_TITLE, DISLIKES, KEYWORDS, SCENE, basePrediction, deckProgress, isBaseId, newOnboarding, nextPrediction, onboardingThesis, resolveScene, sceneOrder, type OnboardingAnswers, type PredictionResponse } from "@/lib/socialtrading/onboarding";
import { DEFAULT_PLAN } from "@/lib/socialtrading/plans";
import { suggestedThemes } from "@/lib/socialtrading/themes";
import { LoadingState } from "../_components/ui";
import { FAMILIARITY_TITLE, familiarityFields, scoreFamiliarity, type FamiliarityResult } from "@/lib/socialtrading/familiarity";
import { FoundationScale } from "./onboarding-drag";
import { FamiliarityCheck } from "./familiarity-check";
import { InferredSwipeDeck, iconFor, type DeckCard, type Direction } from "./onboarding-deck";
import { DislikeVoid } from "./onboarding-void";
import { PredictionPad } from "./onboarding-chart";
import { GeographyMap } from "./onboarding-geo";
import { OnboardingCard } from "./onboarding-card";
import { fetchPredictionDeck, type DeckFetcher } from "./onboarding-client";
import { useProfileStore, useRunLog, type ArmProps } from "./onboarding-session";
import "./onboarding.css";

const PERMISSION_ICONS = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal };
/** One line per scene. Everything else a scene has to say, it says by being
 * touched — there are no leads, eyebrows or helper paragraphs under these.
 * Positional with SCENE; the opening chart borrows the AI question itself. */
const TITLES = [CONVICTION_TITLE, FAMILIARITY_TITLE, "", "Where could conflict reshape markets?", DECK_TITLE, "Which views do you feel strongest about?", "Draw your prediction.", "What doesn’t belong in your future?", "Your outlook. Your rules."];
const KINDS = ["scale", "chips", "pad", "map", "binary", "chips", "pad", "chips", "rules"];

/** The decision-tree arm. Everyone answers the same two opening questions — how
 * far AI goes, on the chart, and where in the world it lands, on the map — and
 * then swipes the other six domains at their knowledge level. Those answers
 * shape the profile and the scenes after the deck, not the next swipe. */
export function TreeOnboarding({ userId, onComplete, completing = false, serverError = "", persist = true, agentCreation = false, plan = DEFAULT_PLAN, variant, forced, fetchDeck = fetchPredictionDeck }: ArmProps & { fetchDeck?: DeckFetcher }) {
  const router = useRouter();
  const { profile, setProfile, loaded, storageError } = useProfileStore(userId, persist);
  const log = useRunLog(variant, forced);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const a = profile.investorAnswers.onboarding ?? newOnboarding();
  const knowledge = profile.investorAnswers.knowledge ?? 0;
  const scene = resolveScene(a);
  const order = sceneOrder(a);
  const base = basePrediction(knowledge);
  const seeded = a.responses.find(r => r.id === base.id) ?? { ...base, direction: "yes" as const };
  const upcoming = nextPrediction(a, knowledge);
  const candidates = a.responses.filter(r => r.direction !== "unsure");
  const positive = a.responses.filter(r => r.direction === "yes" && a.strongest.includes(r.id)).map(r => r.text).join(" ");
  const busy = completing || saving;
  useEffect(() => {
    if (loaded) log.enter(`scene-${scene}`, KINDS[scene]);
  }, [scene, loaded, log]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (heading.current && heading.current.getBoundingClientRect().top < 96) heading.current.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [scene, loaded]);
  /** Patches may be functions of the latest answers, so two commits landing in
   * one gesture (a pad drag sets confidence and horizon together) never overwrite each other. */
  function update(patch: Partial<OnboardingAnswers> | ((current: OnboardingAnswers) => Partial<OnboardingAnswers>), extra: Partial<InvestingProfile> = {}) {
    setError("");
    setProfile(p => { const current = p.investorAnswers.onboarding ?? newOnboarding(); return { ...p, ...extra, completedAt: null, updatedAt: new Date().toISOString(), investorAnswers: { ...p.investorAnswers, ...extra.investorAnswers, onboarding: { ...current, ...(typeof patch === "function" ? patch(current) : patch) } } }; });
  }
  function answers(patch: Partial<InvestingProfile["investorAnswers"]>) { update({}, { investorAnswers: { ...profile.investorAnswers, ...patch } }); }
  /** The opening chart writes the whole base response — side, conviction and
   * horizon — from one dot, and keeps it first in the list so the deck can
   * branch off it. */
  function placeBase(patch: Partial<PredictionResponse>) {
    update(current => ({ responses: current.responses.some(r => r.id === base.id)
      ? current.responses.map(r => r.id === base.id ? { ...r, ...patch } : r)
      : [{ ...base, direction: "yes" as const, ...patch }, ...current.responses] }));
  }
  function vote(direction: Direction, card: DeckCard) {
    if (!upcoming) return;
    const responses = [...a.responses, { id: upcoming.id, category: upcoming.category, text: card.text, direction }];
    update({ responses, scene: nextPrediction({ ...a, responses }, knowledge) ? SCENE.deck : SCENE.strongest });
  }
  function go(direction: 1 | -1) {
    const target = order[order.indexOf(scene) + direction];
    if (target !== undefined) update({ scene: target });
  }
  function completeKnowledge(result: FamiliarityResult) {
    const nextKnowledge = familiarityFields(result);
    const knowledgeChanged = profile.investorAnswers.knowledge !== nextKnowledge.knowledge;
    const target = order[order.indexOf(scene) + 1];
    if (target === undefined) return;
    update({ scene: target, ...(knowledgeChanged ? { responses: [], strongest: [] } : {}) }, { investorAnswers: { ...profile.investorAnswers, ...nextKnowledge } });
  }
  function next() {
    if (scene === SCENE.clarity && a.confidence === null) return setError("Choose how strong your convictions are.");
    if (scene === SCENE.knowledge) { completeKnowledge(scoreFamiliarity(profile.investorAnswers.selectedConceptIds ?? [])); return; }
    if (scene === SCENE.horizon && !a.responses.some(r => r.id === base.id && r.confidence !== undefined)) return setError("Place the dot to say how sure you are.");
    if (scene === SCENE.strongest && candidates.length && !a.strongest.length) return setError("Choose one or two views to explore more deeply.");
    if (scene === SCENE.chart && a.responses.some(r => a.strongest.includes(r.id) && (r.confidence === undefined || r.years === undefined))) return setError("Place the dot for each prediction.");
    if (scene === SCENE.dislikes && !a.dislikes.length && !a.openToEverything) return setError("Send a theme into the black hole, or choose ‘I’m open to everything’.");
    go(1);
  }
  function back() {
    log.back();
    // Stepping back off the shortlist returns the last thrown card to the deck.
    if (scene === SCENE.strongest && a.responses.length > 1) { update({ scene: SCENE.deck, responses: a.responses.slice(0, -1), strongest: [] }); return; }
    go(-1);
  }
  function dislike(value: string) { update({ dislikes: a.dislikes.includes(value) ? a.dislikes.filter(d => d !== value) : [...a.dislikes, value], openToEverything: false }); }
  function place(id: string, patch: Partial<PredictionResponse>) { update(current => ({ responses: current.responses.map(r => r.id === id ? { ...r, ...patch } : r) })); }
  async function finish() {
    if (busy) return;
    if (!profile.permissionConfigured) return setError("Choose how your agent should act.");
    if (profile.permission === "automatic") { const e = limitsError(profile.limits); if (e) return setError(e); }
    const thesis = onboardingThesis(a);
    if (thesis.length > plan.limits.thesisChars) return setError("Shorten your own belief to fit your profile.");
    // Negative answers are retained, but must not turn into positive theme interests.
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
  const index = order.indexOf(scene);
  const step = index + (scene === SCENE.deck ? deckProgress(a) / DECK_SIZE : 1);
  const title = scene === SCENE.horizon ? base.text : TITLES[scene];
  return <div className="socialtrading-layout onb" aria-label="Build your Rubicon profile">
    <div className="socialtrading-question">
      <div className="onb-stage" key={scene}>
        <OnboardingCard
          title={title} step={step} total={order.length}
          error={error || serverError}
          onBack={scene === SCENE.clarity ? undefined : back}
          onNext={scene === SCENE.deck ? undefined : scene === SCENE.rules ? finish : next}
          nextLabel={scene === SCENE.rules ? busy ? "Saving your profile…" : agentCreation ? "Create agent" : "Meet my agent" : "Continue"}
          busy={busy}
          hint={storageError ? <p className="onb-error" role="status">{storageError}</p> : undefined}
        >
          <h1 ref={heading} tabIndex={-1} className="sr-only outline-none">{title}</h1>
          {scene === SCENE.clarity && <FoundationScale kind="clarity" value={a.confidence} onChange={confidence => update({ confidence })} />}
          {scene === SCENE.knowledge && <FamiliarityCheck showTitle={false} hideContinue busy={busy} initialSelectedIds={profile.investorAnswers.selectedConceptIds} onChange={ids => update({}, { investorAnswers: { ...profile.investorAnswers, selectedConceptIds: ids } })} onComplete={completeKnowledge} />}
          {scene === SCENE.horizon && <PredictionPad stance response={seeded} onChange={placeBase} />}
          {scene === SCENE.geography && <GeographyMap selected={profile.investorAnswers.conflictCountries} thesis={profile.investorAnswers.geopoliticalThesis} onSelected={conflictCountries => answers({ conflictCountries })} onThesis={geopoliticalThesis => answers({ geopoliticalThesis })} />}
          {scene === SCENE.deck && upcoming && <InferredSwipeDeck
            upcoming={upcoming} knowledge={profile.investorAnswers.knowledge} confidence={a.confidence}
            fetchDeck={fetchDeck} backs={Math.max(0, DECK_SIZE - deckProgress(a) - 1)} answered={deckProgress(a)} total={DECK_SIZE} onVote={vote}
            onUndo={a.responses.length > 1 ? () => { log.back(); update({ responses: a.responses.slice(0, -1), strongest: [] }); } : undefined} />}
          {scene === SCENE.strongest && <>
            {!candidates.length && <div className="onb-empty"><Orbit size={34} strokeWidth={1.4} /><h2>Curiosity is a good starting point.</h2><p>Your agent can explore these possibilities with you.</p></div>}
            <div className="onb-picks">{candidates.map(r => {
              const PickIcon = iconFor(r.category);
              const on = a.strongest.includes(r.id);
              return <button type="button" key={r.id} className="onb-pick" aria-pressed={on} title={r.text}
                aria-label={`${r.direction === "yes" ? "I see it" : "I don’t see it"}: ${r.text}`}
                disabled={!on && a.strongest.length === 2}
                onClick={() => update({ strongest: on ? a.strongest.filter(id => id !== r.id) : [...a.strongest, r.id] })}>
                <PickIcon size={24} strokeWidth={1.4} aria-hidden="true" />
                <strong>{KEYWORDS[CATEGORIES.indexOf(r.category)] ?? r.category}</strong>
                <span className={`onb-direction ${r.direction}`} aria-hidden="true">{r.direction === "yes" ? "I see it" : "I don’t"}</span>
              </button>;
            })}</div>
            {(a.confidence ?? 0) >= 2 && <label className="onb-field onb-own"><span className="sr-only">A belief of your own</span>
              <textarea maxLength={300} value={a.ownBelief} onChange={e => update({ ownBelief: e.target.value })} placeholder="I believe the next big change will be…" /></label>}
          </>}
          {scene === SCENE.chart && <div className="onb-charts">{a.responses.filter(r => a.strongest.includes(r.id) && !isBaseId(r.id)).map(r => <PredictionPad key={r.id} response={r} onChange={patch => place(r.id, patch)} />)}</div>}
          {scene === SCENE.dislikes && <DislikeVoid values={DISLIKES} released={a.dislikes} openToEverything={a.openToEverything}
            onRelease={dislike} onRestore={dislike} onToggleOpen={() => update({ openToEverything: !a.openToEverything, dislikes: [] })} />}
          {scene === SCENE.rules && <>
            <div className="onb-summary"><Sparkles size={18} strokeWidth={1.6} /><div><p>{onboardingThesis(a)}</p><small>{a.dislikes.length ? `Strong dislikes: ${a.dislikes.join(" · ")}` : "Open to all themes"}{profile.investorAnswers.conflictCountries.length ? ` · Watching ${profile.investorAnswers.conflictCountries.join(", ")}` : ""}</small></div></div>
            <fieldset className="onb-permissions"><legend>How should your agent act?</legend>{(Object.entries(PERMISSIONS) as [Permission, string][]).map(([value, label]) => { const PermissionIcon = PERMISSION_ICONS[value]; const selected = profile.permissionConfigured && profile.permission === value; return <label key={value} className="onb-option"><input type="radio" name="permission" value={value} checked={selected} onChange={() => update({}, { permission: value, permissionConfigured: true })} /><PermissionIcon size={17} strokeWidth={1.5} aria-hidden="true" /><span>{label}</span><span className="onb-check" aria-hidden="true">{selected && <Check size={12} />}</span></label>; })}</fieldset>
            {profile.permissionConfigured && profile.permission === "automatic" && <div className="onb-limits">{([["perTrade", "Maximum per trade"], ["daily", "Daily limit"], ["weekly", "Weekly limit"]] as const).map(([key, label]) => <label key={key}>{label} · USD<input type="number" inputMode="decimal" min="0.01" step="0.01" value={profile.limits[key]} onChange={e => update({}, { limits: { ...profile.limits, [key]: e.target.value } })} /></label>)}</div>}
          </>}
        </OnboardingCard>
      </div>
    </div>
  </div>;
}
