export const usd = (value: number | null | undefined, digits?: number) => value === null || value === undefined || !Number.isFinite(value) ? "—"
  : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits ?? (Math.abs(value) < 1 ? 4 : 2), maximumFractionDigits: digits ?? (Math.abs(value) < 1 ? 4 : 2) }).format(value);
export const pct = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
export const compact = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}
export const clock = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
export const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(iso));
