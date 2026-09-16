import { topicRecommendations } from "@/lib/socialtrading/suggestions";

/** Public, read-only catalog lookup; no account data or paid provider calls. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get("name")?.trim() ?? "";
  const id = params.get("id") ?? "";
  if (!name || name.length > 100 || id.length > 150) {
    return Response.json({ error: "Provide an interest of up to 100 characters." }, { status: 400 });
  }
  return Response.json({ recommendations: topicRecommendations({ id, name }), source: "catalog" }, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
