"use client";

import { useEffect, useState } from "react";
import { VARIANTS, type Variant } from "@/lib/socialtrading/experiment";
import { loadRuns, summarize, RUNS_KEY, type Run } from "@/lib/socialtrading/onboarding-metrics";
import "../../(hub)/onboarding.css";

const LABEL: Record<Variant, string> = { tree: "Tree", inference: "Inference" };
const seconds = (ms: number) => ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Both arms side by side. The numbers say which one people finish; the theses
 * underneath are what actually decides which onboarding is better, so they are
 * shown in full rather than summarised. */
export function CompareRuns() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => { setRuns(loadRuns()); }, []);
  if (!runs) return <div className="landing-page socialtrading-page"><main className="container dashboard-theme" style={{ padding: "3rem 0" }}><p>Loading runs…</p></main></div>;

  return <div className="landing-page socialtrading-page"><main className="container dashboard-theme onb" style={{ padding: "2.5rem 0 4rem", display: "grid", gap: "2rem" }}>
    <header style={{ display: "grid", gap: ".6rem" }}>
      <h1 className="onb-card-title" style={{ maxWidth: "none" }}>Onboarding A/B</h1>
      <p className="onb-card-lead">{runs.length} run{runs.length === 1 ? "" : "s"} recorded in this browser. Runs you forced with <code>?onboarding=</code> and inference runs that fell back to the tree are listed but excluded from the rates.</p>
      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
        <a className="onb-button is-back" href="/preview?view=onboarding&onboarding=tree">Run the tree arm</a>
        <a className="onb-button is-back" href="/preview?view=onboarding&onboarding=inference">Run the inference arm</a>
        <button type="button" className="onb-button is-back" onClick={() => { if (confirm("Delete every recorded onboarding run in this browser?")) { localStorage.removeItem(RUNS_KEY); setRuns([]); } }}>Clear runs</button>
      </div>
    </header>

    <section style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))" }}>
      {VARIANTS.map(variant => {
        const s = summarize(runs, variant);
        const drops = Object.entries(s.dropOff).sort((a, b) => b[1] - a[1]);
        return <article key={variant} className="onb-card" style={{ gap: ".9rem" }}>
          <h2 className="onb-card-title" style={{ fontSize: "1.1rem" }}>{LABEL[variant]}</h2>
          <dl style={{ display: "grid", gap: ".45rem", fontSize: ".8rem" }}>
            {[["Counted runs", `${s.runs}`], ["Completed", `${s.completed}`], ["Completion rate", s.runs ? percent(s.completionRate) : "—"], ["Median time", s.completed ? seconds(s.medianMs) : "—"], ["Median cards", s.completed ? `${s.medianCards}` : "—"]].map(([label, value]) =>
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}><dt style={{ color: "var(--muted)" }}>{label}</dt><dd style={{ fontVariantNumeric: "tabular-nums" }}>{value}</dd></div>)}
          </dl>
          {drops.length > 0 && <p className="onb-hint">Most abandoned at: {drops.slice(0, 3).map(([id, n]) => `${id} (${n})`).join(", ")}</p>}
        </article>;
      })}
    </section>

    <section style={{ display: "grid", gap: ".75rem" }}>
      <h2 className="onb-card-title" style={{ fontSize: "1.1rem" }}>Every run</h2>
      {!runs.length && <p className="onb-hint">Nothing recorded yet. Run either arm above, then come back.</p>}
      {runs.map(run => <article key={run.id} className="onb-card" style={{ gap: ".7rem", padding: "1.1rem 1.25rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: ".5rem", fontSize: ".72rem", color: "var(--muted)" }}>
          <strong style={{ color: "var(--ink)" }}>{LABEL[run.variant]}</strong>
          <span>{new Date(run.startedAt).toLocaleString()}</span>
          <span>{run.cards.length} card{run.cards.length === 1 ? "" : "s"}</span>
          <span>{seconds(run.cards.reduce((sum, c) => sum + c.ms, 0))}</span>
          {run.backs > 0 && <span>{run.backs} back</span>}
          <span className="onb-direction" style={{ color: run.completed ? undefined : "#7a6a62" }}>{run.completed ? "Completed" : `Left at ${run.abandonedAt ?? "start"}`}</span>
          {run.forced && <span className="mono">forced</span>}
          {run.source === "fallback" && <span className="mono">fallback</span>}
        </div>
        {run.thesis && <p style={{ fontSize: ".85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{run.thesis}</p>}
        {run.themes.length > 0 && <div className="onb-chip-grid">{run.themes.map(t => <span key={t} style={{ fontSize: ".7rem", color: "var(--muted)" }}>{t}</span>)}</div>}
      </article>)}
    </section>
  </main></div>;
}
