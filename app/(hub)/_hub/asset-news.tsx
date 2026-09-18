"use client";

import { ArrowUpRight, Newspaper } from "lucide-react";
import type { Asset } from "@/lib/socialtrading/types";
import { timeAgo } from "./format";

/** Notification cards layer as they reach the top of the scrollable feed. */
export function AssetNews({ items }: { items: Asset["news"] }) {
  if (!items.length) return null;
  return <div className="hub-news-deck">
    <div className="hub-news-deck-head"><h2>Recent news</h2><span><i aria-hidden="true" />Latest updates</span></div>
    <div className="hub-news-stack" role="region" aria-label="Recent news headlines" tabIndex={0}>
      <ul className="hub-news-feed">
      {items.map((item, index) => <li key={`${index}:${item.url}`} className="hub-news-feed-item"><a className="hub-news-layer" href={item.url} target="_blank" rel="noopener noreferrer">
        <span className="hub-news-icon"><Newspaper size={20} aria-hidden="true" /></span>
        <span className="hub-news-layer-copy"><span className="hub-news-meta"><span>{item.source || "Market news"}</span><time dateTime={item.publishedAt}>{timeAgo(item.publishedAt)}</time></span><strong>{item.title}</strong></span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </a></li>)}
      </ul>
    </div>
  </div>;
}
