import { authenticate, bodyOf, failure, HubError } from "@/lib/socialtrading/server";
import { newOnboarding, readOnboarding } from "@/lib/socialtrading/onboarding";
import { newProfileModel, readProfileModel } from "@/lib/socialtrading/profile-model";
import { inferBeliefs } from "@/lib/socialtrading/profile-inference";
import { advanceProfile } from "@/lib/socialtrading/profile-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bounded = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Local preview drives the arm without a session. Gated on a non-production
 * build AND an explicit header, exactly as the sibling onboarding route is, so
 * it cannot be reached on a deployed build even if the header is sent. */
function previewing(request: Request) {
  return process.env.NODE_ENV !== "production" && request.headers.get("x-onboarding-preview") === "1";
}

/**
 * One turn of adaptive onboarding. Stateless: the whole model arrives on the
 * request and the whole model goes back, so the client never has to know that
 * a model was consulted at all.
 */
export async function POST(request: Request) {
  try {
    if (!previewing(request)) await authenticate(request);
    const body = await bodyOf(request);
    if (!process.env.OPENROUTER_API_KEY) throw new HubError(503, "The onboarding model is not configured on this deployment.");

    const model = readProfileModel(body.model) ?? newProfileModel();
    const ctx = {
      knowledge: bounded(body.knowledge, 0, 4) ?? 0,
      confidence: bounded(body.confidence, 0, 3) ?? 0,
      answers: readOnboarding(body.answers) ?? newOnboarding(),
    };

    const { model: next, probe } = await advanceProfile(model, ctx, m =>
      inferBeliefs(m.evidence, { confidence: ctx.confidence, knowledge: ctx.knowledge }, request.signal));

    return Response.json(probe ? { model: next, probe } : { model: next, done: true });
  } catch (e) { return failure(e); }
}
