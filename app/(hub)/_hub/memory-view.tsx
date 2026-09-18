"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildGraph, summarise, type GraphFrame } from "@/lib/socialtrading/memory-graph";
import { alignmentColor, alignmentWord, buildTree, treePlan, ROOT_ID, type TreeNode } from "@/lib/socialtrading/belief-tree";
import type { JevAnswers } from "@/lib/socialtrading/jev-types";
import type { GlossContent } from "./gloss";
import { usd } from "./format";
import { gsap, useGSAP, Draggable, prefersReducedMotion } from "../../_components/motion";
import { useGloss } from "./gloss";
import { useHub } from "./hub-provider";
import { HubLink } from "./navigation";
import "./memory.css";

/** Long enough that moving between chapters asks about the one settled on. */
const SETTLE_MS = 420;
/** How far the tree may be pushed in and pulled out of. */
const MIN_ZOOM = 0.55, MAX_ZOOM = 2.4;
/** The trunk is ink, not a reading on the ramp: it is what the ramp measures against. */
const TRUNK_EDGE = "#5b6b7d";

const VERB: Record<NonNullable<TreeNode["change"]>, string> = {
  appeared: "New here",
  branched: "Grew out of a belief you held",
  strengthened: "Held more strongly",
  faded: "Losing its hold",
  contradicted: "Contradicted by something else",
  released: "Let go",
  steady: "Unchanged",
};

const when = (at: string) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const percent = (value: number) => `${Math.round(value * 100)}%`;
const brief = (text: string, at = 150) => (text.length > at ? `${text.slice(0, at).trimEnd()}…` : text);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * A worldview drawn as the tree it actually is, and handled like a map.
 *
 * The thesis is the trunk, and it is the measure rather than one of the things
 * measured: it carries no score of its own. Everything around it is placed by
 * how closely it lines up with that thesis, and colour and distance say the
 * same thing twice — green and close means the thesis is built on it, sand and
 * far means it barely touches it. Drag to move, scroll to come closer, hover
 * to read.
 */
