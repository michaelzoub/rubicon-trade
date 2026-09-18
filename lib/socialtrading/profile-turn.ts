import { getNextProfileProbe, type Probe, type ProbeContext } from "./profile-probe";
import type { Belief, ProfileModel } from "./profile-model";

/** How a turn advances, kept out of the route so it can be tested without a
 * `Request`. The inference call is injected for the same reason. */
export type Infer = (model: ProfileModel) => Promise<Belief[] | null>;

/**
 * Read the evidence, then decide. A reading that never arrived leaves the
 * beliefs exactly as they were and marks the model `pending`: what we last
 * heard stays on record, but the view must not call it the model's word.
 */
export async function advanceProfile(model: ProfileModel, ctx: ProbeContext, infer: Infer): Promise<{ model: ProfileModel; probe: Probe | null }> {
  const beliefs = await infer(model);
  const next: ProfileModel = beliefs
    ? { ...model, beliefs, source: "jev" }
    : { ...model, source: "pending" };
  return { model: next, probe: getNextProfileProbe(next, ctx) };
}
