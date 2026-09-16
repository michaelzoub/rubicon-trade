"use client";

import { MemoryView } from "./memory-view";
import type { TradeIntent } from "@/lib/socialtrading/types";

/** A trade that cannot move until the person acts. The agent carries these
 * now, so this page draws no banner for them. */
export const needsYou = (trade?: TradeIntent) => !!trade && (trade.status === "approval_required" || (!!trade.crypto && trade.status === "reserved" && trade.crypto.phase === "ready"));

/** Memory is the whole page: one field of beliefs, scrubbed through time. The
 * complete record lives inside it, under a disclosure, for when the exact
 * sequence matters. */
export function ActivityView() {
  return <MemoryView />;
}
