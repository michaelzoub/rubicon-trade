"use client";

import { Check } from "lucide-react";
import { useRef } from "react";
import { MODELS, TIER_COPY, type Model, type ModelTier } from "@/lib/socialtrading/models";
import { FEATURED_PLAN, PLANS, PLAN_ORDER, formatCredits, formatLimit, type Plan, type PlanId } from "@/lib/socialtrading/plans";
import { gsap, rubiconMotion, useGSAP } from "../../_components/motion";
import { useHub } from "./hub-provider";
import { HubLink as Link } from "./navigation";

/** The tier a plan's card leads with, and the tier it inherits from the plan below. */
const TOP_TIER: Record<PlanId, ModelTier> = { free: "fast", plus: "capable", pro: "frontier" };

/** What one card says about the room a plan gives you. Four rows, no more: the page is a
 * decision, not an audit. `value` reads the plan's own limits so copy can never drift. */
function room(plan: Plan): { label: string; value: string }[] {
  const monthly = plan.credits.monthlyMicros;
  return [
    { label: "Credits", value: monthly ? `${formatCredits(monthly)} a month` : `${formatCredits(plan.credits.startingMicros)} to start` },
    { label: "Assets followed", value: formatLimit(plan.limits.follows) },
    { label: "Agents", value: `${formatLimit(plan.limits.agents)}, ${formatLimit(plan.limits.enabledAgents)} running` },
    { label: "Memory", value: Number.isFinite(plan.limits.learnedAssets) ? `${formatLimit(plan.limits.learnedAssets)} assets` : "No limit" },
  ];
}

/**
 * The plans page. Surfaces stay white and the Rubicon light does the talking, so the ladder is
 * lit rather than coloured: Free sits flat on the page, Plus is raised into the light, Pro holds
 * the deepest one. The model list is the argument — four frontier labs against two fast ones —
 * so nothing decorates it.
 */
export function PlansView() {
  const { account } = useHub();
  const current: PlanId = account?.planId ?? "free";
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-plan-card]", { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: .7, stagger: .09, delay: .12, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root });

  return <div ref={root} className="hub-plans">
    <span className="hub-plans-light" aria-hidden="true" />

    <header className="hub-view-head hub-plans-head">
      <p className="eyebrow">Plans</p>
      <h1 className="landing-section-title">Give your agent a better mind.</h1>
      <p>Every plan runs the same agent. What changes is which models it can think with, and how much of you it can hold on to.</p>
    </header>

    <div className="hub-plans-grid" role="list">
      {PLAN_ORDER.map(id => <PlanCard key={id} plan={PLANS[id]} current={current} />)}
    </div>

    <footer className="hub-plans-foot">
      <p>Credits pay for model usage at what the provider charges, to the request. Your agent picks the right model for each question on its own — there is nothing to configure.</p>
      <Link className="hub-inline-link" href="/profile">See your usage</Link>
    </footer>
  </div>;
}

function PlanCard({ plan, current }: { plan: Plan; current: PlanId }) {
  const tier = TOP_TIER[plan.id];
  const models = MODELS.filter(m => m.tier === tier);
  const below = PLAN_ORDER[PLAN_ORDER.indexOf(plan.id) - 1];
  const isCurrent = plan.id === current;
  const featured = plan.id === FEATURED_PLAN;
  const titleId = `hub-plan-${plan.id}`;

  return <article role="listitem" data-plan-card aria-labelledby={titleId}
    className={`hub-plan-card${featured ? " is-featured" : ""}${isCurrent ? " is-current" : ""}`}>
    {featured && <span className="hub-plan-badge">Most popular</span>}

    <p className="hub-plan-tier">{TIER_COPY[tier].name}</p>
    <h2 id={titleId} className="hub-plan-name">{plan.name}</h2>
    <p className="hub-plan-tagline">{plan.tagline}</p>

    {/* Always a figure, never the word: the card is already named "Free", and $0 keeps the ladder legible. */}
    <p className="hub-plan-price">
      <span className="hub-plan-amount">${plan.priceUsdMonthly}</span><span className="hub-plan-period">/month</span>
    </p>

    {isCurrent
      ? <p className="hub-plan-current"><Check size={14} aria-hidden="true" />Your plan</p>
      : <div className="hub-plan-action">
        <button type="button" className="hub-plan-cta" disabled aria-describedby={`${titleId}-soon`}>Choose {plan.name}</button>
        <span id={`${titleId}-soon`} className="hub-plan-soon">Opening soon</span>
      </div>}

    <div className="hub-plan-models">
      <p className="hub-plan-label">{TIER_COPY[tier].name} models</p>
      <ul>{models.map(m => <ModelRow key={m.id} model={m} />)}</ul>
      {below && <p className="hub-plan-inherits">Everything in {PLANS[below].name}</p>}
    </div>

    <dl className="hub-plan-room">
      {room(plan).map(r => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
    </dl>
  </article>;
}

function ModelRow({ model }: { model: Model }) {
  return <li className="hub-plan-model">
    <span className="hub-plan-model-name">{model.name}</span>
    <span className="hub-plan-model-lab">{model.lab}</span>
  </li>;
}
