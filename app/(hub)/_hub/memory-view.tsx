"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildGraph, summarise, type GraphFrame, type GraphNode } from "@/lib/socialtrading/memory-graph";
import { usd } from "./format";
import { gsap, useGSAP, Draggable, Observer, prefersReducedMotion } from "../../_components/motion";
import { useGloss } from "./gloss";
import { useHub } from "./hub-provider";
import { HubLink } from "./navigation";
import "./memory.css";

/** How far the pointer travels to cross one state of mind. */
const STRIDE = 130;

const VERB: Record<GraphNode["change"], string> = {
  appeared: "New here",
  branched: "Grew out of a belief you already held",
  strengthened: "Held more strongly",
  faded: "Losing its hold",
  contradicted: "Contradicted by something else you now believe",
  released: "Let go",
  steady: "Unchanged",
};

const when = (at: string) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * A mind over time, not a list of what happened. Beliefs are bodies, shared
 * themes connect them, and what was decided hangs off whatever was believed at
 * the time. Dragging the field runs time: bodies swell, thin, split, recoil and
 * go dark, each movement a real difference between two recorded frames.
 */
export function MemoryView() {
  const { state } = useHub();
  const gloss = useGloss();
  const frames = useMemo(() => buildGraph(state), [state]);
  const [index, setIndex] = useState(frames.length - 1);
  const field = useRef<HTMLDivElement>(null);
  const travel = useRef(0);
  const at = Math.min(Math.max(index, 0), frames.length - 1);
  const frame: GraphFrame = frames[at];
  const single = frames.length < 2;

  const step = useCallback((by: number) => setIndex(current => Math.min(Math.max(current + by, 0), frames.length - 1)), [frames.length]);

  // Time is the canvas. Drag, wheel or trackpad all run it, with momentum, and
  // it settles on a frame rather than between two.
  useEffect(() => {
    if (single || prefersReducedMotion() || !field.current) return;
    const proxy = document.createElement("div");
    const settle = () => {
      const moved = Math.round(travel.current / STRIDE);
      if (moved) { step(-moved); travel.current = 0; }
    };
    const [drag] = Draggable.create(proxy, {
      type: "x", trigger: field.current, inertia: true, allowNativeTouchScrolling: false,
      onDrag() { travel.current = this.x; }, onThrowUpdate() { travel.current = this.x; },
      onDragEnd: settle, onThrowComplete: settle,
    });
    const observer = Observer.create({
      target: field.current, type: "wheel,touch", wheelSpeed: -1, tolerance: 12,
      onChangeX: self => { travel.current += self.deltaX; settle(); },
    });
    return () => { drag.kill(); observer.kill(); proxy.remove(); };
  }, [single, step]);

  // Each verb is played rather than stated.
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    const pick = (change: string) => gsap.utils.toArray<HTMLElement>(`[data-change="${change}"]`, field.current);
    gsap.fromTo(pick("appeared").concat(pick("branched")), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: .8, stagger: .06, ease: "creature" });
    gsap.fromTo(pick("strengthened"), { scale: .82 }, { scale: 1, duration: .7, ease: "creature" });
    gsap.fromTo(pick("faded"), { scale: 1.16 }, { scale: 1, duration: .7, ease: "power2.out" });
    gsap.fromTo(pick("released"), { opacity: .9 }, { opacity: 1, duration: .9, ease: "power2.out" });
    // Contradiction reads as a recoil: the two beliefs flinch away from each other.
    gsap.fromTo(pick("contradicted"), { x: -9 }, { x: 0, duration: 1, ease: "elastic.out(1, 0.45)" });
    gsap.fromTo(gsap.utils.toArray<SVGLineElement>("[data-edge]", field.current), { attr: { "stroke-opacity": 0 } }, { attr: { "stroke-opacity": 1 }, duration: .9, stagger: .02 });
    gsap.fromTo(gsap.utils.toArray<HTMLElement>(".mem-satellite", field.current), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: .6, stagger: .05, delay: .25, ease: "creature" });
  }, { scope: field, dependencies: [frame.id], revertOnUpdate: true });

  const nodeAt = (id: string) => frame.nodes.find(n => n.id === id);

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

  return (
    <div className="mem">
      <div
        ref={field}
        className="mem-field"
        data-agent-region="memory"
        data-agent-weight="2"
        tabIndex={0}
        role="group"
        aria-label={`Your worldview on ${when(frame.at)}. ${summarise(frame)}. Use the left and right arrow keys to move through time.`}
        onKeyDown={event => {
          if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
        }}
      >
        <svg className="mem-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {frame.edges.map(edge => {
            const from = nodeAt(edge.from), to = nodeAt(edge.to);
            if (!from || !to) return null;
            return <line key={edge.id} data-edge data-kind={edge.kind} x1={from.x} y1={from.y} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke" />;
          })}
          {frame.satellites.map((satellite, i) => {
            const belief = nodeAt(satellite.belief);
            if (!belief) return null;
            return <line key={`s:${satellite.id}`} data-edge data-kind="satellite" x1={belief.x} y1={belief.y} x2={belief.x + 7 + (i % 2) * 3} y2={belief.y + 7} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>

        {frame.nodes.map(node => (
          <button
            key={node.id}
            type="button"
            className="mem-belief"
            data-change={node.change}
            style={{ left: `${node.x}%`, top: `${node.y}%`, "--strength": node.strength } as CSSProperties}
            aria-label={`${node.text}. ${VERB[node.change]}. ${Math.round(node.strength * 100)} per cent conviction.`}
            {...gloss({
              title: node.text,
              lines: [
                { label: "What happened", value: VERB[node.change] },
                { label: "Conviction", value: `${Math.round(node.strength * 100)}%` },
                { label: "Where it came from", value: node.origin },
                ...(node.parent ? [{ label: "Grew out of", value: nodeAt(node.parent)?.text ?? "an earlier belief" }] : []),
              ],
            })}
          >
            <span className="mem-belief-body" aria-hidden="true" />
            <span className="mem-belief-name">{node.text}</span>
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
              style={{ left: `${belief.x + 7 + (i % 2) * 3}%`, top: `${belief.y + 7}%` } as CSSProperties}
              aria-label={`${satellite.text}, ${when(satellite.at)}`}
              {...gloss({ title: when(satellite.at), lines: [{ label: satellite.kind === "trade" ? "You decided" : "What happened", value: satellite.text }, { label: "Connected to", value: nodeAt(satellite.belief)?.text ?? "" }] })}
            />
          );
        })}

        {!frame.nodes.length && <p className="mem-empty">Your worldview starts the first time something you believe changes. Nothing before that was recorded, so nothing before that is drawn.</p>}
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
