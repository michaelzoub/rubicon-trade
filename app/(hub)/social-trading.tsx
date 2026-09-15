"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, Bell, Check, MessageSquare, Plus, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SiteHeader } from "../_components/site-header";
import { SignInScene } from "../_components/sign-in";
import { LoadingState } from "../_components/ui";
import { usePrivyConfigured } from "../providers";
import { PERMISSIONS, limitsError, newProfile, profileKey, readProfile, type Interest, type InvestingProfile, type Permission } from "@/lib/socialtrading/profile";
import { DEFAULT_PLAN, followedAssets } from "@/lib/socialtrading/plans";
import { gsap, useGSAP, rubiconMotion } from "../_components/motion";
import { assetSuggestions } from "@/lib/socialtrading/suggestions";
import { suggestedThemes, THEMES } from "@/lib/socialtrading/themes";
import { ThemeCards } from "./theme-cards";
import { ProfileCard } from "./profile-card";
import "./socialtrading.css";

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

export function ProfileFlow({ userId, name, onComplete, completing = false, serverError = "" }: {
  userId: string; name?: string;
  /** Receives the completed profile. Without it, completion routes to the hub. */
  onComplete?: (profile: InvestingProfile) => void | Promise<void>;
  completing?: boolean; serverError?: string;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<InvestingProfile>(() => newProfile(userId));
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const { step } = profile;
  const stage = useRef<HTMLDivElement>(null);
  const exitTween = useRef<gsap.core.Tween | null>(null);
  const pendingStep = useRef<number | null>(null);
  const interests = useRef<HTMLDivElement>(null);
  const previousInterests = useRef(new Set<string>());
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
  }, { scope: stage, dependencies: [step, loaded], revertOnUpdate: true });

  useGSAP(() => {
    const added = profile.interests.filter(i => !previousInterests.current.has(i.id));
    previousInterests.current = new Set(profile.interests.map(i => i.id));
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const targets = Array.from(interests.current?.querySelectorAll<HTMLElement>("[data-interest]") ?? [])
        .filter(node => added.some(i => i.id === node.dataset.interest));
      if (targets.length) gsap.fromTo(targets, { opacity: 0, y: 5, scale: .96 }, {
        opacity: 1, y: 0, scale: 1, duration: .32, stagger: .035,
        ease: rubiconMotion.ease.enter, clearProps: "all",
      });
    });
    return () => media.revert();
  }, { scope: interests, dependencies: [profile.interests], revertOnUpdate: true });

  useGSAP(() => {
    if (step !== 4 || !profile.permissionConfigured) return;
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
    try { setProfile(readProfile(localStorage.getItem(profileKey(userId)), userId)); }
    catch { setStorageError("Browser storage is unavailable. Your profile will only last for this visit."); }
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(profileKey(userId), JSON.stringify(profile));
      setStorageError("");
    } catch { setStorageError("Your changes could not be saved in this browser. Keep this page open to retain them."); }
  }, [profile, loaded, userId]);

  useEffect(() => {
    if (!loaded || !heading.current) return;
    heading.current.focus({ preventScroll: true });
    // Continue can be below the fold on mobile. Keep the next question clear
    // of Rubicon's sticky header without adding another scroll animation.
    if (heading.current.getBoundingClientRect().top < 96) {
      (stage.current?.previousElementSibling ?? heading.current).scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [step, loaded]);

  function update(patch: Partial<InvestingProfile>) {
    setError("");
    setProfile(p => ({ ...p, ...patch, updatedAt: new Date().toISOString(), completedAt: null }));
  }
  function addInterest(interest: Interest) {
    if (profile.interests.length >= DEFAULT_PLAN.limits.preferenceItems) { setError(`You can add up to ${DEFAULT_PLAN.limits.preferenceItems} interests on the ${DEFAULT_PLAN.name} plan. Remove one to add another.`); return; }
    if (interest.kind !== "custom" && followedAssets(profile.interests) >= DEFAULT_PLAN.limits.follows) { setError(`You can follow up to ${DEFAULT_PLAN.limits.follows} stocks or coins on the ${DEFAULT_PLAN.name} plan. Remove one to add another, or add it as an idea instead.`); return; }
    if (profile.interests.some(i => i.id === interest.id || i.name.toLowerCase() === interest.name.toLowerCase())) { setQuery(""); return; }
    update({ interests: [...profile.interests, interest] });
    setQuery("");
  }
  const search = query.trim();
  const catalog = assetSuggestions(profile.themes, profile.thesis, search);
  const results = catalog.filter(asset => !profile.interests.some(i => i.id === asset.id)).slice(0, search ? 8 : 5);
  const exact = catalog.find(asset => asset.symbol?.toLowerCase() === search.toLowerCase() || asset.name.toLowerCase() === search.toLowerCase());
  function addQuery() {
    if (search) addInterest(exact ?? { id: `custom:${search.toLowerCase()}`, name: search, kind: "custom" });
  }
  function next(event: FormEvent) {
    event.preventDefault();
    if (step === 1 && !profile.thesis.trim()) { setError("Add a few words about your investing thesis to continue."); return; }
    if (step === 4 && profile.permission === "automatic") {
      const message = limitsError(profile.limits);
      if (message) { setError(message); return; }
    }
    if (step === 4 && !profile.permissionConfigured) {
      setError("Choose how your agent should act to continue.");
      return;
    }
    goTo(Math.min(step + 1, 5) as InvestingProfile["step"]);
  }
  function startExploring() {
    const completed = { ...profile, completedAt: new Date().toISOString() };
    try { localStorage.setItem(profileKey(userId), JSON.stringify(completed)); }
    catch { setStorageError("Your profile could not be saved. Enable browser storage, then try again."); return; }
    if (onComplete) { void onComplete(completed); return; }
    router.push("/");
  }

  if (!loaded) return <LoadingState label="Loading your profile…" />;
  const titles = ["Build your investing profile.", "What shapes your world?", "What are you paying attention to?", "How should your agent act?", "Your world. Your trading agent."];
  const themeNames = THEMES.filter(t => profile.themes.includes(t.id)).map(t => t.name);
  const descriptions = [
    "Start with what you believe. Your agent will use this to understand what kinds of opportunities actually matter to you.",
    "Choose a starting point. Combine the themes that make you, you.",
    themeNames.length ? `Start with what you follow in ${themeNames.slice(0, 3).join(", ")}, or add something entirely different.` : "Stocks, crypto, companies, or a bigger idea. Start with a few.",
    "You decide how much it can do.",
    "A personalized profile, built around what matters to you.",
  ];
  const permissionIcons = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal };

  return (
    <div className={`socialtrading-layout${step === 5 ? " is-final" : ""}`}>
      <div className="socialtrading-question">
        <p className="socialtrading-progress mono" aria-label={`Step ${step} of 5`}>{step} <span>/ 5</span></p>
        <div ref={stage} className="socialtrading-stage">
          <header data-step-part>
            <h1 ref={heading} tabIndex={-1} className="landing-hero-title outline-none">{titles[step - 1]}</h1>
            <p className="landing-hero-lead socialtrading-lead">{descriptions[step - 1]}</p>
          </header>
          {step < 5 ? (
            <form onSubmit={next} noValidate>
              <div className="socialtrading-fields" data-step-part>
                {step === 1 && (
                  <label>
                    <span className="sr-only">Your thesis</span>
                    <textarea className="socialtrading-input socialtrading-thesis" value={profile.thesis} maxLength={DEFAULT_PLAN.limits.thesisChars}
                      onChange={e => update({ thesis: e.target.value })}
                      placeholder="I think AI inference will create massive demand for data centers, power infrastructure, networking and semiconductors over the next 3–5 years."
                      aria-invalid={!!error} aria-describedby={error ? "profile-error" : undefined} />
                  </label>
                )}
                {step === 2 && (
                  <>
                    <ThemeCards selected={profile.themes} thesis={profile.thesis} onChange={themes => update({ themes })} />
                    <p className="socialtrading-caption">{profile.themes.length ? `${profile.themes.length} ${profile.themes.length === 1 ? "theme" : "themes"} shaping your profile` : suggestedThemes(profile.thesis).length ? "A small dot marks themes connected to your thesis. The choice is yours." : "Choose any combination, or keep an open mind for now."}</p>
                  </>
                )}
                {step === 3 && (
                  <>
                    <div>
                      <label htmlFor="interest-search" className="sr-only">Search or add an interest</label>
                      <div className="socialtrading-search">
                        <input id="interest-search" className="socialtrading-input" value={query} maxLength={100}
                          onChange={e => setQuery(e.target.value)} placeholder="Search anything you care about"
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addQuery(); } }} />
                        <button type="button" className="button button-secondary" disabled={!search} onClick={addQuery}><Plus size={14} aria-hidden="true" />Add</button>
                      </div>
                    </div>
                    <div>
                      <p className="socialtrading-caption">{search ? "Matching interests" : profile.themes.length ? "A few starting points for your profile" : "A few starting points"}</p>
                      <div className="socialtrading-chips" aria-label="Suggested interests">
                      {results.map(asset => <button type="button" className="button button-secondary socialtrading-chip" key={asset.id} onClick={() => addInterest(asset)}>
                        <Plus size={12} aria-hidden="true" />{asset.symbol || asset.name}{asset.symbol && <span>{asset.name}</span>}
                      </button>)}
                      {search && !exact && <button type="button" className="button button-secondary socialtrading-chip" onClick={addQuery}>Add “{search}”</button>}
                    </div>
                    </div>
                    <div ref={interests}>
                      <p className="socialtrading-caption" role="status">{profile.interests.length ? `Watching · ${profile.interests.length}` : "Nothing yet. You can always add more later."}</p>
                      <div className="socialtrading-chips">
                        {profile.interests.map(asset => <button type="button" key={asset.id} data-interest={asset.id}
                          className="button button-secondary socialtrading-chip socialtrading-chip-selected" aria-label={`Remove ${asset.name}`}
                          onClick={() => update({ interests: profile.interests.filter(i => i.id !== asset.id) })}>
                          {asset.symbol || asset.name}<X size={12} className="shrink-0" aria-hidden="true" />
                        </button>)}
                      </div>
                    </div>
                  </>
                )}
                {step === 4 && (
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
                <button type="submit" className="button button-primary">{step === 4 ? "Create my profile" : "Continue"}<ArrowRight size={14} aria-hidden="true" /></button>
                {step > 1 && <button type="button" className="button button-secondary" onClick={() => goTo((step - 1) as InvestingProfile["step"])}><ArrowLeft size={14} aria-hidden="true" />Back</button>}
              </div>
            </form>
          ) : (
            <div className="socialtrading-final" data-step-part>
              <p className="socialtrading-final-note">Your thesis sets the direction.<br />Your interests make it personal.<br />Your rules keep you in control.</p>
              <div className="socialtrading-actions">
                <button type="button" className="button button-primary" onClick={startExploring} disabled={completing}>{completing ? "Meeting your agent…" : "Meet your agent"}<ArrowRight size={14} aria-hidden="true" /></button>
                <button type="button" className="button button-secondary" onClick={() => goTo(1)} disabled={completing}>Edit profile</button>
              </div>
              {serverError && <p className="mt-4 text-sm" role="alert">{serverError}</p>}
              <p className="socialtrading-caption socialtrading-explore-note">Your agent picks up right where this leaves off.</p>
            </div>
          )}
          {storageError && <p className="mt-4 text-sm" role="alert">{storageError}</p>}
        </div>
      </div>
      <ProfileCard profile={profile} name={name} />
    </div>
  );
}
