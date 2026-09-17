"use client";

import { useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldAtlas from "world-atlas/countries-110m.json";

const NAME_OVERRIDES: Record<string, string> = {
  "Dem. Rep. Congo": "DR Congo", "Central African Rep.": "Central African Republic", "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea", "S. Sudan": "South Sudan", "United States of America": "United States",
};
const topology = worldAtlas as unknown as Topology;
const countries = feature(topology, topology.objects.countries as GeometryCollection<{ name?: string }>);
const projection = geoNaturalEarth1().fitExtent([[10, 10], [790, 382]], countries);
const path = geoPath(projection);
export const WORLD = countries.features.map(country => {
  const raw = country.properties?.name ?? "Unknown";
  return { name: NAME_OVERRIDES[raw] ?? raw, path: path(country) ?? "", centroid: path.centroid(country) };
}).filter(country => country.path && country.name !== "Antarctica");
const SPHERE = path({ type: "Sphere" }) ?? "";

/** An arc between two pins, bowed away from the shorter side so a line across
 * the Pacific does not lie flat on top of the countries it connects. */
function arc([x1, y1]: [number, number], [x2, y2]: [number, number]) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1, lift = Math.min(90, Math.hypot(dx, dy) * .26);
  const length = Math.hypot(dx, dy) || 1;
  return `M${x1} ${y1} Q${mx - dy / length * lift} ${my + dx / length * lift} ${x2} ${y2}`;
}

/** Countries are the only part of a thesis that has a shape. The map is the
 * whole screen here: what is selected, what it connects to, and what it means
 * are all read off the map itself rather than from labels around it. */
export function GeographyMap({ selected, thesis, onSelected, onThesis }: { selected: string[]; thesis: string; onSelected: (countries: string[]) => void; onThesis: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  const [hovered, setHovered] = useState("");
  const [zoom, setZoom] = useState(1);
  const toggle = (country: string) => onSelected(selected.includes(country) ? selected.filter(c => c !== country) : [...selected, country]);
  function add() {
    const country = draft.trim();
    if (!country || selected.includes(country)) return;
    onSelected([...selected, country]); setDraft("");
  }
  const pins = WORLD.filter(c => selected.includes(c.name));
  const focus = WORLD.find(c => c.name === hovered);
  return <div className="onb-geo">
    <div className="onb-geo-map" data-picked={selected.length || undefined}>
      <svg viewBox="0 0 800 392" role="group" aria-label="Select countries in your geopolitical outlook">
        <defs>
          <pattern id="onb-geo-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" /></pattern>
          <radialGradient id="onb-geo-glow"><stop offset="0%" stopColor="var(--onb-accent)" stopOpacity=".38" /><stop offset="100%" stopColor="var(--onb-accent)" stopOpacity="0" /></radialGradient>
        </defs>
        <path className="onb-geo-sphere" d={SPHERE} aria-hidden="true" />
        <g className="onb-geo-zoom" style={{ transform: `scale(${zoom})`, transformOrigin: "400px 196px" }}>
          {WORLD.map(country => {
            const on = selected.includes(country.name);
            return <path key={country.name} d={country.path} className={`onb-geo-country${on ? " is-selected" : ""}`} role="button" tabIndex={0} aria-label={country.name} aria-pressed={on}
              onMouseEnter={() => setHovered(country.name)} onMouseLeave={() => setHovered("")} onFocus={() => setHovered(country.name)} onBlur={() => setHovered("")}
              onClick={() => toggle(country.name)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(country.name); } }}><title>{country.name}</title></path>;
          })}
          <g className="onb-geo-web" aria-hidden="true">
            {pins.map((a, i) => pins.slice(i + 1).map(b => <path key={`${a.name}-${b.name}`} d={arc(a.centroid as [number, number], b.centroid as [number, number])} />))}
          </g>
          {focus && !selected.includes(focus.name) && <circle className="onb-geo-halo" cx={focus.centroid[0]} cy={focus.centroid[1]} r="34" fill="url(#onb-geo-glow)" aria-hidden="true" />}
          {pins.map(c => <g key={`pin-${c.name}`} className="onb-geo-pin" aria-hidden="true">
            <circle className="onb-geo-pulse" cx={c.centroid[0]} cy={c.centroid[1]} r="9" />
            <circle cx={c.centroid[0]} cy={c.centroid[1]} r="6.5" />
            <circle cx={c.centroid[0]} cy={c.centroid[1]} r="2.4" />
          </g>)}
        </g>
      </svg>

      {focus && <span className="onb-geo-tag" style={{ left: `${3 + focus.centroid[0] / 800 * 94}%`, top: `${3 + focus.centroid[1] / 392 * 94}%` }} aria-hidden="true">{focus.name}</span>}

      <span className={`onb-geo-count${selected.length ? " is-on" : ""}`} aria-live="polite">
        {selected.length ? `${selected.length} ${selected.length === 1 ? "country" : "countries"} selected` : "Tap where the ground shifts"}
      </span>

      <label className="onb-geo-find"><Search size={13} aria-hidden="true" /><span className="sr-only">Search or add a country</span>
        <input value={draft} maxLength={60} placeholder="Find a country" list="onb-geo-countries"
          onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
        <datalist id="onb-geo-countries">{WORLD.map(c => <option key={c.name} value={c.name} />)}</datalist>
      </label>

      <div className="onb-geo-zoom-controls" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(1.75, z + .25))} disabled={zoom >= 1.75}><Plus size={14} /></button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(z => Math.max(1, z - .25))} disabled={zoom <= 1}><Minus size={14} /></button>
      </div>

      {selected.length > 0 && <div className="onb-geo-selected" aria-label="Selected countries">{selected.map(c => <button type="button" key={c} onClick={() => toggle(c)}>{c}<X size={11} aria-hidden="true" /></button>)}</div>}
    </div>

    {selected.length > 0 && <label className="onb-geo-thesis"><span className="sr-only">Your geopolitical view</span>
      <textarea value={thesis} maxLength={1000} rows={2} onChange={event => onThesis(event.target.value)}
        placeholder={`What changes for markets if ${selected[selected.length - 1]} moves first?`} />
    </label>}
  </div>;
}
