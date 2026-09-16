"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { Plus, Sparkles } from "lucide-react";
import type { AgentConfig } from "@/lib/socialtrading/agents/config";
import { AURA, AURA_UNFORMED, identityLine, type IdentityStage, type IdentityStats, type Milestone } from "@/lib/socialtrading/identity";
import type { ThemeId } from "@/lib/socialtrading/themes";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { ProfileAvatar } from "../profile-avatar";
import { HubLink as Link } from "./navigation";
import { IdentityAura } from "./identity-aura";

/** The pastel a set of themes casts on a surface. First theme leads; a second one tints the far corner. */
export function auraTint(themes: readonly ThemeId[] = []): CSSProperties {
  const tones = themes.filter(id => id in AURA).map(id => AURA[id]);
  const first = tones[0] ?? AURA_UNFORMED[0], second = tones[1] ?? tones[0] ?? AURA_UNFORMED[1];
  return { "--aura-glow": first.glow, "--aura-deep": first.deep, "--aura-glow-2": second.glow } as CSSProperties;
}

/** A number that counts itself up the first time it is seen. */
function Tally({ value, label, tip }: { value: number; label: string; tip: string }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  useGSAP(() => {
    const from = shown.current, first = from === null;
    shown.current = value;
    if (!first && from === value) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const counter = { at: first ? 0 : from };
      gsap.to(counter, {
        at: value, duration: first ? 1.2 : .6, delay: first ? .35 : 0, ease: "power2.out",
        onUpdate: () => { if (node.current) node.current.textContent = String(Math.round(counter.at)); },
      });
    });
    return () => media.revert();
  }, { dependencies: [value] });
  return <div className="hub-tally" data-tooltip={tip}>
    <span ref={node} className="hub-tally-figure">{value}</span>
    <span className="hub-tally-label">{label}</span>
  </div>;
}

/**
 * The top of the page: who this is, drawn before it is spelled out. The aura
 * comes first and the words explain it, rather than a heading with a picture
 * beside it.
 */
export function IdentityHero({ name, seed, themes, inferred, thesis, line, signature, stage, stats, children }: {
  name: string; seed: string; themes: readonly ThemeId[]; inferred: import("@/lib/socialtrading/types").HubState["inferred"];
  thesis: string; line: string; signature: string; stage: IdentityStage; stats: IdentityStats; children?: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-identity-part]", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .7, stagger: .07, delay: .25, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root });

  return <header ref={root} className="hub-identity" style={auraTint(themes)}>
    <span className="hub-identity-wash" aria-hidden="true" />
    <div className="hub-identity-orb">
      <IdentityAura seed={seed} themes={themes} inferred={inferred} progress={stage.progress} depth={stage.depth} energy={stats.energy}
        label={`Your aura: ${line}, ${stage.name}, ${Math.round(stage.progress * 100)}% toward ${stage.next ?? "the last stage"}`} />
      <span className="hub-identity-stage" data-identity-part>{stage.name}</span>
    </div>
    <h1 className="hub-identity-name" data-identity-part>{name}</h1>
    <p className="hub-identity-signature mono" data-identity-part>{signature}</p>
    <p className="hub-identity-line" data-identity-part>{line}</p>
    {thesis.trim() && <p className="hub-identity-thesis" data-identity-part>{thesis.trim()}</p>}
    <div className="hub-identity-tallies" data-identity-part>
      <Tally value={stats.signals} label={stats.signals === 1 ? "signal" : "signals"} tip="Everything your agents have folded into what they know about you." />
      <Tally value={stats.watching} label="watching" tip="Assets and ideas you chose to follow." />
      <Tally value={stats.discoveries} label={stats.discoveries === 1 ? "discovery" : "discoveries"} tip="Things your agents noticed on their own, without being told." />
      <Tally value={stats.agents} label={stats.agents === 1 ? "agent" : "agents"} tip="Agents carrying your thesis. Two can look around at once." />
    </div>
    {children}
  </header>;
}

