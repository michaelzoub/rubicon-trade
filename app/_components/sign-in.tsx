"use client";

import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { gsap, useGSAP, rubiconMotion } from "./motion";
import "./sign-in.css";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The signed-out front door: a painting on the left, the way in on the right.
 * Email sign-in runs headlessly so the form stays ours; X and wallets open
 * Privy's own flow for that one method. */
export function SignInScene() {
  const { login } = usePrivy();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const root = useRef<HTMLDivElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const awaitingCode = step === "code";
  const busy = state.status === "sending-code" || state.status === "submitting-code";

  useEffect(() => { if (state.status === "awaiting-code-input") setStep("code"); }, [state.status]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const tl = gsap.timeline({ defaults: { ease: rubiconMotion.ease.enter } });
      tl.fromTo(".signin-card", { opacity: 0, y: 18, scale: .985 }, { opacity: 1, y: 0, scale: 1, duration: .8, clearProps: "transform" })
        .fromTo(".signin-art img", { scale: 1.08 }, { scale: 1, duration: 1.6, ease: "power2.out" }, 0)
        .fromTo("[data-signin-part]", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .55, stagger: .06, clearProps: "all" }, .25);
    });
    return () => media.revert();
  }, { scope: root });

  useEffect(() => { if (awaitingCode) codeInput.current?.focus(); }, [awaitingCode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      if (!awaitingCode) {
        if (!EMAIL.test(email.trim())) { setMessage("Enter the email you want to sign in with."); return; }
        await sendCode({ email: email.trim() });
      } else {
        if (code.trim().length < 6) { setMessage("Enter the 6-digit code from your email."); return; }
        await loginWithCode({ code: code.trim() });
      }
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : "That didn't go through. Try again.");
    }
  }

  return (
    <div ref={root} className="signin-scene">
      <div className="signin-card">
        <section className="signin-art" aria-label="Rubicon">
          <img src="/sign-in-art.jpg" alt="" decoding="async" />
          <div className="signin-art-copy">
            <p className="signin-art-eyebrow" data-signin-part><img src="/w_logo.svg" alt="" aria-hidden="true" /><span>Rubicon</span></p>
            <h1 data-signin-part>Start with what you believe.</h1>
            <p className="signin-art-note" data-signin-part>A thesis, a few interests, and an agent that follows your lead. It learns from how you explore, and only trades within rules you set.</p>
          </div>
        </section>

        <section className="signin-panel" aria-labelledby="signin-title">
          <div className="signin-panel-body">
            <img className="signin-mark" src="/w_logo.svg" alt="" aria-hidden="true" data-signin-part />
            <h2 id="signin-title" data-signin-part>{awaitingCode ? "Check your email" : "Sign in"}</h2>
            <p className="signin-sub" data-signin-part>
              {awaitingCode
                ? <>We sent a code to <strong>{email.trim()}</strong>. <button type="button" className="signin-text-link" onClick={() => { setCode(""); setMessage(""); setStep("email"); }}>Use another email</button></>
                : <>or <button type="button" className="signin-text-link" onClick={() => login()}>create an account</button></>}
            </p>

            <form className="signin-form" onSubmit={submit} data-signin-part noValidate>
              {!awaitingCode ? (
                <label className="signin-field">
                  <span className="sr-only">Email</span>
                  <input type="email" name="email" autoComplete="email" inputMode="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} disabled={busy} required />
                </label>
              ) : (
                <label className="signin-field">
                  <span className="sr-only">6-digit code</span>
                  <input ref={codeInput} type="text" name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="6-digit code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} disabled={busy} required />
                </label>
              )}
              <button type="submit" className="signin-submit" disabled={busy}>
                {busy ? "One moment…" : awaitingCode ? "Enter" : "Continue"}
              </button>
              {message && <p className="signin-message" role="alert">{message}</p>}
            </form>

            <div className="signin-alt" data-signin-part>
              <button type="button" className="signin-text-link" onClick={() => login({ loginMethods: ["twitter"] })}>Continue with X <ArrowRight size={11} aria-hidden="true" /></button>
              <button type="button" className="signin-text-link" onClick={() => login({ loginMethods: ["wallet"] })}>Connect a wallet <ArrowRight size={11} aria-hidden="true" /></button>
            </div>
          </div>
          <footer className="signin-foot" data-signin-part>
            <span>Private by default</span>
            <span>Your rules, enforced server-side</span>
          </footer>
        </section>
      </div>
    </div>
  );
}