export function MemoryView() {
  const { state, scoreBeliefs } = useHub();
  const gloss = useGloss();
  const frames = useMemo(() => buildGraph(state), [state]);
  const [index, setIndex] = useState(frames.length - 1);
  const [selected, setSelected] = useState<string | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const at = clamp(index, 0, frames.length - 1);
  const frame: GraphFrame = frames[at];

  const step = useCallback((by: number) => setIndex(current => clamp(current + by, 0, frames.length - 1)), [frames.length]);

  // Readings are cached per chapter and asked for once. Absent means the chapter
  // has not come back yet; `null` means Jev could not be read for it, and until
  // one of the two resolves the chapter draws a bare trunk. Nothing on this tree
  // is ever the page's own arithmetic standing in for the model.
  const [scores, setScores] = useState<Record<string, JevAnswers | null>>({});
  const [attempt, setAttempt] = useState(0);
  const asked = useRef(new Set<string>());
  const plan = useMemo(() => treePlan(frame, state.profile.themes ?? [], state.profile.thesis), [frame, state.profile.themes, state.profile.thesis]);
  /** A chapter with nothing to ask about is answered before it is asked. */
  const unasked = !Object.keys(plan.questions).length;
  const answers = scores[frame.id];
  const reading = !unasked && answers === undefined;
  const unread = !unasked && answers === null;
  const tree = useMemo(() => buildTree(frame, plan, answers ?? null), [frame, plan, answers]);

  useEffect(() => {
    const id = frame.id;
    if (asked.current.has(id) || unasked) return;
    let live = true;
    const timer = setTimeout(async () => {
      asked.current.add(id);
      const answered = await scoreBeliefs(id);
      if (live) setScores(current => ({ ...current, [id]: answered }));
    }, SETTLE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [frame.id, unasked, scoreBeliefs, attempt]);

  /** Ask again for a chapter Jev could not be read for, rather than leaving the
   * trunk bare with no way forward. */
  const reread = useCallback(() => {
    asked.current.delete(frame.id);
    setScores(current => { const next = { ...current }; delete next[frame.id]; return next; });
    setAttempt(n => n + 1);
  }, [frame.id]);

  // The field is handled like a map: drag to move through the tree, scroll to
  // come closer to it. Time is not a gesture here — it belongs to the chapter
  // controls underneath, so a pointer in the field only ever moves the tree.
  const zoom = useRef(1);
  const [adrift, setAdrift] = useState(false);

  useEffect(() => {
    if (!field.current || !canvas.current) return;
    const element = field.current;
    const surface = canvas.current;

    // The tree can be pushed half a field in any direction and no further, so
    // a hard flick can never leave someone looking at an empty page.
    const limits = () => {
      const box = element.getBoundingClientRect();
      const reach = .5 * zoom.current;
      return { minX: -box.width * reach, maxX: box.width * reach, minY: -box.height * reach, maxY: box.height * reach };
    };
    const at = (axis: "x" | "y") => gsap.getProperty(surface, axis) as number;
    const moved = () => setAdrift(Math.abs(at("x")) > 4 || Math.abs(at("y")) > 4 || Math.abs(zoom.current - 1) > .02);
    /** Settle the canvas at the current zoom, back inside its bounds. */
    const settle = () => {
      const bounds = limits();
      gsap.to(surface, {
        x: clamp(at("x"), bounds.minX, bounds.maxX),
        y: clamp(at("y"), bounds.minY, bounds.maxY),
        scale: zoom.current,
        duration: prefersReducedMotion() ? 0 : .3,
        ease: "power3.out",
        overwrite: "auto",
      });
      moved();
    };

    const [drag] = Draggable.create(surface, {
      type: "x,y", trigger: element, inertia: true, dragClickables: true, minimumMovement: 3,
      allowNativeTouchScrolling: false, edgeResistance: .92,
      onPress() { this.applyBounds(limits()); },
      onDrag: moved, onThrowUpdate: moved, onDragEnd: moved, onThrowComplete: moved,
    });

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom.current = clamp(zoom.current * (1 - event.deltaY * .0016), MIN_ZOOM, MAX_ZOOM);
      drag.applyBounds(limits());
      settle();
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { drag.kill(); element.removeEventListener("wheel", wheel); };
  }, []);

  const recentre = useCallback(() => {
    zoom.current = 1;
    if (canvas.current) gsap.to(canvas.current, { x: 0, y: 0, scale: 1, duration: prefersReducedMotion() ? 0 : .45, ease: "power3.out", overwrite: "auto" });
    setAdrift(false);
  }, []);

  // The tree grows outward from the trunk: branches draw, then what hangs off
  // them arrives, and each verb is played rather than stated.
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    const pick = (selector: string) => gsap.utils.toArray<HTMLElement>(selector, canvas.current);
    gsap.fromTo(gsap.utils.toArray<SVGLineElement>("[data-branch]", canvas.current), { attr: { "stroke-opacity": 0 } }, { attr: { "stroke-opacity": 1 }, duration: .7, stagger: .015 });
    gsap.fromTo(pick('[data-tier="pillar"]'), { scale: .7, opacity: 0 }, { scale: 1, opacity: 1, duration: .7, stagger: .05, ease: "creature" });
    gsap.fromTo(pick('[data-tier="idea"]'), { scale: .6, opacity: 0 }, { scale: 1, opacity: 1, duration: .7, delay: .12, stagger: .035, ease: "creature" });
    gsap.fromTo(pick('[data-change="strengthened"]'), { scale: .82 }, { scale: 1, duration: .7, ease: "creature" });
    gsap.fromTo(pick('[data-change="faded"]'), { scale: 1.16 }, { scale: 1, duration: .7, ease: "power2.out" });
    // Contradiction reads as a recoil: the two beliefs flinch away from each other.
    gsap.fromTo(pick('[data-change="contradicted"]'), { x: -9 }, { x: 0, duration: 1, ease: "elastic.out(1, 0.45)" });
    gsap.fromTo(pick(".mem-satellite"), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: .6, stagger: .05, delay: .3, ease: "creature" });
  }, { scope: canvas, dependencies: [frame.id, tree.source], revertOnUpdate: true });

  const nodeAt = (id: string) => tree.nodes.find(n => n.id === id);
  const selectedNode = nodeAt(selected ?? "");
  const root = tree.nodes.find(n => n.tier === "root")!;
  const branches = tree.nodes.filter(n => n.tier !== "root");

  /** The complete sequence: everything recorded, plus any order that never
   * produced an event of its own, so no decision goes missing from the record. */
  const record = useMemo(() => {
    const covered = new Set(state.events.map(e => e.tradeId).filter(Boolean));
    const orders = state.trades.filter(t => !covered.has(t.id)).map(t => ({
      id: `trade:${t.id}`, at: t.createdAt, tradeId: t.id,
      text: `${t.side === "buy" ? "Buy" : "Sell"} ${t.asset.symbol} for ${usd(t.value, 2)}`,
      detail: t.policy.reason, kind: t.asset.kind,
    }));
    return [...state.events.map(e => ({ ...e, kind: String(e.kind) })), ...orders].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [state.events, state.trades]);

  /** What a reveal says. The reading it is showing leads and carries the edge;
   * everything that is not worth interrupting a glance for is left out. The
   * thesis is the exception: it is the measure, so it reports no reading. */
  const reveal = (node: TreeNode): GlossContent => {
    const parent = node.parent ? nodeAt(node.parent) : null;
    if (node.alignment === null) {
      return {
        tone: "dark",
        accent: TRUNK_EDGE,
        title: brief(node.label),
        lines: [
          { label: "Your thesis", value: "Everything else is measured against it", lead: true },
          { label: "Rests on", value: branches.length ? `${branches.length} ${branches.length === 1 ? "idea" : "ideas"}` : reading ? "Reading this chapter…" : "Nothing drawn yet" },
        ],
      };
    }
    return {
      tone: "dark",
      accent: alignmentColor(node.alignment),
      title: brief(node.label),
      lines: [
        { label: alignmentWord(node.alignment), value: percent(node.alignment), lead: true },
        ...(parent && parent.id !== ROOT_ID ? [{ label: "Branches from", value: parent.label }] : []),
        ...(node.change && node.change !== "steady" ? [{ label: "This chapter", value: VERB[node.change] }] : []),
      ],
    };
  };

  /** Said once, where the colours are, rather than in a caption nobody reads. */
  const key: GlossContent = {
    tone: "dark",
    accent: alignmentColor(.85),
    title: "How to read this tree",
    lines: [
      { label: "Colour and distance", value: "How closely an idea lines up with your thesis", lead: true },
      { label: "Green, near the centre", value: "Your thinking is built on it" },
      { label: "Sand, further out", value: "It barely touches your thesis" },
      { label: "The centre", value: "Your thesis itself, so it carries no score" },
    ],
  };

  return (
    <div className="mem">
      <div
        ref={field}
        className="mem-field"
        data-agent-region="memory"
        data-agent-weight="2"
        tabIndex={0}
        role="group"
        aria-label={`Your worldview on ${when(frame.at)}, drawn as a tree of how closely each idea lines up with your thesis. ${summarise(frame)}. Drag to move through it, scroll to come closer, and use the left and right arrow keys to move through time.`}
        onKeyDown={event => {
          if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
        }}
      >
        <div ref={canvas} className="mem-canvas">
          <svg className="mem-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {tree.links.map(link => {
              const from = nodeAt(link.from), to = nodeAt(link.to);
              if (!from || !to) return null;
              const lit = !selected || selected === link.from || selected === link.to;
              return (
                <line
                  key={link.id}
                  {...(link.kind === "branch" ? { "data-branch": true } : {})}
                  data-kind={link.kind}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  style={{
                    stroke: link.kind === "contradiction" ? "#b4707d" : alignmentColor(to.alignment ?? 0),
                    strokeWidth: link.kind === "branch" ? 1 + link.strength * 1.8 : 1,
                    strokeOpacity: (link.kind === "branch" ? .32 + link.strength * .5 : .22) * (lit ? 1 : .25),
                  }}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {frame.satellites.map((satellite, i) => {
              const belief = nodeAt(satellite.belief);
              if (!belief) return null;
              return <line key={`s:${satellite.id}`} data-kind="satellite" x1={belief.x} y1={belief.y} x2={belief.x + 5 + (i % 2) * 2.5} y2={belief.y + 6} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>

          <button
            type="button"
            className="mem-trunk"
            data-tier="root"
            aria-pressed={selected === ROOT_ID}
            onClick={() => setSelected(selected === ROOT_ID ? null : ROOT_ID)}
            style={{ "--conf": TRUNK_EDGE } as CSSProperties}
            aria-label={`Your thesis, the root of this tree: ${root.label}. Everything else is placed by how closely it lines up with it, so the thesis itself carries no score.`}
            {...gloss(reveal(root))}
          >
            <span>{brief(root.label, 130)}</span>
          </button>

          {branches.map(node => (
            <button
              key={node.id}
              type="button"
              className="mem-belief"
              data-tier={node.tier}
              data-change={node.change}
              data-unscored={node.scored ? undefined : true}
              aria-pressed={selected === node.id}
              onClick={() => setSelected(selected === node.id ? null : node.id)}
              style={{
                left: `${node.x}%`, top: `${node.y}%`,
                "--conf": alignmentColor(node.alignment ?? 0),
                "--strength": node.alignment ?? 0,
                "--certainty": node.certainty,
                opacity: !selected || selected === node.id || node.id === selectedNode?.parent || selectedNode?.parent === node.id ? 1 : .35,
              } as CSSProperties}
              aria-label={`${node.label}. ${alignmentWord(node.alignment ?? 0)} with your thesis, ${percent(node.alignment ?? 0)}.${node.change && node.change !== "steady" ? ` ${VERB[node.change]}.` : ""}`}
              {...gloss(reveal(node))}
            >
              <span className="mem-belief-body" aria-hidden="true" />
              <span className="mem-belief-name">{node.label}</span>
            </button>
          ))}

          {frame.satellites.map((satellite, i) => {
            const belief = nodeAt(satellite.belief);
            if (!belief) return null;
            return (
              <button
                key={satellite.id}
                type="button"
                className="mem-satellite"
                data-kind={satellite.kind}
                style={{ left: `${belief.x + 5 + (i % 2) * 2.5}%`, top: `${belief.y + 6}%` } as CSSProperties}
                aria-label={`${satellite.text}, ${when(satellite.at)}`}
                {...gloss({
                  tone: "dark",
                  accent: alignmentColor(belief.alignment ?? 0),
                  title: satellite.text,
                  lines: [{ label: satellite.kind === "trade" ? "You decided" : "What happened", value: when(satellite.at), lead: true }, { label: "Connected to", value: brief(belief.label, 40) }],
                })}
              />
            );
          })}

          {!branches.length && <p className="mem-empty">
            {reading
              ? "Reading this chapter. Every idea here is placed by the model, so nothing is drawn until it answers."
              : unread
                ? <>This chapter could not be read, so nothing is drawn around your thesis. <button type="button" className="mem-reread" onClick={reread}>Read it again</button></>
                : "Your worldview starts the first time something you believe changes. Nothing before that was recorded, so nothing before that is drawn."}
          </p>}
        </div>

        {adrift && <button type="button" className="mem-recentre" onClick={recentre}>Recentre</button>}
      </div>

      {branches.length > 0 && <div className="mem-key">
        <div className="mem-key-scale">
          <span className="mem-key-ramp" aria-hidden="true" />
          <button type="button" className="mem-key-help" aria-label="How to read this tree" {...gloss(key)}>?</button>
        </div>
        <span className="mem-key-ends"><b>Barely aligned</b><b>Foundational</b></span>
        <p>Every idea is placed by how closely it lines up with your thesis.</p>
      </div>}

      {selectedNode && <section className="mem-insight" aria-label="Selected belief">
        <div>
          <p className="mem-eyebrow">{selectedNode.tier === "root" ? "Your thesis" : selectedNode.tier === "pillar" ? "A pillar of your thesis" : selectedNode.change && selectedNode.change !== "steady" ? VERB[selectedNode.change] : "What it rests on"}</p>
          <h2>{selectedNode.label}</h2>
          <p>{selectedNode.origin}</p>
        </div>
        {selectedNode.alignment !== null && <div><strong style={{ color: alignmentColor(selectedNode.alignment) }}>{percent(selectedNode.alignment)}</strong><span>{alignmentWord(selectedNode.alignment)}</span></div>}
        <button type="button" className="hub-chip-button" onClick={() => setSelected(null)}>Close</button>
      </section>}
      <div className="mem-navigation">
        <button type="button" className="hub-chip-button" disabled={at === 0} onClick={() => step(-1)}>← Earlier</button>
        <div><span>Chapter {at + 1} of {frames.length}</span><strong>{frame.title}</strong></div>
        <button type="button" className="hub-chip-button" disabled={at === frames.length - 1} onClick={() => step(1)}>Later →</button>
      </div>
      <div className="mem-ticks" role="group" aria-label="States of mind, oldest first">
        {frames.map((f, i) => (
          <button
            key={f.id}
            type="button"
            className="mem-tick"
            aria-current={i === at ? "true" : undefined}
            aria-label={`${when(f.at)}. ${summarise(f)}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
      <p className="mem-now">{when(frame.at)}<span>{summarise(frame)}</span></p>

      <details className="mem-record">
        <summary>Everything, in order</summary>
        <ol>
          {record.map(entry => (
            <li key={entry.id} data-kind={entry.kind}>
              <time dateTime={entry.at}>{when(entry.at)}</time>
              <span>{entry.text}</span>
              {entry.detail && <small>{entry.detail}</small>}
              {entry.tradeId && <HubLink href="/">Review the decision</HubLink>}
            </li>
          ))}
          {!record.length && <li><span>Nothing recorded yet.</span></li>}
        </ol>
      </details>
    </div>
  );
}
