"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, Atom, Bell, Blocks, Bot, BrainCircuit, Check, CircleDollarSign, Cpu, Cross, Dna, Factory, Globe2, GraduationCap, HeartPulse, Home, KeyRound, Leaf, MessageSquare, Minus, Orbit, Plane, Plus, Scale, Shield, ShoppingBag, Sparkles, Store, type LucideIcon, Utensils, Zap, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldAtlas from "world-atlas/countries-110m.json";
import { SiteHeader } from "../_components/site-header";
import { SignInScene } from "../_components/sign-in";
import { LoadingState } from "../_components/ui";
import { usePrivyConfigured } from "../providers";
import { PERMISSIONS, limitsError, newProfile, profileKey, readProfile, type InvestingProfile, type Permission } from "@/lib/socialtrading/profile";
import { DEFAULT_PLAN } from "@/lib/socialtrading/plans";
import { gsap, useGSAP, rubiconMotion } from "../_components/motion";
import { suggestedThemes, THEMES } from "@/lib/socialtrading/themes";
import { generatedAgentName } from "@/lib/socialtrading/agents/naming";
import { ProfileCard } from "./profile-card";
import "./socialtrading.css";

const KNOWLEDGE_LABELS = ["Just starting", "Know the basics", "Comfortable", "Experienced", "Very experienced"];
const ESG_LABELS = ["Returns first", "Mostly returns", "Balanced", "Mostly impact", "Impact first"];
const PRIORITY_LABELS = ["Not important", "A little", "Somewhat", "A lot", "Essential"];
const TECHNOLOGY_THEME: Record<string, (typeof THEMES)[number]["id"]> = {
  "Defense technology": "tech", Cybersecurity: "tech", "Space systems": "tech", "Industrial automation": "tech",
  "AI infrastructure": "ai", Semiconductors: "tech", Robotics: "tech", Blockchain: "crypto",
  "AI safety": "ai", "Climate technology": "energy", "Clean energy": "energy", Biotechnology: "healthcare",
  "Energy security": "energy", "Critical minerals": "energy", "Quantum computing": "tech", "Precision medicine": "healthcare",
  Longevity: "healthcare", "Consumer brands": "consumer", Fintech: "tech", Housing: "consumer", "E-commerce": "consumer",
  "Food systems": "consumer", Travel: "consumer", "Education technology": "tech",
};

const WORLDVIEW_OPTIONS = [
  { name: "Breakthrough innovation", note: "New technology creates new markets", Icon: Sparkles },
  { name: "Resilience & security", note: "Scarcity and stability shape returns", Icon: Shield },
  { name: "Human progress", note: "Longer, healthier, cleaner lives", Icon: HeartPulse },
  { name: "Everyday shifts", note: "How people live and spend keeps changing", Icon: ShoppingBag },
] as const;

const DOMAIN_GROUPS: Record<string, string[]> = {
  "Breakthrough innovation": ["AI infrastructure", "Semiconductors", "Robotics", "Quantum computing", "Space systems", "Blockchain"],
  "Resilience & security": ["Defense technology", "Cybersecurity", "Energy security", "Critical minerals", "Space systems", "Industrial automation"],
  "Human progress": ["Precision medicine", "Biotechnology", "Longevity", "AI safety", "Climate technology", "Clean energy", "Education technology"],
  "Everyday shifts": ["Consumer brands", "Fintech", "Housing", "E-commerce", "Food systems", "Travel"],
};

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  "Defense technology": Shield, Cybersecurity: KeyRound, "Space systems": Orbit, "Industrial automation": Factory,
  "AI infrastructure": BrainCircuit, Semiconductors: Cpu, Robotics: Bot, Blockchain: Blocks,
  "AI safety": Scale, "Climate technology": Leaf, "Clean energy": Zap, Biotechnology: Dna,
  "Energy security": Zap, "Critical minerals": Atom, "Quantum computing": Atom, "Precision medicine": Cross,
  Longevity: HeartPulse, "Consumer brands": ShoppingBag, Fintech: CircleDollarSign, Housing: Home,
  "E-commerce": Store, "Food systems": Utensils, Travel: Plane, "Education technology": GraduationCap,
};