/** Where the identity stands and the one thing that would move it on. */
export function IdentityProgress({ stage, step, earned, themes = [] }: { stage: IdentityStage; step: string; earned: Milestone[]; themes?: readonly ThemeId[] }) {
  const root = useRef<HTMLElement>(null);
  const count = earned.filter(m => m.earned).length;
  // Each medallion takes the next of the person's own theme colours, so the row
  // reads as their palette rather than eight identical beads.
  const tones = (held: readonly ThemeId[], index: number): ThemeId[] => held.length ? [held[index % held.length]] : [];
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-milestone]", { opacity: 0, scale: .8, y: 6 }, { opacity: 1, scale: 1, y: 0, duration: .5, stagger: .04, delay: .6, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [count] });

  return <section ref={root} className="hub-progress" aria-labelledby="hub-progress-title">
    <div className="hub-progress-copy">
      <h2 id="hub-progress-title">{stage.line}</h2>
      <p>{stage.next ? <>Next, <strong>{stage.next}</strong>. {step}</> : step}</p>
    </div>
    <ul className="hub-milestones" aria-label={`Milestones, ${count} of ${earned.length} reached`}>
      {earned.map((milestone, index) => <li key={milestone.id}>
        <span className={`hub-milestone${milestone.earned ? " is-earned" : ""}`} data-milestone style={auraTint(tones(themes, index))}
          data-tooltip={milestone.earned ? `${milestone.name} — reached` : milestone.note}
          tabIndex={0} role="img" aria-label={`${milestone.name}: ${milestone.earned ? "reached" : milestone.note}`}>
          <i aria-hidden="true" />
          <small>{milestone.name}</small>
        </span>
      </li>)}
    </ul>
  </section>;
}

/** The roster. Agents read as companions with their own colour and their own weather, not as rows of configuration. */
export function AgentRoster({ agents, activeId, themesOf, room, capNote }: {
  agents: AgentConfig[]; activeId?: string; themesOf: (agent: AgentConfig) => ThemeId[];
  /** How many more agents the plan allows. */
  room: number; capNote: string;
}) {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-companion]", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: .6, stagger: .06, delay: .5, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [agents.length] });

  return <section ref={root} className="hub-roster" aria-labelledby="hub-roster-title">
    <div className="hub-roster-head">
      <h2 id="hub-roster-title">{agents.length === 1 ? "Your agent" : `Your ${agents.length} agents`}</h2>
      <Link className="hub-inline-link" href="/agents">Open your team</Link>
    </div>
    <ul className="hub-companions">
      {agents.map(agent => {
        const themes = themesOf(agent);
        const named = themes.length ? identityLine(themes) : "";
        return <li key={agent.id} data-companion>
          <Link href="/agents" className={`hub-companion${agent.enabled ? " is-awake" : ""}${agent.id === activeId ? " is-current" : ""}`} style={auraTint(themes)}>
            <span className="hub-companion-glow" aria-hidden="true" />
            <ProfileAvatar badge={agent.badge} seed={agent.id} themes={themes} className="hub-companion-badge" />
            <strong>{agent.name}</strong>
            <small>{named || agent.description || "Finding its shape"}</small>
            <span className="hub-companion-state"><i aria-hidden="true" />{agent.enabled ? "Looking around" : "Resting"}</span>
          </Link>
        </li>;
      })}
      <li data-companion>
        <Link href="/agents" className="hub-companion is-new" data-tooltip={room > 0 ? undefined : capNote}>
          <span className="hub-companion-mark" aria-hidden="true">{room > 0 ? <Plus size={20} strokeWidth={1.6} /> : <Sparkles size={18} strokeWidth={1.6} />}</span>
          <strong>Begin another</strong>
          <small>{room > 0 ? `Room for ${room} more` : "Your team is full"}</small>
        </Link>
      </li>
    </ul>
  </section>;
}
