export const LAUNCH_ELIGIBILITY_SCHEMA = "proof.liskov.launch-eligibility.v1";

export const launchEligibilityCodes = [
  "eligible_now",
  "not_due",
  "one_shot_consumed",
  "recovery_not_authorized",
  "equivalent_proposal_exists",
  "administratively_ineligible",
  "blocked"
] as const;

export type LaunchEligibilityCode = typeof launchEligibilityCodes[number];

export interface LaunchEligibility {
  schema: typeof LAUNCH_ELIGIBILITY_SCHEMA;
  code: LaunchEligibilityCode;
  evidenceAuthority: string;
  userActionable: boolean;
  nextAction?: string;
  blockerCodes: string[];
}

export type LaunchEligibilityRead =
  | { known: true; eligible: boolean; value: LaunchEligibility }
  | { known: false; eligible: false; reason: "missing" | "invalid_contract" | "unknown_code"; rawCode?: string };

const codes = new Set<string>(launchEligibilityCodes);

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Strictly decode the closed, versioned server contract. Unknown or partial
 * values remain unavailable so new server states cannot become launchable by
 * an older CLI. */
export function readLaunchEligibility(value: unknown): LaunchEligibilityRead {
  if (value === undefined || value === null) return { known: false, eligible: false, reason: "missing" };
  const record = recordOf(value);
  if (!record) return { known: false, eligible: false, reason: "invalid_contract" };
  const rawCode = typeof record.code === "string" ? record.code : undefined;
  if (record.schema !== LAUNCH_ELIGIBILITY_SCHEMA
    || !nonEmptyString(record.evidenceAuthority)
    || typeof record.userActionable !== "boolean"
    || (record.nextAction !== undefined && !nonEmptyString(record.nextAction))
    || (record.blockerCodes !== undefined
      && (!Array.isArray(record.blockerCodes) || !record.blockerCodes.every(nonEmptyString)))) {
    return { known: false, eligible: false, reason: "invalid_contract", ...(rawCode ? { rawCode } : {}) };
  }
  if (!rawCode || !codes.has(rawCode)) {
    return { known: false, eligible: false, reason: "unknown_code", ...(rawCode ? { rawCode } : {}) };
  }
  const code = rawCode as LaunchEligibilityCode;
  const parsed: LaunchEligibility = {
    schema: LAUNCH_ELIGIBILITY_SCHEMA,
    code,
    evidenceAuthority: record.evidenceAuthority,
    userActionable: record.userActionable,
    ...(record.nextAction === undefined ? {} : { nextAction: record.nextAction as string }),
    blockerCodes: record.blockerCodes === undefined ? [] : [...record.blockerCodes as string[]]
  };
  return { known: true, eligible: code === "eligible_now", value: parsed };
}

export function launchEligibilityLabel(code: LaunchEligibilityCode): string {
  switch (code) {
    case "eligible_now": return "eligible now";
    case "not_due": return "not due";
    case "one_shot_consumed": return "generation already consumed";
    case "recovery_not_authorized": return "recovery not authorized";
    case "equivalent_proposal_exists": return "equivalent proposal exists";
    case "administratively_ineligible": return "administratively ineligible";
    case "blocked": return "blocked";
  }
}

export function formatLaunchEligibility(read: LaunchEligibilityRead): string {
  if (!read.known) {
    const raw = read.rawCode ? `; unsupported code ${read.rawCode}` : "";
    return `unavailable (${read.reason}${raw})`;
  }
  const details = [
    `${launchEligibilityLabel(read.value.code)} (${read.value.code})`,
    `evidence ${read.value.evidenceAuthority}`,
    read.value.nextAction ? `next ${read.value.nextAction}` : undefined,
    read.value.blockerCodes.length > 0 ? `blockers ${read.value.blockerCodes.join(", ")}` : undefined
  ].filter((part): part is string => part !== undefined);
  return details.join("; ");
}