const COUNTRY_NAME_OVERRIDES: Record<string, string> = {
  "Dem. Rep. Congo": "DR Congo", "Central African Rep.": "Central African Republic", "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea", "S. Sudan": "South Sudan", "United States of America": "United States",
};
const worldTopology = worldAtlas as unknown as Topology;
const worldCountries = feature(worldTopology, worldTopology.objects.countries as GeometryCollection<{ name?: string }>);
const worldProjection = geoNaturalEarth1().fitExtent([[10, 10], [790, 382]], worldCountries);
const worldPath = geoPath(worldProjection);
const WORLD_COUNTRIES = worldCountries.features.map(country => {
  const rawName = country.properties?.name ?? "Unknown";
  return { name: COUNTRY_NAME_OVERRIDES[rawName] ?? rawName, path: worldPath(country) ?? "", centroid: worldPath.centroid(country) };
}).filter(country => country.path && country.name !== "Antarctica");

function adaptivePath(esg: number | null, ai: number | null, drivers: string[]) {
  const chosenGroups = drivers.length ? drivers : esg !== null && esg >= 3 ? ["Human progress"] : esg !== null && esg <= 1 ? ["Resilience & security"] : ["Breakthrough innovation", "Everyday shifts"];
  const technologies = [...new Set(chosenGroups.flatMap(driver => DOMAIN_GROUPS[driver] ?? []))].slice(0, 8);
  const resilience = chosenGroups.includes("Resilience & security");
  const human = chosenGroups.includes("Human progress");
  const everyday = chosenGroups.includes("Everyday shifts");
  return {
    aiQuestion: human ? "How important is responsible AI to your outlook?" : resilience ? "How important is AI as a strategic advantage?" : "How much will AI reshape the economy?",
    techQuestion: resilience ? "Which resilience themes pull you in?" : human ? "Where can human progress compound?" : everyday ? "Which shifts in daily life matter most?" : "Which high-growth areas pull you in?",
    technologies,
    ideas: resilience
      ? [ai !== null && ai >= 3 ? "AI-enabled defense and cybersecurity will become strategic infrastructure" : "Defense modernization will accelerate over the next decade", "Energy and critical-mineral security will reshape global supply chains", "Space systems will become essential economic infrastructure"]
      : human ? ["Precision medicine and AI will extend healthy lives", "Clean energy will power the next economy", "Climate adaptation will become core infrastructure"]
      : everyday ? ["Digital finance will become invisible infrastructure", "Housing and affordability will reshape consumer behavior", "Global brands will be rebuilt around new generations"]
      : ["AI infrastructure will be the foundation of the next economy", "Semiconductors and power will remain the bottlenecks for AI", "Robotics will bring intelligence into the physical world"],
  };
}

function RangeQuestion({ label, value, labels, onChange }: { label: string; value: number | null; labels: readonly string[]; onChange: (value: number) => void }) {
  const shown = value ?? Math.floor(labels.length / 2);
  return <fieldset className={`socialtrading-range${value === null ? " is-unset" : ""}`}>
    <legend>{label}</legend>
    <div className="socialtrading-range-value" aria-live="polite">{value === null ? "Move the slider to choose" : labels[shown]}</div>
    <input className="socialtrading-slider" style={{ "--range-progress": `${shown / (labels.length - 1) * 100}%` } as CSSProperties} type="range" min="0" max={labels.length - 1} step="1" value={shown} onChange={e => onChange(Number(e.target.value))} aria-label={label} />
    <div className="socialtrading-range-ends" aria-hidden="true"><span>{labels[0]}</span><span>{labels.at(-1)}</span></div>
  </fieldset>;
}

function AIFutureChart({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number) => void }) {
  const shown = value ?? 2;
  const endY = 102 - shown * 18;
  return <fieldset className={`socialtrading-ai-chart${value === null ? " is-unset" : ""}`}>
    <legend>{label}</legend>
    <div className="socialtrading-ai-chart-head">
      <span><Sparkles size={14} aria-hidden="true" /> Your 2031 prediction</span>
      <strong>Drag to adjust</strong>
      <span className="sr-only" aria-live="polite">{value === null ? "No prediction selected" : PRIORITY_LABELS[shown]}</span>
    </div>
    <div className="socialtrading-ai-plot" aria-hidden="true">
      <svg viewBox="0 0 520 126" preserveAspectRatio="none">
        <defs><linearGradient id="ai-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".22" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        <path className="socialtrading-ai-grid" d="M20 22H500M20 62H500M20 102H500" />
        <path className="socialtrading-ai-history" d="M20 101 C105 98 145 91 205 82 S278 69 318 66" />
        <path className="socialtrading-ai-area" d={`M20 101 C105 98 145 91 205 82 S278 69 318 66 C376 62 438 ${endY + 8} 500 ${endY} L500 112 L20 112 Z`} />
        <path className="socialtrading-ai-future" d={`M318 66 C376 62 438 ${endY + 8} 500 ${endY}`} />
        <path className="socialtrading-ai-guide" d={`M500 ${endY}V112`} />
        <circle className="socialtrading-ai-endpoint" cx="500" cy={endY} r="7" />
      </svg>
      <strong className="socialtrading-ai-plot-value" style={{ top: `${endY / 126 * 100}%` }}>{value === null ? "?" : PRIORITY_LABELS[shown]}</strong>
      <span className="socialtrading-ai-now">Now</span><span className="socialtrading-ai-year">2031</span>
    </div>
    <input className="socialtrading-slider" style={{ "--range-progress": `${shown / 4 * 100}%` } as CSSProperties} type="range" min="0" max="4" step="1" value={shown} onChange={event => onChange(Number(event.target.value))} aria-label={label} />
    <div className="socialtrading-range-ends" aria-hidden="true"><span>Niche tool</span><span>Changes everything</span></div>
  </fieldset>;
}

