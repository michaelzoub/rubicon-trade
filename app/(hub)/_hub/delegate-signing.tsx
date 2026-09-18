"use client";

import { usePrivy, useSigners } from "@privy-io/react-auth";
import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { shortAddress } from "@/lib/crypto/chains";
import type { InvestingProfile, Permission } from "@/lib/socialtrading/profile";
import { purchaseError } from "@/lib/crypto/readiness";
import { useHub } from "./hub-provider";

/** Handing the agent the ability to buy while you are asleep.
 *
 * Two separate consents, deliberately not one switch:
 *
 *  1. A *signer* on the wallet, granted through Privy. This is the one that
 *     actually matters — without it nothing can be signed, and removing it is
 *     an immediate, total revocation that does not depend on this app at all.
 *  2. The *setting*, which says the agent may use that signer. Turning it off
 *     stops unattended buying while leaving the signer in place.
 *
 * Both are off until the person acts, and the copy says plainly what changes,
 * because "let the agent trade for me" is the most consequential thing anyone
 * will click in this product.
 *
 * `draft` is what the surrounding form has selected but not yet saved. The
 * checkbox still follows the *saved* profile, because that is what the server
 * enforces — but the copy has to follow the draft, or it ends up telling you to
 * do the very thing you just did. */
export function DelegateSigning({ draft }: { draft?: { permission: Permission; limits: InvestingProfile["limits"] } } = {}) {
  const { state, mutate } = useHub();
  const { user } = usePrivy();
  const { addSigners, removeSigners } = useSigners();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
  /** A Privy policy the signer's requests must satisfy. Worth setting: Privy
   * enforces it, so it still holds if this codebase has a bug. Privy allows one
   * override policy per signer today. */
  const policyId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_POLICY_ID;
  /** Read from Privy rather than remembered locally: a grant outlives this page,
   * and a signer revoked from elsewhere has to show as revoked here. */
  const embedded = (user?.linkedAccounts ?? []).flatMap(a =>
    a.type === "wallet" && /^privy(-v2)?$/.test(a.walletClientType ?? "")
      ? [{ address: a.address.toLowerCase(), delegated: (a as { delegated?: boolean }).delegated === true }]
      : []);
  const granted = embedded.find(w => w.delegated)?.address ?? null;
  const on = state.profile.autoExecute === true;
  const limits = state.profile.limits;
  const configured = !!limits?.perTrade && !!limits?.daily;
  const actMode = state.profile.permission === "automatic";
  /** The unsaved form already satisfies what unattended buying needs, so the only
   * thing left is to save it — say that, instead of asking for it again. */
  const drafted = !!draft && draft.permission === "automatic" && !!draft.limits.perTrade && !!draft.limits.daily;

  async function grant(address: string) {
    if (!signerId) return;
    setBusy(address); setError("");
    try {
      await addSigners({ address, signers: [{ signerId, ...(policyId ? { policyIds: [policyId] } : {}) }] });
    } catch (e) { setError(purchaseError(e)); }
    finally { setBusy(""); }
  }
  async function revoke(address: string) {
    setBusy(address); setError("");
    try {
      await removeSigners({ address });
      // Revoking the signer also retires the setting: leaving it on would
      // promise something that can no longer happen.
      if (on) await mutate({ action: "agent", autoExecute: false });
    } catch (e) { setError(purchaseError(e)); }
    finally { setBusy(""); }
  }

  if (!signerId) return <p className="hub-notice">This deployment has no signer configured, so your agent cannot buy unattended. Set <span className="mono">NEXT_PUBLIC_PRIVY_SIGNER_ID</span> and <span className="mono">PRIVY_AUTHORIZATION_KEY</span>, then restart the app — these are read at build time, so a running server will not pick them up.</p>;
  if (!embedded.length) return <p className="hub-notice">Your agent can only buy from a Rubicon wallet — an outside wallet like MetaMask cannot delegate signing. Create one under <strong>Plan &amp; wallets</strong>, then come back.</p>;

  return <div className="hub-delegate">
    <p className="socialtrading-caption">
      Your agent can research and propose at any hour, but it can only buy while you are present — unless you grant it a signer.
      A signer lets Rubicon sign purchases from one wallet on your behalf, inside Privy’s enclave. It never sees your keys, it only
      ever buys on Base under the limits below, and you can take it back at any time.
    </p>

    <ul className="hub-delegate-wallets">
      {embedded.map(w => {
        const address = w.address, isGranted = w.delegated;
        return <li key={address}>
          <span className="mono">{shortAddress(address)}</span>
          {isGranted
            ? <><span className="hub-delegate-ok"><Check size={13} aria-hidden="true" />Signer granted</span>
                <button type="button" className="hub-chip-button" disabled={busy === address} onClick={() => void revoke(address)}>{busy === address ? "Removing…" : "Revoke"}</button></>
            : <button type="button" className="hub-chip-button" disabled={busy === address} onClick={() => void grant(address)}>{busy === address ? "Check your wallet…" : "Grant signing access"}</button>}
        </li>;
      })}
    </ul>

    {/* The setting is only offered once the prerequisites are real, so nobody
      * switches it on and then discovers it does nothing. */}
    <label className="hub-delegate-toggle">
      <input
        type="checkbox"
        checked={on}
        disabled={!granted || !actMode || !configured || busy !== ""}
        onChange={async e => {
          setError("");
          try { await mutate({ action: "agent", autoExecute: e.target.checked }); }
          catch (err) { setError(purchaseError(err)); }
        }}
      />
      <span>
        <strong>Let my agent buy without me</strong>
        <small>Real purchases, made while you are away, capped at {limits?.perTrade ? `$${limits.perTrade}` : "your per-trade limit"} each and {limits?.daily ? `$${limits.daily}` : "your daily limit"} a day.</small>
      </span>
    </label>

    {(!actMode || !configured) && (drafted
      ? <p className="hub-notice">Your choices above aren’t saved yet. Save this page and your agent can buy unattended{granted ? " — the signer is already in place" : ", once you grant a signer above"}.</p>
      : <p className="hub-notice">Choose <strong>Buy for me</strong> above and set a per-trade and daily limit, then save this page.</p>)}
    {actMode && configured && !granted && <p className="socialtrading-caption">Grant a signer above to enable this.</p>}
    {on && <p className="hub-delegate-live"><ShieldCheck size={13} aria-hidden="true" />Your agent may buy on Base while you are away. Every purchase appears in your activity.</p>}
    {error && <p className="hub-error" role="alert">{error}</p>}
  </div>;
}

