export const POLICY_EXPLANATION_SCHEMA = "proof.liskov.policy-explanation.v1";

export const EXPLANATION_OUTCOMES = ["absent", "notApplicable", "refused", "satisfied"] as const;
export type ExplanationOutcome = (typeof EXPLANATION_OUTCOMES)[number];

export const EXPLANATION_SECTIONS = ["publication", "execution", "spendCloseout", "managedSsh"] as const;
export type ExplanationSectionName = (typeof EXPLANATION_SECTIONS)[number];

const SECTION_FIELDS = ["outcome", "code", "pointer", "provenance", "completeThrough", "gaps", "entries"] as const;
const ENTRY_FIELDS = [
  "sequence",
  "domain",
  "decision",
  "code",
  "pointer",
  "summary",
  "evidenceDigests",
  "recordedAtMs"
] as const;

const NEXT_ACTION_BY_CODE: Record<string, string> = {
  policy_not_published: "Publish a retained V5 policy before expecting execution.",
  unknown_policy_schema: "This CLI cannot interpret that policy pair; do not infer locally.",
  publication_committed: "Publication is committed on the server read model.",
  no_rollout_intent: "No rollout intent is present on the server read model.",
  rollout_in_progress_or_ready: "Execution is in progress or ready according to the server.",
  no_spend_closeout: "No spend/closeout projection is present yet.",
  rollout_spend_window: "Spend/closeout is a projection of loaded rollout rows, not a client recomputation.",
  access_ssh_not_authored: "Managed SSH is not applicable; access.ssh is not authored.",
  managed_ssh_session_not_on_policy_read:
    "Session lifecycle is not on this policy-read surface. Use `proof liskov ssh` with an exact job."
};

export interface ExplanationEntry {
  sequence: number;
  domain: string;
  decision: string;
  code: string;
  pointer: string | null;
  summary: string;
  evidenceDigests: string[];
  recordedAtMs: number;
}

export interface ExplanationSection {
  outcome: ExplanationOutcome;
  code: string | null;
  pointer: string | null;
  provenance: unknown;
  completeThrough: number;
  gaps: unknown[];
  entries: ExplanationEntry[];
}

export interface PolicyExplanation {
  ok: boolean;
  schema: typeof POLICY_EXPLANATION_SCHEMA;
  generatedAtMs: number;
  publication: ExplanationSection;
  execution: ExplanationSection;
  spendCloseout: ExplanationSection;
  managedSsh: ExplanationSection;
}

export interface ExplanationNextAction {
  section: ExplanationSectionName;
  outcome: ExplanationOutcome;
  code: string | null;
  action: string;
}

export type PolicyExplanationParse =
  | { ok: true; explanation: PolicyExplanation; nextActions: ExplanationNextAction[] }
  | { ok: false; error: string; message: string };

export function policyExplanationPath(applicationId: string): string {
  return `/api/applications/${encodeURIComponent(applicationId)}/policy?view=explanation`;
}

export function parsePolicyExplanation(body: unknown): PolicyExplanationParse {
  const record = asObject(body);
  if (!record) {
    return {
      ok: false,
      error: "POLICY_EXPLANATION_INVALID",
      message: "Policy explanation response must be an object."
    };
  }
  if (record.schema !== POLICY_EXPLANATION_SCHEMA) {
    return {
      ok: false,
      error: "POLICY_EXPLANATION_UNSUPPORTED_SCHEMA",
      message: `Expected ${POLICY_EXPLANATION_SCHEMA}; this CLI does not interpret ${stringifySchema(record.schema)}.`
    };
  }
  if (record.ok !== true) {
    return {
      ok: false,
      error: "POLICY_EXPLANATION_INVALID",
      message: "Policy explanation response ok must be true."
    };
  }
  if (!Number.isSafeInteger(record.generatedAtMs)) {
    return {
      ok: false,
      error: "POLICY_EXPLANATION_INVALID",
      message: "Policy explanation generatedAtMs must be an integer."
    };
  }
  const sections: Record<ExplanationSectionName, ExplanationSection> = {
    publication: emptySection("absent"),
    execution: emptySection("absent"),
    spendCloseout: emptySection("absent"),
    managedSsh: emptySection("notApplicable")
  };
  for (const name of EXPLANATION_SECTIONS) {
    const parsed = parseSection(record[name], name);
    if (!parsed.ok) return parsed;
    sections[name] = parsed.section;
  }
  const explanation: PolicyExplanation = {
    ok: true,
    schema: POLICY_EXPLANATION_SCHEMA,
    generatedAtMs: record.generatedAtMs as number,
    ...sections
  };
  return { ok: true, explanation, nextActions: nextActionsFromExplanation(explanation) };
}

export function nextActionsFromExplanation(explanation: PolicyExplanation): ExplanationNextAction[] {
  return EXPLANATION_SECTIONS.map((section) => {
    const current = explanation[section];
    return {
      section,
      outcome: current.outcome,
      code: current.code,
      action: nextActionText(current.outcome, current.code)
    };
  });
}

