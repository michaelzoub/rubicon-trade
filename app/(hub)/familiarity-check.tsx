"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import {
  FAMILIARITY_CONCEPTS, FAMILIARITY_TITLE, scoreFamiliarity, shuffleFamiliarityConcepts,
  type FamiliarityConceptId, type FamiliarityResult,
} from "@/lib/socialtrading/familiarity";

const TILTS = [-3.4, 2.6, -1.6, 3.2, -2.8, 1.9, -3.1, 2.4, -1.2, 3.5, -2.1, 1.5];

const FACES: Record<FamiliarityConceptId, { pip: string; tint: string }> = {
  1: { pip: "ST", tint: "#dbe8ff" },
  2: { pip: "%", tint: "#e4f4ea" },
  3: { pip: "DV", tint: "#f0e7ff" },
  4: { pip: "ETF", tint: "#dceff8" },
  5: { pip: "CI", tint: "#ffe8d6" },
  6: { pip: "DIV", tint: "#fde6ee" },
  7: { pip: "IX", tint: "#e7eefc" },
  8: { pip: "RT", tint: "#f7ead6" },
  9: { pip: "AA", tint: "#e3f1de" },
  10: { pip: "ER", tint: "#ece7e1" },
  11: { pip: "P/E", tint: "#e8e4ff" },
  12: { pip: "OP", tint: "#d9f0f4" },
};

export type FamiliarityCheckProps = {
  onComplete: (result: FamiliarityResult) => void;
  initialSelectedIds?: number[];
  /** The host card already prints the question, so the heading stays off. */
  showTitle?: boolean;
  /** The host card already has Continue, so this one stays off. */
  hideContinue?: boolean;
  onChange?: (selectedConceptIds: number[]) => void;
  busy?: boolean;
};

/** Multi-select of investing terms. Continue always works — including with
 * nothing chosen — and the host is responsible for moving to the next scene. */
export function FamiliarityCheck({ onComplete, initialSelectedIds = [], showTitle = true, hideContinue = false, onChange, busy = false }: FamiliarityCheckProps) {
  const concepts = useMemo(() => shuffleFamiliarityConcepts(FAMILIARITY_CONCEPTS), []);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialSelectedIds));
  const [slap, setSlap] = useState<{ id: number; dir: "on" | "off"; n: number } | null>(null);
  function toggle(id: number) {
    const next = new Set(selected);
    const dir = next.has(id) ? "off" : "on";
    if (dir === "on") next.add(id); else next.delete(id);
    setSelected(next);
    setSlap({ id, dir, n: Date.now() });
    onChange?.([...next]);
  }
  return <div className="onb-familiarity">
    {showTitle && <h2 className="onb-familiarity-title">{FAMILIARITY_TITLE}</h2>}
    <div className="onb-familiarity-grid" role="group" aria-label="Investing concepts you are familiar with">
      {concepts.map((concept, i) => {
        const on = selected.has(concept.id);
        const face = FACES[concept.id];
        const slapping = slap?.id === concept.id;
        return <button
          type="button"
          key={concept.id}
          className={`onb-familiarity-chip${on ? " is-on" : ""}${slapping ? ` is-slap-${slap.dir}` : ""}`}
          style={{ "--i": i, "--tilt": `${TILTS[i % TILTS.length]}deg`, "--tint": face.tint } as CSSProperties}
          aria-label={concept.label}
          aria-pressed={on}
          onClick={() => toggle(concept.id)}
        >
          <span className="onb-familiarity-inner" onAnimationEnd={() => { if (slap?.id === concept.id) setSlap(null); }}>
            <span className="onb-familiarity-face is-front">
              <span className="onb-familiarity-pip is-tl" aria-hidden="true">{face.pip}</span>
              <span className="onb-familiarity-pip is-br" aria-hidden="true" />
              <ConceptArt id={concept.id} />
              <span className="onb-familiarity-name">{concept.label}</span>
            </span>
            <span className="onb-familiarity-face is-back" aria-hidden="true">
              <span className="onb-familiarity-pip is-tl">{face.pip}</span>
              <span className="onb-familiarity-pip is-br" />
              <ConceptArt id={concept.id} />
              <span className="onb-familiarity-name">{concept.label}</span>
              <span className="onb-familiarity-stamp" />
            </span>
          </span>
        </button>;
      })}
    </div>
    {!hideContinue && <div className="onb-familiarity-actions">
      <button type="button" className="button button-primary" disabled={busy} onClick={() => onComplete(scoreFamiliarity([...selected]))}>
        Continue<ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>}
  </div>;
}