/**
 * Remote access as one switch.
 *
 * The two consents are still two — a signer inside Privy's enclave, and the
 * setting that says the agent may use it — but asking for them separately made
 * a five-step ritual out of one decision, and people got stranded halfway. So
 * the switch performs the whole decision: save what is in the form (the server
 * will not accept unattended buying without a mode and real limits), grant the
 * signer if there is not one, then turn the setting on. Turning it off is the
 * reverse of the last step only, instantly.
 *
 * Revoking stays its own, quieter action, because taking the signer away is
 * absolute: it does not depend on this app, and nothing here can undo it.
 */
export function RemoteAccess({ prepare }: {
  /** Persists whatever the surrounding form is holding. The switch waits for it,
   * because the server checks the *saved* mode and limits, not the draft. */
  prepare?: () => Promise<boolean>;
}) {
  const { state, mutate } = useHub();
  const { user } = usePrivy();
  const { addSigners, removeSigners } = useSigners();
  const [busy, setBusy] = useState<"" | "on" | "off" | "revoke">("");
  const [error, setError] = useState("");

  const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
  const policyId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_POLICY_ID;
  const embedded = (user?.linkedAccounts ?? []).flatMap(a =>
    a.type === "wallet" && /^privy(-v2)?$/.test(a.walletClientType ?? "")
      ? [{ address: a.address.toLowerCase(), delegated: (a as { delegated?: boolean }).delegated === true }]
      : []);
  const wallet = embedded.find(w => w.delegated) ?? embedded[0];
  const granted = embedded.some(w => w.delegated);
  const on = state.profile.autoExecute === true;

  async function toggle(next: boolean) {
    setError(""); setBusy(next ? "on" : "off");
    try {
      if (!next) { await mutate({ action: "agent", autoExecute: false }); return; }
      if (prepare && !(await prepare())) return;
      if (!granted && wallet) await addSigners({ address: wallet.address, signers: [{ signerId: signerId!, ...(policyId ? { policyIds: [policyId] } : {}) }] });
      await mutate({ action: "agent", autoExecute: true });
    } catch (e) { setError(purchaseError(e)); }
    finally { setBusy(""); }
  }

  async function revoke() {
    if (!wallet) return;
    setError(""); setBusy("revoke");
    try {
      await removeSigners({ address: wallet.address });
      // A signer that is gone cannot be used, so the setting goes with it.
      if (on) await mutate({ action: "agent", autoExecute: false });
    } catch (e) { setError(purchaseError(e)); }
    finally { setBusy(""); }
  }

  if (!signerId) return <p className="hub-notice">No signer is configured for this deployment, so unattended buying is unavailable.</p>;
  if (!embedded.length) return <p className="hub-notice">Needs a Rubicon wallet — an outside wallet like MetaMask can’t delegate signing.</p>;

  const working = busy === "on" || busy === "off";
  return <div className="hub-remote">
    <label className="hub-switch">
      <input type="checkbox" role="switch" checked={on} disabled={busy !== ""} onChange={e => void toggle(e.target.checked)} />
      <span className="hub-switch-track" aria-hidden="true"><i /></span>
      <span className="hub-switch-copy">
        <strong>{working ? (busy === "on" ? "Granting access…" : "Turning off…") : "Let it buy while you’re away"}</strong>
        <small>{on
          ? `It may buy on Base under your limits. Every purchase shows in your activity.`
          : `You’ll sign once, in your wallet. Rubicon never sees your keys.`}</small>
      </span>
    </label>
    {granted && wallet && <div className="hub-remote-signer">
      <span className="mono">{shortAddress(wallet.address)}</span>
      <span className="hub-remote-ok"><Check size={12} aria-hidden="true" />Signed</span>
      <button type="button" disabled={busy !== ""} onClick={() => void revoke()}>{busy === "revoke" ? "Revoking…" : "Revoke"}</button>
    </div>}
    {error && <p className="hub-error" role="alert">{error}</p>}
  </div>;
}