function DomainIcon({ name }: { name: string }) {
  const Icon = DOMAIN_ICONS[name] ?? Sparkles;
  const theme = THEMES.find(item => item.id === TECHNOLOGY_THEME[name]) ?? THEMES[1];
  return <span className="socialtrading-domain-icon" style={{ "--domain-color": theme.dark, "--domain-light": theme.light } as CSSProperties} aria-hidden="true">
    {name === "Cybersecurity" ? <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.8 19 6v5.1c0 4.6-2.8 8.1-7 10.1-4.2-2-7-5.5-7-10.1V6Z" fill="currentColor" fillOpacity=".08" />
      <circle cx="12" cy="11" r="2.1" /><path d="M12 13.1v3.2M5 9H2.8M19 9h2.2M7 17l-1.7 1.5M17 17l1.7 1.5" opacity=".7" />
    </svg> : <Icon size={20} strokeWidth={1.45} />}
    <span />
  </span>;
}

function ConflictMap({ selected, thesis, onSelected, onThesis }: { selected: string[]; thesis: string; onSelected: (countries: string[]) => void; onThesis: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  const [hoveredCountry, setHoveredCountry] = useState("");
  const [zoom, setZoom] = useState(1);
  const toggle = (country: string) => onSelected(selected.includes(country) ? selected.filter(item => item !== country) : [...selected, country]);
  const addCountry = () => {
    const country = draft.trim();
    if (!country || selected.includes(country)) return;
    onSelected([...selected, country]);
    setDraft("");
  };
  const activeCountry = hoveredCountry || selected.at(-1) || "Explore the map";
  return <div className="socialtrading-map-card">
    <div className="socialtrading-map-head">
      <div><span className="socialtrading-map-eyebrow"><Globe2 size={13} /> Geography thesis</span><strong>{selected.length || "No"} {selected.length === 1 ? "country" : "countries"} selected</strong></div>
      <span className={`socialtrading-map-active${activeCountry === "Explore the map" ? " is-empty" : ""}`}><span />{activeCountry}</span>
    </div>
    <div className="socialtrading-map">
      <svg className="socialtrading-world-map" viewBox="0 0 800 392" role="group" aria-label="Select countries in your geopolitical outlook">
        <defs>
          <pattern id="rubicon-map-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.45" fill="var(--map-blue)" opacity=".42" /></pattern>
        </defs>
        <path className="socialtrading-map-sphere" d={worldPath({ type: "Sphere" }) ?? ""} aria-hidden="true" />
        <g className="socialtrading-map-zoom-layer" style={{ transform: `scale(${zoom})`, transformOrigin: "400px 196px" }}>
          {WORLD_COUNTRIES.map(country => {
            const active = selected.includes(country.name);
            return <path key={country.name} d={country.path} className={`socialtrading-map-country${active ? " is-selected" : ""}`} role="button" tabIndex={0}
              aria-label={country.name} aria-pressed={active} onMouseEnter={() => setHoveredCountry(country.name)} onMouseLeave={() => setHoveredCountry("")}
              onFocus={() => setHoveredCountry(country.name)} onBlur={() => setHoveredCountry("")} onClick={() => toggle(country.name)} onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(country.name); }
              }}><title>{country.name}</title></path>;
          })}
          {WORLD_COUNTRIES.filter(country => selected.includes(country.name)).map(country => <g className="socialtrading-map-marker" key={`marker-${country.name}`} aria-hidden="true">
            <circle className="socialtrading-map-marker-ring" cx={country.centroid[0]} cy={country.centroid[1]} r="7" />
            <circle className="socialtrading-map-marker-core" cx={country.centroid[0]} cy={country.centroid[1]} r="2.5" />
          </g>)}
        </g>
      </svg>
      <div className="socialtrading-map-controls" aria-label="Map zoom controls">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(1.75, value + .25))} disabled={zoom >= 1.75}><Plus size={16} /></button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(1, value - .25))} disabled={zoom <= 1}><Minus size={16} /></button>
      </div>
      <span className="socialtrading-map-zoom-readout mono" aria-live="polite">{Math.round(zoom * 100)}%</span>
    </div>
    <p className="socialtrading-caption">Select any countries that matter to your thesis. This is your outlook—not a claim that conflict is certain.</p>
    <div className="socialtrading-map-add">
      <input className="socialtrading-input" value={draft} maxLength={60} placeholder="Search or add a country" aria-label="Search or add a country" list="socialtrading-country-list"
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addCountry(); } }} />
      <button type="button" className="button button-secondary" onClick={addCountry}>Add</button>
      <datalist id="socialtrading-country-list">{WORLD_COUNTRIES.map(country => <option key={country.name} value={country.name} />)}</datalist>
    </div>
    {selected.length > 0 && <div className="socialtrading-map-selections" aria-label="Selected countries">{selected.map(country => <button type="button" key={country} onClick={() => toggle(country)}>{country}<span aria-hidden="true">×</span></button>)}</div>}
    <label className="socialtrading-field-label">Your geopolitical view
      <textarea className="socialtrading-input socialtrading-map-thesis" value={thesis} maxLength={1000} onChange={event => onThesis(event.target.value)} placeholder="What changes if your scenario happens?" />
    </label>
  </div>;
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="landing-page socialtrading-page"><SiteHeader /><main className="container socialtrading-main"><div className="dashboard-theme socialtrading-flow">{children}</div></main></div>;
}