export function formatPolicyExplanation(explanation: PolicyExplanation, nextActions: ExplanationNextAction[]): string {
  const lines = [`Policy explanation (${explanation.schema})`];
  for (const item of nextActions) {
    const current = explanation[item.section];
    const code = current.code ? ` [${current.code}]` : "";
    const pointer = current.pointer ? ` ${current.pointer}` : "";
    lines.push(`${item.section}: ${current.outcome}${code}${pointer}`);
    lines.push(`  next: ${item.action}`);
    for (const entry of current.entries) {
      lines.push(`  ${entry.sequence} ${entry.domain} ${entry.decision} ${entry.code}: ${entry.summary}`);
    }
  }
  return lines.join("\n");
}

export function formatStatusExplanation(nextActions: ExplanationNextAction[]): string {
  return nextActions.map((item) => {
    const code = item.code ? ` [${item.code}]` : "";
    return `${item.section}: ${item.outcome}${code}; next: ${item.action}`;
  }).join("\n");
}

function nextActionText(outcome: ExplanationOutcome, code: string | null): string {
  if (code && NEXT_ACTION_BY_CODE[code]) return NEXT_ACTION_BY_CODE[code];
  if (outcome === "refused") {
    return `Server refused (${code ?? "unspecified"}). Follow the server next action; do not recompute eligibility or spend.`;
  }
  if (outcome === "absent") {
    return `Server reports ${code ?? "absent"} on this section; do not infer locally.`;
  }
  if (outcome === "notApplicable") {
    return `Server reports notApplicable (${code ?? "unspecified"}).`;
  }
  return `Server reports satisfied (${code ?? "unspecified"}).`;
}

function parseSection(
  value: unknown,
  name: ExplanationSectionName
): { ok: true; section: ExplanationSection } | { ok: false; error: string; message: string } {
  const record = asObject(value);
  if (!record) {
    return { ok: false, error: "POLICY_EXPLANATION_INVALID", message: `${name} must be an object.` };
  }
  if (!isOutcome(record.outcome)) {
    return {
      ok: false,
      error: "POLICY_EXPLANATION_INVALID",
      message: `${name}.outcome must be absent, notApplicable, refused, or satisfied.`
    };
  }
  const entriesValue = record.entries === undefined ? [] : record.entries;
  if (!Array.isArray(entriesValue)) {
    return { ok: false, error: "POLICY_EXPLANATION_INVALID", message: `${name}.entries must be an array.` };
  }
  const entries: ExplanationEntry[] = [];
  for (const [index, entry] of entriesValue.entries()) {
    const parsed = parseEntry(entry, name, index);
    if (!parsed.ok) return parsed;
    entries.push(parsed.entry);
  }
  const gaps = record.gaps === undefined ? [] : record.gaps;
  if (!Array.isArray(gaps)) {
    return { ok: false, error: "POLICY_EXPLANATION_INVALID", message: `${name}.gaps must be an array.` };
  }
  void SECTION_FIELDS;
  return {
    ok: true,
    section: {
      outcome: record.outcome,
      code: optionalString(record.code),
      pointer: optionalString(record.pointer),
      provenance: record.provenance,
      completeThrough: Number.isSafeInteger(record.completeThrough) ? record.completeThrough as number : 0,
      gaps,
      entries
    }
  };
}

function parseEntry(
  value: unknown,
  section: ExplanationSectionName,
  index: number
): { ok: true; entry: ExplanationEntry } | { ok: false; error: string; message: string } {
  const record = asObject(value);
  if (!record) {
    return { ok: false, error: "POLICY_EXPLANATION_INVALID", message: `${section}.entries/${index} must be an object.` };
  }
  void ENTRY_FIELDS;
  if (!Number.isSafeInteger(record.sequence) || typeof record.domain !== "string"
    || typeof record.decision !== "string" || typeof record.code !== "string"
    || typeof record.summary !== "string" || !Number.isSafeInteger(record.recordedAtMs)) {
    return {
      ok: false,
      error: "POLICY_EXPLANATION_INVALID",
      message: `${section}.entries/${index} is missing required retained fields.`
    };
  }
  const digests = record.evidenceDigests === undefined ? [] : record.evidenceDigests;
  if (!Array.isArray(digests) || digests.some((item) => typeof item !== "string")) {
    return {
      ok: false,
      error: "POLICY_EXPLANATION_INVALID",
      message: `${section}.entries/${index}/evidenceDigests must be an array of strings.`
    };
  }
  return {
    ok: true,
    entry: {
      sequence: record.sequence as number,
      domain: record.domain,
      decision: record.decision,
      code: record.code,
      pointer: optionalString(record.pointer),
      summary: record.summary,
      evidenceDigests: digests as string[],
      recordedAtMs: record.recordedAtMs as number
    }
  };
}

function emptySection(outcome: ExplanationOutcome): ExplanationSection {
  return {
    outcome,
    code: null,
    pointer: null,
    provenance: undefined,
    completeThrough: 0,
    gaps: [],
    entries: []
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isOutcome(value: unknown): value is ExplanationOutcome {
  return typeof value === "string" && (EXPLANATION_OUTCOMES as readonly string[]).includes(value);
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : String(value);
}

function stringifySchema(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "an unknown schema";
}