function ConceptArt({ id }: { id: FamiliarityConceptId }) {
  return <svg className="onb-familiarity-art" viewBox="0 0 72 40" aria-hidden="true">
    {id === 1 && <>
      <path d="M6 32 V18 H12 V32 Z M18 32 V10 H24 V32 Z M30 32 V21 H36 V32 Z M42 32 V7 H48 V32 Z M54 32 V14 H60 V32 Z" fill="currentColor" opacity=".22" />
      <path d="M8 28 L20 16 L32 22 L46 8 L64 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="64" cy="14" r="2.4" fill="currentColor" />
    </>}
    {id === 2 && <>
      <circle cx="28" cy="20" r="11" fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".35" />
      <circle cx="28" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".18" />
      <text x="22" y="25" fontSize="16" fontWeight="600" fill="currentColor">%</text>
      <path d="M46 30 C54 30 60 24 62 16" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M58 16 H62 V20" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </>}
    {id === 3 && <>
      <circle cx="18" cy="14" r="5.5" fill="currentColor" opacity=".85" />
      <circle cx="36" cy="10" r="4" fill="currentColor" opacity=".45" />
      <circle cx="54" cy="16" r="6" fill="currentColor" opacity=".7" />
      <circle cx="24" cy="28" r="4.5" fill="currentColor" opacity=".35" />
      <circle cx="44" cy="30" r="5" fill="currentColor" opacity=".55" />
      <circle cx="60" cy="28" r="3.2" fill="currentColor" opacity=".3" />
    </>}
    {id === 4 && <>
      <rect x="14" y="10" width="44" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <rect x="20" y="16" width="8" height="8" rx="1.5" fill="currentColor" opacity=".85" />
      <rect x="32" y="16" width="8" height="8" rx="1.5" fill="currentColor" opacity=".45" />
      <rect x="44" y="16" width="8" height="8" rx="1.5" fill="currentColor" opacity=".65" />
      <rect x="26" y="26" width="20" height="3" rx="1.5" fill="currentColor" opacity=".25" />
    </>}
    {id === 5 && <>
      <circle cx="20" cy="26" r="6" fill="currentColor" opacity=".28" />
      <circle cx="36" cy="22" r="8" fill="currentColor" opacity=".5" />
      <circle cx="54" cy="16" r="11" fill="currentColor" opacity=".82" />
      <path d="M20 26 L36 22 L54 16" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".5" />
    </>}
    {id === 6 && <>
      <path d="M36 6 C36 6 20 16 20 24 C20 32 28 36 36 36 C44 36 52 32 52 24 C52 16 36 6 36 6 Z" fill="currentColor" opacity=".18" />
      <circle cx="36" cy="22" r="7" fill="currentColor" />
      <path d="M36 16 V28 M31 22 H41" stroke="#fff" strokeWidth="1.6" />
    </>}
    {id === 7 && <>
      <path d="M8 30 H64" stroke="currentColor" strokeWidth="1.4" opacity=".35" />
      <rect x="12" y="16" width="8" height="14" rx="1.5" fill="currentColor" opacity=".75" />
      <rect x="24" y="16" width="8" height="14" rx="1.5" fill="currentColor" opacity=".75" />
      <rect x="36" y="16" width="8" height="14" rx="1.5" fill="currentColor" opacity=".75" />
      <rect x="48" y="16" width="8" height="14" rx="1.5" fill="currentColor" opacity=".75" />
      <path d="M10 14 H62" stroke="currentColor" strokeWidth="1.8" />
    </>}
    {id === 8 && <>
      <circle cx="36" cy="24" r="13" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M36 24 L48 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="36" cy="24" r="2.4" fill="currentColor" />
      <path d="M23 24 H26 M46 24 H49 M36 11 V14" stroke="currentColor" strokeWidth="1.5" />
    </>}
    {id === 9 && <>
      <path d="M36 20 L36 6 A14 14 0 0 1 49 28 Z" fill="currentColor" opacity=".9" />
      <path d="M36 20 L49 28 A14 14 0 0 1 23 28 Z" fill="currentColor" opacity=".45" />
      <path d="M36 20 L23 28 A14 14 0 0 1 36 6 Z" fill="currentColor" opacity=".2" />
    </>}
    {id === 10 && <>
      <rect x="10" y="16" width="52" height="12" rx="3" fill="currentColor" opacity=".18" />
      <rect x="10" y="16" width="40" height="12" rx="3" fill="currentColor" opacity=".55" />
      <rect x="50" y="16" width="12" height="12" rx="3" fill="currentColor" />
      <path d="M50 14 V30" stroke="currentColor" strokeWidth="1.4" />
    </>}
    {id === 11 && <>
      <text x="14" y="24" fontSize="18" fontWeight="600" fill="currentColor">P</text>
      <path d="M28 20 H44" stroke="currentColor" strokeWidth="2" />
      <text x="46" y="32" fontSize="18" fontWeight="600" fill="currentColor">E</text>
    </>}
    {id === 12 && <>
      <rect x="16" y="8" width="28" height="24" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M22 14 H38 M22 19 H34 M22 24 H30" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
      <path d="M44 14 C56 14 60 22 48 28 C62 26 64 34 52 34" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </>}
  </svg>;
}
