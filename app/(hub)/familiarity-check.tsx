"use client";

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  FAMILIARITY_CONCEPTS, FAMILIARITY_TITLE, scoreFamiliarity, shuffleFamiliarityConcepts,
  type FamiliarityResult,
} from "@/lib/socialtrading/familiarity";

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
  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
    onChange?.([...next]);
  }
  return <div className="onb-familiarity">
    {showTitle && <h2 className="onb-familiarity-title">{FAMILIARITY_TITLE}</h2>}
    <div className="onb-familiarity-frame">
      <div className="onb-familiarity-grid" role="group" aria-label="Investing concepts you are familiar with">
        {concepts.map(concept => {
          const on = selected.has(concept.id);
          return <button type="button" key={concept.id} className="onb-familiarity-chip" aria-pressed={on} onClick={() => toggle(concept.id)}>
            {concept.label}
          </button>;
        })}
      </div>
    </div>
    {!hideContinue && <div className="onb-familiarity-actions">
      <button type="button" className="button button-primary" disabled={busy} onClick={() => onComplete(scoreFamiliarity([...selected]))}>
        Continue<ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>}
  </div>;
}
