/** Owner: liskov-rs, application_placement_plan_v1. No policy evaluation. */
export interface PlacementPlanRule {
  by: string;
  strength: string;
  minimumDistinct: number | null;
  targetDistinct: number;
  plannedDistinct: number;
  preferredDegraded: boolean;
}
export interface ApplicationPlacementPlan {
  ok: true;
  schema: "application_placement_plan_v1";
  applicationId: string;
  occurrenceAuthorityDigest: string;
  generatedAtMs: number;
  semantics: "initial_feasibility_snapshot";
  plan: null | {
    seedOccurrenceAuthorityDigest: string;
    planDigest: string;
    policyDigest: string;
    memberCount: number;
    rules: PlacementPlanRule[];
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function isApplicationPlacementPlan(body: unknown): body is ApplicationPlacementPlan {
  if (!record(body) || body.ok !== true || body.schema !== "application_placement_plan_v1" ||
      body.semantics !== "initial_feasibility_snapshot" || !text(body.applicationId) ||
      !text(body.occurrenceAuthorityDigest) || !count(body.generatedAtMs)) return false;
  const plan = body.plan;
  if (plan === null) return true;
  return record(plan) && text(plan.seedOccurrenceAuthorityDigest) && text(plan.planDigest) &&
    text(plan.policyDigest) && count(plan.memberCount) && Array.isArray(plan.rules) &&
    plan.rules.every((rule: unknown) => record(rule) && text(rule.by) && text(rule.strength) &&
      (rule.minimumDistinct === null || count(rule.minimumDistinct)) &&
      count(rule.targetDistinct) && count(rule.plannedDistinct) && typeof rule.preferredDegraded === "boolean");
}

export function placementPlanPath(applicationId: string, occurrenceAuthorityDigest: string): string {
  return `/api/applications/${encodeURIComponent(applicationId)}/placement/plans/${encodeURIComponent(occurrenceAuthorityDigest)}`;
}

export function formatPlacementPlan(body: ApplicationPlacementPlan): string {
  const lines = [
    "Initial feasibility snapshot (immutable)",
    `Application: ${body.applicationId}`,
    `Occurrence: ${body.occurrenceAuthorityDigest}`
  ];
  if (body.plan === null) return [...lines, "This occurrence has no recorded spread plan."].join("\n");
  const plan = body.plan;
  return [...lines,
    `Seed occurrence: ${plan.seedOccurrenceAuthorityDigest}`,
    `Plan: ${plan.planDigest}`,
    `Policy: ${plan.policyDigest}`,
    `Members: ${plan.memberCount}`,
    ...plan.rules.map((rule) => `${rule.by} (${rule.strength}): target distinct ${rule.targetDistinct}, planned distinct ${rule.plannedDistinct}; authored minimum ${rule.minimumDistinct === null ? "not specified" : rule.minimumDistinct}; preferred degradation ${rule.preferredDegraded ? "recorded" : "none recorded"}`)
  ].join("\n");
}
