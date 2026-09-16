"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { Conversation } from "./conversation";
import { useHub } from "./hub-provider";
import { AssetGrid } from "./parts";

/** Home is the conversation, and nothing else. The thesis is still here — it
 * lives in what each message and each object reveals when the person reaches
 * for it, rather than in a section that sits open whether it is wanted or not.
 * A short strip of openings waits below only until the conversation starts. */
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
      <Conversation />
      {quiet && assets && assets.length > 0 && <div className="hub-home-opportunities" data-agent-region="openings"><AssetGrid assets={assets} dense /></div>}
    </div>
  );
}
