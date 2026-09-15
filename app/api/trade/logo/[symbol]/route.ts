/** Proxy provider branding without exposing the market-data credential to the browser. */
export async function GET(_request: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const key = process.env.MASSIVE_API_KEY;
  if (!key || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return new Response(null, { status: 404 });
  try {
    const options = { headers: { Authorization: `Bearer ${key}` }, next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) };
    const reference = await fetch(`https://api.massive.com/v3/reference/tickers/${symbol}`, options);
    if (!reference.ok) return new Response(null, { status: 404 });
    const data = await reference.json();
    const path = data.results?.branding?.icon_url ?? data.results?.branding?.logo_url;
    if (!path) return new Response(null, { status: 404 });
    const url = new URL(path);
    if (url.origin !== "https://api.massive.com" || !url.pathname.startsWith("/v1/reference/company-branding/")) return new Response(null, { status: 404 });
    const result = await fetch(url, { ...options, redirect: "error" });
    const type = result.headers.get("content-type") ?? "";
    if (!result.ok || !/^image\/(png|jpeg|webp|svg\+xml)(;|$)/.test(type)) return new Response(null, { status: 404 });
    return new Response(await result.arrayBuffer(), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "Content-Security-Policy": "default-src 'none'; sandbox", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 404 }); }
}
