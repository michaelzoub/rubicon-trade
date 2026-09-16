"use client";

import { Bot, Check, Coins, Eye } from "lucide-react";
import { useRef } from "react";
import { MODELS, TIER_COPY, type Model, type ModelTier } from "@/lib/socialtrading/models";
import { FEATURED_PLAN, PLANS, PLAN_ORDER, formatCredits, formatLimit, type Plan, type PlanId } from "@/lib/socialtrading/plans";
import { gsap, rubiconMotion, useGSAP } from "../../_components/motion";
import { useHub } from "./hub-provider";
import { HubLink as Link } from "./navigation";

/** The tier a plan's card leads with. */
const TOP_TIER: Record<PlanId, ModelTier> = { free: "fast", plus: "capable", pro: "frontier" };

/** The three figures a card leads with, read from the plan's own limits so copy cannot drift. */
function stats(plan: Plan) {
  const monthly = plan.credits.monthlyMicros;
  return [
    { icon: Coins, value: formatCredits(monthly || plan.credits.startingMicros), label: monthly ? "of credits a month" : "of credits to start" },
    { icon: Eye, value: formatLimit(plan.limits.follows), label: "assets followed" },
    { icon: Bot, value: formatLimit(plan.limits.agents), label: `agents, ${formatLimit(plan.limits.enabledAgents)} running` },
  ];
}

/** `Free +`, `Free & Plus +` — what this tier adds on top of, in the plans' own names. */
function inheritsLabel(id: PlanId): string | null {
  const below = PLAN_ORDER.slice(0, PLAN_ORDER.indexOf(id)).map(p => PLANS[p].name);
  if (!below.length) return null;
  return `${below.length === 1 ? below[0] : `${below.slice(0, -1).join(", ")} & ${below.at(-1)}`} +`;
}

/**
 * The plans page. Surfaces stay white and the light does the talking: each card carries a tone in its
 * orb and a wash across its head, and the middle one is larger and lit hardest. The model list is the
 * argument the page makes, so it sits where the eye lands last and nothing decorates it.
 */
export function PlansView() {
  const { account } = useHub();
  const current: PlanId = account?.planId ?? "free";
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-plan-card]", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: .75, stagger: .1, delay: .12, ease: rubiconMotion.ease.enter, clearProps: "all" });
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
  const inherits = inheritsLabel(plan.id);
  const isCurrent = plan.id === current;
  const featured = plan.id === FEATURED_PLAN;
  const titleId = `hub-plan-${plan.id}`;

  // The plan id is a class so each card's tone lives in CSS beside every other visual token.
  return <article role="listitem" data-plan-card aria-labelledby={titleId}
    className={`hub-plan-card is-${plan.id}${featured ? " is-featured" : ""}${isCurrent ? " is-current" : ""}`}>
    <span className="hub-plan-wash" aria-hidden="true" />
    <PlanCrest />

    <div className="hub-plan-head">
      <span className="hub-plan-orb" aria-hidden="true" />
      {featured && <span className="hub-plan-badge">Most popular</span>}
    </div>

    <p className="hub-plan-tier">{TIER_COPY[tier].name}</p>
    <h2 id={titleId} className="hub-plan-name">{plan.name}</h2>
    <p className="hub-plan-tagline">{plan.tagline}</p>

    <p className="hub-plan-price">
      <span className="hub-plan-amount">${plan.priceUsdMonthly}</span><span className="hub-plan-period">/month</span>
    </p>

    {isCurrent
      ? <p className="hub-plan-current"><Check size={15} aria-hidden="true" />Your plan</p>
      : <div className="hub-plan-action">
        <button type="button" className="hub-plan-cta" disabled aria-describedby={`${titleId}-soon`}>Choose this plan</button>
        <span id={`${titleId}-soon`} className="hub-plan-soon">Opening soon</span>
      </div>}

    <ul className="hub-plan-stats">
      {stats(plan).map(({ icon: Icon, value, label }) => <li key={label}>
        <Icon size={15} aria-hidden="true" />
        <span><strong>{value}</strong> {label}</span>
      </li>)}
    </ul>

    <p className="hub-plan-rule"><span>{inherits ?? `${TIER_COPY[tier].name} models`}</span></p>

    <ul className="hub-plan-models">
      {models.map(m => <ModelRow key={m.id} model={m} />)}
    </ul>
  </article>;
}

function ModelRow({ model }: { model: Model }) {
  return <li className="hub-plan-model">
    <Check size={14} aria-hidden="true" />
    <span className="hub-plan-model-name">{model.name}</span>
    <span className="hub-plan-model-lab">{model.lab}</span>
  </li>;
}

/** The crossing: strokes leaving the card's top corner, echoing the brand mark without repeating the
 * logo on all three cards. Tone comes from the card, opacity from CSS. */
function PlanCrest() {
  return <svg className="hub-plan-crest" viewBox="0 0 220 150" fill="none" aria-hidden="true" preserveAspectRatio="xMaxYMin slice">
    <path d="M18 132C60 132 66 74 108 74s48-58 90-58" stroke="currentColor" strokeWidth="26" strokeLinecap="round" opacity=".55" />
    <path d="M52 158C94 158 100 100 142 100s48-58 90-58" stroke="currentColor" strokeWidth="26" strokeLinecap="round" opacity=".34" />
    <path d="M96 184c42 0 48-58 90-58s48-58 90-58" stroke="currentColor" strokeWidth="26" strokeLinecap="round" opacity=".18" />
  </svg>;
}
