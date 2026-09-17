"use client";

import { useState } from "react";
import { Globe2, Minus, Plus, X } from "lucide-react";
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

/** Countries are the only part of a thesis that has a shape. Selecting them on
 * the map is faster than naming them, and the map remembers for the agent. */
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
  const active = hovered || selected.at(-1) || "";
  return <div className="onb-geo">
    <div className="onb-geo-head">
      <div><span className="onb-geo-eyebrow"><Globe2 size={13} aria-hidden="true" /> Geography thesis</span><strong>{selected.length || "No"} {selected.length === 1 ? "country" : "countries"} selected</strong></div>
      <span className={`onb-geo-active${active ? "" : " is-empty"}`}><span />{active || "Explore the map"}</span>
    </div>
    <div className="onb-geo-map">
      <svg viewBox="0 0 800 392" role="group" aria-label="Select countries in your geopolitical outlook">
        <defs><pattern id="onb-geo-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" /></pattern></defs>
        <path className="onb-geo-sphere" d={SPHERE} aria-hidden="true" />
        <g className="onb-geo-zoom" style={{ transform: `scale(${zoom})`, transformOrigin: "400px 196px" }}>
          {WORLD.map(country => {
            const on = selected.includes(country.name);
            return <path key={country.name} d={country.path} className={`onb-geo-country${on ? " is-selected" : ""}`} role="button" tabIndex={0} aria-label={country.name} aria-pressed={on}
              onMouseEnter={() => setHovered(country.name)} onMouseLeave={() => setHovered("")} onFocus={() => setHovered(country.name)} onBlur={() => setHovered("")}
              onClick={() => toggle(country.name)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(country.name); } }}><title>{country.name}</title></path>;
          })}
          {WORLD.filter(c => selected.includes(c.name)).map(c => <g key={`pin-${c.name}`} className="onb-geo-pin" aria-hidden="true"><circle cx={c.centroid[0]} cy={c.centroid[1]} r="7" /><circle cx={c.centroid[0]} cy={c.centroid[1]} r="2.5" /></g>)}
        </g>
      </svg>
      <div className="onb-geo-zoom-controls" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(1.75, z + .25))} disabled={zoom >= 1.75}><Plus size={15} /></button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(z => Math.max(1, z - .25))} disabled={zoom <= 1}><Minus size={15} /></button>
      </div>
      <span className="onb-geo-readout mono" aria-live="polite">{Math.round(zoom * 100)}%</span>
    </div>
    <p className="onb-hint is-left">Select any countries that matter to your thesis. This is your outlook, not a claim that conflict is certain.</p>
    <div className="onb-geo-add">
      <input value={draft} maxLength={60} placeholder="Search or add a country" aria-label="Search or add a country" list="onb-geo-countries"
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      <button type="button" className="button button-secondary" onClick={add}>Add</button>
      <datalist id="onb-geo-countries">{WORLD.map(c => <option key={c.name} value={c.name} />)}</datalist>
    </div>
    {selected.length > 0 && <div className="onb-geo-selected" aria-label="Selected countries">{selected.map(c => <button type="button" key={c} onClick={() => toggle(c)}>{c}<X size={11} aria-hidden="true" /></button>)}</div>}
    <label className="onb-field">Your geopolitical view
      <textarea value={thesis} maxLength={1000} onChange={event => onThesis(event.target.value)} placeholder="What changes if your scenario happens?" />
    </label>
  </div>;
}