export function SocialTrading() {
  const configured = usePrivyConfigured();
  if (!configured) return <Frame><h1 className="landing-section-title">Sign-in is unavailable</h1><p className="mt-3 text-sm text-[var(--muted)]">Rubicon sign-in needs to be configured before you can create an investing profile.</p></Frame>;
  return <AuthenticatedProfile />;
}

function AuthenticatedProfile() {
  const { ready, authenticated, user } = usePrivy();
  if (!ready) return <Frame><LoadingState label="Loading your session…" /></Frame>;
  if (!authenticated || !user) return <div className="landing-page socialtrading-page"><SignInScene /></div>;
  // Unmount local state immediately on logout/account switch, as in AppProviders.
  return <Frame><ProfileFlow key={user.id} userId={user.id} name={user.twitter?.name ?? user.email?.address?.split("@")[0]} /></Frame>;
}

export function ProfileFlow({ userId, name, onComplete, completing = false, serverError = "", persist = true, agentCreation = false, plan = DEFAULT_PLAN }: {
  userId: string; name?: string;
  /** Receives the completed profile. Without it, completion routes to the hub. */
  onComplete?: (profile: InvestingProfile) => void | Promise<void>;
  completing?: boolean; serverError?: string; persist?: boolean; agentCreation?: boolean; plan?: { name: string; limits: typeof DEFAULT_PLAN.limits };
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<InvestingProfile>(() => newProfile(userId));
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [error, setError] = useState("");
  const [guidedScene, setGuidedScene] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { step } = profile;
  const stage = useRef<HTMLDivElement>(null);
  const exitTween = useRef<gsap.core.Tween | null>(null);
  const pendingStep = useRef<number | null>(null);
  const limits = useRef<HTMLDivElement>(null);
  const permissionOptions = useRef<HTMLFieldSetElement>(null);

  useEffect(() => () => { exitTween.current?.kill(); }, []);

  const { contextSafe } = useGSAP(() => {
    if (!loaded || !stage.current) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(stage.current, { opacity: .3, y: 9, filter: "blur(3px)", scale: .995 }, {
        opacity: 1, y: 0, filter: "blur(0px)", scale: 1, duration: .34,
        ease: rubiconMotion.ease.enter, clearProps: "all",
      });
      gsap.fromTo(stage.current!.querySelectorAll("[data-step-part]"), { y: 5, opacity: .5 }, {
        y: 0, opacity: 1, duration: .32, stagger: .035,
        ease: rubiconMotion.ease.enter, clearProps: "all",
      });
    });
    return () => media.revert();
  }, { scope: stage, dependencies: [step, guidedScene, loaded], revertOnUpdate: true });

  useGSAP(() => {
    if (step !== 5 || !profile.permissionConfigured) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const selected = permissionOptions.current?.querySelector("input:checked")?.closest("label");
      if (selected) gsap.fromTo(selected, { scale: .985 }, {
        scale: 1, duration: .3, ease: rubiconMotion.ease.enter, clearProps: "transform",
      });
      if (profile.permission === "automatic" && limits.current) {
        gsap.fromTo(limits.current, { height: 0, opacity: 0, y: -5 }, {
          height: "auto", opacity: 1, y: 0, duration: .4,
          ease: rubiconMotion.ease.enter, clearProps: "all",
        });
      }
    });
    return () => media.revert();
  }, { dependencies: [profile.permission, profile.permissionConfigured, step], revertOnUpdate: true });

  const goTo = contextSafe((target: InvestingProfile["step"]) => {
    if (pendingStep.current === target) return;
    exitTween.current?.kill();
    pendingStep.current = target;
    const commit = () => {
      pendingStep.current = null;
      setError("");
      setProfile(p => ({ ...p, step: target, updatedAt: new Date().toISOString(), completedAt: null }));
    };
    if (!stage.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { commit(); return; }
    gsap.killTweensOf(stage.current);
    exitTween.current = gsap.to(stage.current, {
      opacity: 0, y: -6, filter: "blur(2px)", scale: .995,
      duration: .14, ease: rubiconMotion.ease.exit, onComplete: commit,
    });
  });

  useEffect(() => {
    try { if (persist) setProfile(readProfile(localStorage.getItem(profileKey(userId)), userId)); }
    catch { setStorageError("Browser storage is unavailable. Your profile will only last for this visit."); }
    setLoaded(true);
  }, [userId, persist]);

  useEffect(() => {
    if (!loaded || !persist) return;
    try {
      localStorage.setItem(profileKey(userId), JSON.stringify(profile));
      setStorageError("");
    } catch { setStorageError("Your changes could not be saved in this browser. Keep this page open to retain them."); }
  }, [profile, loaded, userId, persist]);

  useEffect(() => {
    if (!loaded || !heading.current) return;
    heading.current.focus({ preventScroll: true });
    // Keep the active prompt clear of the sticky header without snapping the
    // document scrollbar between the short scenes.
    if (heading.current.getBoundingClientRect().top < 96) {
      (stage.current?.previousElementSibling ?? heading.current).scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [step, guidedScene, loaded]);

  function update(patch: Partial<InvestingProfile>) {
    setError("");
    setProfile(p => ({ ...p, ...patch, updatedAt: new Date().toISOString(), completedAt: null }));
  }
  function next(event: FormEvent) {
    event.preventDefault();
    if (step === 1 && profile.investorAnswers.knowledge === null) { setError("Choose how much you know about investing to continue."); return; }
    if (step === 1) { goTo(2); return; }
    const guided = (profile.investorAnswers.knowledge ?? 0) < 3 || profile.investorAnswers.guidedTest;
    if (step === 2 && guided) {
      const showConflict = (profile.investorAnswers.esgPriority !== null && profile.investorAnswers.esgPriority <= 1) || profile.investorAnswers.technologies.includes("Defense technology");
      const thesisScene = showConflict ? 5 : 4;
      if (guidedScene === 0 && !profile.investorAnswers.opportunityDrivers.length) { setError("Choose the kind of change you believe creates opportunity."); return; }
      if (guidedScene === 0) { setGuidedScene(1); return; }
      if (guidedScene === 1 && profile.investorAnswers.esgPriority === null) { setError("Choose what matters most to you."); return; }
      if (guidedScene === 1) { setGuidedScene(2); return; }
      if (guidedScene === 2 && profile.investorAnswers.aiPriority === null) { setError("Drag the prediction to show where you think AI is heading."); return; }
      if (guidedScene === 2) { setGuidedScene(3); return; }
      if (guidedScene === 3 && !profile.investorAnswers.technologies.length) { setError("Pick at least one area that catches your eye."); return; }
      if (guidedScene === 3) { setGuidedScene(4); return; }
      if (guidedScene < thesisScene) { setGuidedScene(scene => scene + 1); return; }
    }
    if (step === 2 && !profile.thesis.trim()) { setError("Choose a future or write your own."); return; }
    if (step === 2) { goTo(5); return; }
    if (step === 5 && profile.permission === "automatic") {
      const message = limitsError(profile.limits);
      if (message) { setError(message); return; }
    }
    if (step === 5 && !profile.permissionConfigured) {
      setError("Choose how your agent should act to continue.");
      return;
    }
    if (step === 5) { startExploring(); return; }
    goTo(2);
  }
  function startExploring() {
    const answerThemes = profile.investorAnswers.technologies.map(t => TECHNOLOGY_THEME[t]).filter((t): t is InvestingProfile["themes"][number] => !!t);
    const completed = { ...profile, themes: [...new Set([...profile.themes, ...answerThemes, ...suggestedThemes(profile.thesis)])], step: 6 as const, completedAt: new Date().toISOString() };
    try { if (persist) localStorage.setItem(profileKey(userId), JSON.stringify(completed)); }
    catch { setStorageError("Your profile could not be saved. Enable browser storage, then try again."); return; }
    if (onComplete) { void onComplete(completed); return; }
    router.push("/");
  }

  if (!loaded) return <LoadingState label="Loading your profile…" />;
  const permissionIcons = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal };
  const guided = (profile.investorAnswers.knowledge ?? 0) < 3 || profile.investorAnswers.guidedTest;
  const path = adaptivePath(profile.investorAnswers.esgPriority, profile.investorAnswers.aiPriority, profile.investorAnswers.opportunityDrivers);
  const showConflict = (profile.investorAnswers.esgPriority !== null && profile.investorAnswers.esgPriority <= 1) || profile.investorAnswers.technologies.includes("Defense technology");
  const thesisScene = showConflict ? 5 : 4;
  const guidedTitles = ["What kind of change creates opportunity?", "What should your money stand for?", "Where will AI be in five years?", path.techQuestion, showConflict ? "Where could conflict reshape markets?" : "Pick the future you believe in", "Pick the future you believe in"];
  const guidedDescriptions = ["Choose the belief that feels most like you.", "Go with your instinct.", "Pull the marker to draw your prediction.", "Pick a few. This deck was shaped by your earlier answers.", showConflict ? "Pin the countries in your scenario—or skip this if it isn’t part of your thesis." : "One tap is enough. Or add your own thought.", "Connect the dots in your own words."];
  const title = step === 1 ? "How much do you know about investing?"
    : step === 2 && guided ? guidedTitles[guidedScene]
    : step === 2 ? "What will matter in five or ten years?"
    : step === 5 ? "How should your agent act?"
    : agentCreation ? "Your next agent." : "Your world. Your trading agent.";
  const description = step === 1 ? "No wrong answer. We’ll match the experience to you."
    : step === 2 && guided ? guidedDescriptions[guidedScene]
    : step === 2 ? "Choose a starting point, write your own, or take the optional short path."
    : step === 5 ? "You stay in control."
    : "A personalized profile, built around what matters to you.";
  const totalQuestions = profile.investorAnswers.knowledge === null ? 3 : guided ? (showConflict ? 8 : 7) : 3;
  const progress = step === 1 ? 1 : step === 2 ? (guided ? guidedScene + 2 : 2) : totalQuestions;

  return (
    <div className={`socialtrading-layout${step === 6 ? " is-final" : ""}`}>
      <div className="socialtrading-question">
        <div className="socialtrading-progress-wrap">
          <p className="socialtrading-progress mono" aria-label={`Step ${progress} of ${totalQuestions}`}>{progress} <span>/ {totalQuestions}</span></p>
          <div className="socialtrading-progress-track" aria-hidden="true"><span style={{ width: `${(progress / totalQuestions) * 100}%` }} /></div>
        </div>
        <div ref={stage} className="socialtrading-stage">
          <header data-step-part>
            <h1 ref={heading} tabIndex={-1} className="landing-hero-title outline-none">{title}</h1>
            <p className="landing-hero-lead socialtrading-lead">{description}</p>
          </header>
          {step < 6 ? (
            <form onSubmit={next} noValidate>
              <div className="socialtrading-fields" data-step-part>
                {step === 1 && (
                  <RangeQuestion label="Investment knowledge" value={profile.investorAnswers.knowledge} labels={KNOWLEDGE_LABELS}
                    onChange={knowledge => update({ investorAnswers: { ...profile.investorAnswers, knowledge, guidedTest: knowledge < 3 } })} />
                )}
                {step === 2 && (
                  <>
                    {(profile.investorAnswers.knowledge ?? 0) >= 3 && !profile.investorAnswers.guidedTest && <button type="button" className="socialtrading-test-toggle" onClick={() => update({ investorAnswers: { ...profile.investorAnswers, guidedTest: true } })}>Take the optional personality path</button>}
                    {guided && <div className="socialtrading-test" aria-label="Short investing interests test">
                      {(profile.investorAnswers.knowledge ?? 0) >= 3 && <button type="button" className="socialtrading-test-toggle" onClick={() => update({ investorAnswers: { ...profile.investorAnswers, guidedTest: false } })}>Skip the optional path</button>}
                      {guidedScene === 0 && <div className="socialtrading-adaptive-reveal"><fieldset className="socialtrading-choice-fieldset"><legend className="sr-only">Opportunity worldview</legend><div className="socialtrading-worldview-options">{WORLDVIEW_OPTIONS.map(({ name: driver, note, Icon }, index) => {
                        const selected = profile.investorAnswers.opportunityDrivers.includes(driver);
                        return <button type="button" key={driver} aria-label={driver} aria-pressed={selected} className={`socialtrading-choice-card socialtrading-worldview-card${selected ? " is-selected" : ""}`}
                          onClick={() => update({ investorAnswers: { ...profile.investorAnswers, opportunityDrivers: [driver], technologies: [], conflictCountries: [], geopoliticalThesis: "" } })}>
                          <span className="socialtrading-choice-index mono">0{index + 1}</span><span className="socialtrading-worldview-icon" aria-hidden="true"><Icon size={21} strokeWidth={1.45} /></span>
                          <span className="socialtrading-choice-copy"><strong>{driver}</strong><small>{note}</small></span><span className="socialtrading-choice-check" aria-hidden="true">{selected && <Check size={14} />}</span>
                        </button>;
                      })}</div></fieldset></div>}
                      {guidedScene === 1 && <div><RangeQuestion label="How much should ethics and impact shape your investments?" value={profile.investorAnswers.esgPriority} labels={ESG_LABELS} onChange={esgPriority => update({ investorAnswers: { ...profile.investorAnswers, esgPriority, aiPriority: null, technologies: [], conflictCountries: [], geopoliticalThesis: "" } })} /></div>}
                      {guidedScene === 2 && <div className="socialtrading-adaptive-reveal"><AIFutureChart label={path.aiQuestion} value={profile.investorAnswers.aiPriority} onChange={aiPriority => update({ investorAnswers: { ...profile.investorAnswers, aiPriority } })} /></div>}
                      {guidedScene === 3 && <div className="socialtrading-adaptive-reveal"><fieldset className="socialtrading-choice-fieldset"><legend className="sr-only">{path.techQuestion}</legend><div className="socialtrading-tech-options socialtrading-domain-options">{path.technologies.map((technology, index) => {
                        const selected = profile.investorAnswers.technologies.includes(technology);
                        return <button type="button" key={technology} aria-label={technology} aria-pressed={selected} className={`socialtrading-choice-card${selected ? " is-selected" : ""}`} onClick={() => {
                          const technologies = selected ? profile.investorAnswers.technologies.filter(t => t !== technology) : [...profile.investorAnswers.technologies, technology];
                          update({ investorAnswers: { ...profile.investorAnswers, technologies } });
                        }}><span className="socialtrading-choice-index mono">{String(index + 1).padStart(2, "0")}</span><DomainIcon name={technology} /><span>{technology}</span><span className="socialtrading-choice-check" aria-hidden="true">{selected && <Check size={14} />}</span></button>;
                      })}</div></fieldset></div>}
                      {guidedScene === 4 && showConflict && <div className="socialtrading-adaptive-reveal"><ConflictMap selected={profile.investorAnswers.conflictCountries} thesis={profile.investorAnswers.geopoliticalThesis}
                        onSelected={conflictCountries => update({ investorAnswers: { ...profile.investorAnswers, conflictCountries } })}
                        onThesis={geopoliticalThesis => update({ investorAnswers: { ...profile.investorAnswers, geopoliticalThesis } })} /></div>}
                    </div>}
                    {(!guided || guidedScene === thesisScene) && <div className="socialtrading-adaptive-reveal socialtrading-thesis-builder">
                      <p className="socialtrading-caption">{guided ? "Theses shaped by your answers" : "Choose a starting point or write your own"}</p>
                      <div className="socialtrading-chips" aria-label="Future ideas">
                        {path.ideas.map(idea => <button type="button" key={idea} className={`button button-secondary socialtrading-chip${profile.investorAnswers.futureVision === idea ? " socialtrading-chip-selected" : ""}`}
                          aria-pressed={profile.investorAnswers.futureVision === idea} onClick={() => update({ thesis: idea, investorAnswers: { ...profile.investorAnswers, futureVision: idea } })}>{idea}</button>)}
                      </div>
                      <label className="socialtrading-field-label">Your 5–10 year view
                        <textarea className="socialtrading-input socialtrading-thesis" value={profile.thesis} maxLength={plan.limits.thesisChars}
                          onChange={e => update({ thesis: e.target.value, investorAnswers: { ...profile.investorAnswers, futureVision: e.target.value } })}
                          placeholder="What do you think will be super important in 5 or 10 years?"
                          aria-invalid={!!error} aria-describedby={error ? "profile-error" : undefined} />
                      </label>
                    </div>}
                  </>
                )}
                {step === 5 && (
                  <>
                    <fieldset ref={permissionOptions} className="socialtrading-options">
                      <legend className="sr-only">Agent permissions</legend>
                      {(Object.entries(PERMISSIONS) as [Permission, string][]).map(([value, label]) => {
                        const Icon = permissionIcons[value];
                        const selected = profile.permissionConfigured && profile.permission === value;
                        return <label key={value} className="socialtrading-option">
                          <input type="radio" name="permission" value={value} checked={selected}
                            onChange={() => update({ permission: value, permissionConfigured: true })} />
                          <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
                          <span>{label}</span><span className="socialtrading-option-check" aria-hidden="true">{selected && <Check size={12} />}</span>
                        </label>;
                      })}
                    </fieldset>
                    {profile.permissionConfigured && profile.permission === "automatic" && (
                      <div ref={limits} className="socialtrading-limits-reveal">
                        <fieldset>
                          <legend className="socialtrading-caption">Your limits · USD</legend>
                          <div className="socialtrading-limits">
                            {([["perTrade", "Maximum per trade"], ["daily", "Daily limit"], ["weekly", "Weekly limit"]] as const).map(([key, label]) => (
                              <label key={key}>{label}<input className="socialtrading-input" type="number" inputMode="decimal" min="0.01" step="0.01"
                                value={profile.limits[key]} onChange={e => update({ limits: { ...profile.limits, [key]: e.target.value } })}
                                placeholder="0.00" aria-invalid={!!error} aria-describedby={error ? "profile-error" : undefined} /></label>
                            ))}
                          </div>
                          <p className="socialtrading-caption socialtrading-limit-note">Never exceed these limits without asking me.</p>
                        </fieldset>
                      </div>
                    )}
                  </>
                )}
              </div>
              {error && <p id="profile-error" className="mt-4 text-sm" role="alert">{error}</p>}
              <div className="socialtrading-actions" data-step-part>
                <button type="submit" className="button button-primary">{step === 5 ? (agentCreation ? "Create agent" : "Meet my agent") : "Continue"}<ArrowRight size={14} aria-hidden="true" /></button>
                {step > 1 && <button type="button" className="button button-secondary" onClick={() => {
                  if (step === 2 && guided && guidedScene > 0) { setError(""); setGuidedScene(scene => scene - 1); return; }
                  if (step === 5 && guided) { setGuidedScene(thesisScene); goTo(2); return; }
                  goTo(step === 5 ? 2 : 1);
                }}><ArrowLeft size={14} aria-hidden="true" />Back</button>}
              </div>
            </form>
          ) : (
            <div className="socialtrading-final" data-step-part>
              {error && <p role="alert">{error}</p>}
              <p className="socialtrading-final-note">Your thesis sets the direction.<br />Your interests make it personal.<br />Your rules keep you in control.</p>
              <div className="socialtrading-actions">
                <button type="button" className="button button-primary" onClick={startExploring} disabled={completing}>{completing ? "Meeting your agent…" : (agentCreation ? "Create agent" : "Meet your agent")}<ArrowRight size={14} aria-hidden="true" /></button>
                <button type="button" className="button button-secondary" onClick={() => goTo(1)} disabled={completing}>Edit profile</button>
              </div>
              {serverError && <p className="mt-4 text-sm" role="alert">{serverError}</p>}
              <p className="socialtrading-caption socialtrading-explore-note">Your agent picks up right where this leaves off.</p>
            </div>
          )}
          {storageError && <p className="mt-4 text-sm" role="alert">{storageError}</p>}
        </div>
      </div>
      <ProfileCard profile={profile} name={name} agentName={agentCreation ? generatedAgentName(profile, name, userId) : undefined} />
    </div>
  );
}
