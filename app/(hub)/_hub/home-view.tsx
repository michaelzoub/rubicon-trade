"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { ThesisView } from "./worldview";
import { Conversation } from "./conversation";
import { useHub } from "./hub-provider";
import { AssetGrid } from "./parts";

/** Home is the conversation, and nothing else. A short strip of personalized
 * opportunities sits below it only until the conversation has started;
 * afterwards the agent brings opportunities into the thread itself. Orders
 * live on Activity, so the page the person talks to stays quiet. */
export function HomeView() {
  const { market, messages, state } = useHub();
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const quiet = messages.length === 0;
  useEffect(() => {
    if (!quiet) return;
    let cancelled = false;
    market({ kind: state.profile.themes.includes("crypto") && !state.profile.interests.some(i => i.kind === "stock") ? "crypto" : "stock" })
      .then(list => { if (!cancelled) setAssets(list.slice(0, 3)); })
      .catch(() => { if (!cancelled) setAssets([]); });
    return () => { cancelled = true; };
  }, [market, quiet, state.profile.themes, state.profile.interests]);
  return (
    <div className="hub-home">
      <ThesisView compact />
      <Conversation />
      {quiet && assets && assets.length > 0 && <div className="hub-home-opportunities"><AssetGrid title="A few things in your world right now" assets={assets} dense /></div>}
    </div>
  );
}
