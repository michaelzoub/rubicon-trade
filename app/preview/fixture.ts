import type { InvestingProfile } from "@/lib/socialtrading/profile";
import type { HubState, Message } from "@/lib/socialtrading/types";

// Fixed clock so server and client render identical markup.
const NOW = Date.parse("2026-09-14T22:45:00.000Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const series = (start: number, drift: number, n = 40) => Array.from({ length: n }, (_, i) => ({ time: NOW - (n - i) * 86400_000, price: start * (1 + drift * i / n + Math.sin(i / 3) * .015) }));

export const PREVIEW_USER = "preview-user";
const profile: InvestingProfile = {
  version: 3, userId: PREVIEW_USER,
  investorAnswers: { knowledge: 4, guidedTest: false, opportunityDrivers: ["Breakthrough innovation"], esgPriority: null, aiPriority: null, technologies: [], conflictCountries: [], geopoliticalThesis: "", futureVision: "AI infrastructure and energy" },
  thesis: "AI inference will create massive demand for data centers, power infrastructure, networking and semiconductors over the next 3–5 years. Power availability is the bottleneck.",
  themes: ["ai", "energy"],
  interests: [
    { id: "NVDA", symbol: "NVDA", name: "Nvidia", kind: "stock" },
    { id: "VRT", symbol: "VRT", name: "Vertiv", kind: "stock" },
    { id: "CRWV", symbol: "CRWV", name: "CoreWeave", kind: "stock" },
    { id: "theme:power-grid", name: "Power infrastructure", kind: "custom" },
  ],
  permission: "approve", permissionConfigured: true,
  limits: { perTrade: "100", daily: "250", weekly: "1000" },
  learning: { signals: [], inferredInterests: [] },
  step: 6, completedAt: ago(60 * 24 * 9), updatedAt: ago(5),
};

const VRT = { id: "VRT", symbol: "VRT", name: "Vertiv Holdings", kind: "stock" as const, price: 128.42, change: 3.18, asOf: ago(4), source: "Massive" as const, marketCap: 4.9e10, volume: 4.1e6, themes: ["ai", "energy"], chart: series(112, .14), news: [
  { title: "Vertiv raises full-year outlook on data center cooling demand", url: "https://example.com/vrt-1", publishedAt: ago(200), source: "Reuters" },
  { title: "Hyperscalers lock in liquid cooling capacity through 2027", url: "https://example.com/vrt-2", publishedAt: ago(900), source: "Bloomberg" },
], reason: "You follow VRT. Related to your Energy thesis. You’ve been spending time on Energy", label: "Strong match for your Energy thesis", labelTone: "match" as const };
const CEG = { id: "CEG", symbol: "CEG", name: "Constellation Energy", kind: "stock" as const, price: 312.07, change: -0.84, asOf: ago(4), source: "Massive" as const, marketCap: 9.8e10, volume: 2.2e6, themes: ["energy"], chart: series(290, .08), news: [], reason: "Related to your Energy thesis. Your thesis mentions power, infrastructure", label: "Strong match for your Energy thesis", labelTone: "match" as const };
const OKLO = { id: "OKLO", symbol: "OKLO", name: "Oklo Inc.", kind: "stock" as const, price: 54.9, change: 6.42, asOf: ago(4), source: "Massive" as const, marketCap: 7.6e9, volume: 9.8e6, themes: ["energy"], chart: series(38, .42), news: [], reason: "You’ve been spending time on Energy. You told me you care about nuclear", label: "Close to what you’ve been exploring", labelTone: "related" as const };
const SMR = { id: "SMR", symbol: "SMR", name: "NuScale Power", kind: "stock" as const, price: 41.13, change: 2.05, asOf: ago(4), source: "Massive" as const, marketCap: 5.9e9, volume: 7.1e6, themes: ["energy"], chart: series(33, .25), news: [], reason: "You told me you care about nuclear", label: "Related to Energy", labelTone: "related" as const };
const DOGE = { id: "dogecoin", symbol: "DOGE", name: "Dogecoin", kind: "crypto" as const, price: .1621, change: -4.2, asOf: ago(1), source: "CoinGecko" as const, marketCap: 2.4e10, volume: 1.1e9, themes: ["crypto", "Meme"], chart: series(.17, -.06), news: [], reason: "You asked to see less memecoins", label: "You asked to see less memecoins", labelTone: "muted" as const };

const messages: Message[] = [
  { id: "m1", role: "user", at: ago(48), parts: [{ type: "text", text: "what happened with VRT today?" }] },
  { id: "m2", role: "assistant", at: ago(47), status: "done", parts: [
    { type: "text", text: "Vertiv is up about 3% today after raising its full-year outlook. The driver is exactly the part of your thesis you keep coming back to: cooling and power distribution for inference data centers are selling faster than they can be built." },
    { type: "asset", asset: VRT },
    { type: "news", title: "What moved it", items: VRT.news },
  ] },
  { id: "m3", role: "user", at: ago(31), parts: [{ type: "text", text: "I’m becoming more interested in nuclear" }] },
  { id: "m4", role: "assistant", at: ago(30), status: "done", parts: [
    { type: "text", text: "Noted. Nuclear now sits alongside power infrastructure in your profile, and I’ll weight it when I rank things for you. Two names fit right away:" },
    { type: "profile_update", changes: [{ field: "preferences", label: "Things you care about", after: "nuclear" }] },
    { type: "assets", title: "Nuclear, through your power-bottleneck lens", assets: [OKLO, SMR] },
  ] },
  { id: "m5", role: "user", at: ago(12), parts: [{ type: "text", text: "why did you surface OKLO?" }] },
  { id: "m6", role: "assistant", at: ago(11), status: "done", parts: [
    { type: "explanation", target: "OKLO", reasons: ["You’ve said power availability will be the bottleneck for AI inference", "You follow VRT and CRWV, both downstream of the same demand", "You just told me you’re becoming more interested in nuclear", "You’ve spent more time on Energy opportunities this week than any other theme"] },
    { type: "text", text: "It’s a fit, not a recommendation. Oklo is pre-revenue and moves fast, so size it like a bet, not a position." },
  ] },
  { id: "m7", role: "user", at: ago(3), parts: [{ type: "text", text: "buy $50 of OKLO" }] },
  { id: "m8", role: "assistant", at: ago(2), status: "done", parts: [
    { type: "text", text: "You asked me to check with you before acting, so here’s the order. Approve it and I’ll send it to Robinhood." },
    { type: "trade", tradeId: "t1" },
  ] },
  { id: "m9", role: "user", at: ago(1.5), parts: [{ type: "text", text: "and put $25 of USDC into ETH on Base from my wallet" }] },
  { id: "m10", role: "assistant", at: ago(1), status: "done", parts: [
    { type: "text", text: "Here’s the swap, quoted on Uniswap. It settles from your own wallet, so review it and sign when you’re ready. The network fee comes out of your USDC." },
    { type: "trade", tradeId: "t2" },
  ] },
];
export const PREVIEW_WALLET = "0x1111111111111111111111111111111111111111";
export const PREVIEW_TOKENS: import("@/lib/crypto/search").TokenMatch[] = [
  { chainId: 8453, chain: "Base", address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", priceUsd: 4102.5, liquidityUsd: 182_000_000, volume24h: 910_000_000, change24h: 1.8, dex: "uniswap", url: "", quote: "USDC", kind: "crypto", thin: false },
  { chainId: 8453, chain: "Base", address: "0x8a8e5ca3b5d8d3b08a1b6b2fd2b9e7c3d0a1f2e3", symbol: "bNVDA", name: "Backed NVIDIA", priceUsd: 176.2, liquidityUsd: 2_400_000, volume24h: 1_200_000, change24h: -0.6, dex: "uniswap", url: "", quote: "USDC", kind: "stock", thin: false },
  { chainId: 1, chain: "Ethereum", address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", symbol: "PEPE", name: "Pepe", priceUsd: .0000098, liquidityUsd: 21_000_000, volume24h: 88_000_000, change24h: 6.4, dex: "uniswap", url: "", quote: "WETH", kind: "crypto", thin: false },
];

export const PREVIEW_CHAT = "default";
export const PREVIEW_STATE: HubState = {
  revision: 12, profile,
  dislikes: ["memecoins"], preferences: ["nuclear", "power grid"],
  inferred: [
    { id: "energy", weight: .62, confidence: .67, count: 10, updatedAt: ago(11) },
    { id: "OKLO", weight: .38, confidence: .5, count: 5, updatedAt: ago(11) },
    { id: "crypto", weight: -.28, confidence: .44, count: 4, updatedAt: ago(60 * 30) },
    { id: "CRWV", weight: .23, confidence: .44, count: 4, updatedAt: ago(60 * 8) },
  ],
  signals: [], chats: [{ id: PREVIEW_CHAT, title: "what happened with VRT today?", createdAt: ago(48), updatedAt: ago(1), messages }],
  events: [
    { id: "e1", at: ago(60 * 24 * 9), kind: "profile", text: "Your agent started with your investing worldview", detail: "AI × Energy. Watching NVDA and CRWV." },
    { id: "e2", at: ago(60 * 24 * 8), kind: "learning", text: "Started watching VRT", detail: "Interest in VRT is now 30% (confidence 17%). Inferred from your activity, not something you told me." },
    { id: "e3", at: ago(60 * 24 * 6), kind: "agent", text: "Suggested CRWV", detail: "Because you follow NVDA and your thesis names inference demand." },
    { id: "e4", at: ago(60 * 24 * 6 + 5), kind: "learning", text: "Dismissed CRWV", detail: "Interest in CRWV is now −20% (confidence 17%)." },
    { id: "e5", at: ago(60 * 24 * 3), kind: "learning", text: "Becoming more interested in Energy", detail: "You keep opening Energy opportunities. I now weight this theme more (52%)." },
    { id: "e6", at: ago(60 * 30), kind: "learning", text: "Passed on Dogecoin", detail: "Interest in crypto is now −28% (confidence 44%)." },
    { id: "e7", at: ago(30), kind: "profile", text: "Added nuclear to things you care about", detail: "You told your agent in conversation." },
    { id: "e8", at: ago(2), kind: "trade", text: "Proposed buying OKLO for $50.00", detail: "Waiting for your approval.", tradeId: "t1" },
    { id: "e9", at: ago(1), kind: "trade", text: "Proposed a Uniswap swap for $25.00 of WETH on Base", detail: "Waiting for you to review and sign in your wallet.", tradeId: "t2" },
  ],
  trades: [{
    id: "t1", asset: { id: "OKLO", symbol: "OKLO", name: "Oklo Inc.", kind: "stock" }, side: "buy", value: 50, estimatedPrice: 54.9, estimatedQuantity: .9107, resultingExposure: 50,
    createdAt: ago(2), status: "approval_required", reasoning: "Fits your power-bottleneck thesis and your new interest in nuclear. Small, speculative position.",
    policy: { allowed: false, reason: "Your approval is required.", at: ago(2) },
  }, {
    id: "t2", initiator: "agent", asset: { id: "8453:0x4200000000000000000000000000000000000006", symbol: "WETH", name: "WETH on Base", kind: "crypto" }, side: "buy", value: 25, estimatedPrice: null, estimatedQuantity: null, resultingExposure: null,
    createdAt: ago(1), status: "approval_required", reasoning: "You asked for ETH exposure from your own wallet. Small and reversible.",
    policy: { allowed: false, reason: "Your approval is required.", at: ago(1) },
    crypto: { request: { chainId: 8453, wallet: "0x1111111111111111111111111111111111111111", tokenIn: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", tokenOut: "0x4200000000000000000000000000000000000006", amount: "25000000", slippageBps: 50 }, outputAmount: "6100000000000000", minimumOutput: "6069500000000000", expiresAt: NOW + 60_000, phase: "ready", detail: "Waiting for you to review and sign in your wallet. The network fee comes out of your USDC.", display: { tokenIn: { symbol: "USDC", decimals: 6 }, tokenOut: { symbol: "WETH", decimals: 18 } } },
  }],
  brokerage: { provider: "robinhood", connected: false },
};

export const PREVIEW_ASSETS = { VRT, CEG, OKLO, SMR, DOGE };
export const PREVIEW_ACCOUNT: import("@/lib/socialtrading/plans").AccountSummary = {
  planId: "free", planName: "Free", limits: { follows: 5, preferenceItems: 5, learnedAssets: 25, thesisChars: 1000, chats: 20, agents: 3, enabledAgents: 2 },
  credits: { balanceMicros: 4_612_400, spentMicros: 387_600, requests: 31, holdMicros: 20_000 },
  usage: { agents: 2, enabledAgents: 2, chats: 2 },
};
