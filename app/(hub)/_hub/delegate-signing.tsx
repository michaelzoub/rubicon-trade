"use client";

import { usePrivy, useSigners } from "@privy-io/react-auth";
import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { shortAddress } from "@/lib/crypto/chains";
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
 * will click in this product. */
export function DelegateSigning() {
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

    {!actMode && <p className="hub-notice">Set your agent to <strong>Act within my limits</strong> above first.</p>}
    {actMode && !configured && <p className="hub-notice">Set a per-trade and daily limit above first.</p>}
    {actMode && configured && !granted && <p className="socialtrading-caption">Grant a signer above to enable this.</p>}
    {on && <p className="hub-delegate-live"><ShieldCheck size={13} aria-hidden="true" />Your agent may buy on Base while you are away. Every purchase appears in your activity.</p>}
    {error && <p className="hub-error" role="alert">{error}</p>}
  </div>;
}
