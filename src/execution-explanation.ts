import { createHash } from "node:crypto";

import type { ExplanationEntry, ExplanationOutcome, ExplanationSection, PolicyExplanation } from "./policy-explanation.js";

/**
 * The execution and spend/closeout truth the canonical explanation envelope
 * carries for an application that runs through the typed spine
 * (`BKLG-20260829-i6ld`). This module reads the same
 * `proof.liskov.policy-explanation.v1` envelope the policy explain and status
 * commands already fetch; it adds no schema and interprets no policy. A fact
 * the server did not report renders as "not reported", never as a guess.
 */

export const EXECUTION_STAGES = [
  "occurrence_authority_persisted",
  "occurrence_domains_bound",
  "effect_intent_committed",
  "effect_submitted",
  "effect_observed",
  "effect_closed"
] as const;
export type ExecutionStage = (typeof EXECUTION_STAGES)[number];

export const EXECUTION_CODES = [
  "occurrence_in_progress",
  "occurrence_blocked",
  "effect_terminal_failed",
  "occurrence_complete"
] as const;

export const SPEND_CODES = [
  "spend_not_reserved",
  "spend_reserved",
  "settlement_in_progress",
  "spend_settled",
  "spend_reclaimed",
  "settlement_refused",
  "spend_unknown_review"
] as const;

const NEXT_ACTION_BY_CODE: Record<string, string> = {
  occurrence_in_progress: "The occurrence is in progress on the server; wait for the next executor tick.",
  occurrence_blocked: "The server persisted a blocker; read its code below and the executor's next tick result.",
  effect_terminal_failed: "The effect closed without completing; the server records why in the trace.",
  occurrence_complete: "The occurrence closed and completed; nothing further is scheduled for it.",
  spend_not_reserved: "No reserve exists for this occurrence yet.",
  spend_reserved: "A reserve is open; settlement follows closeout.",
  settlement_in_progress: "The custody settlement effect is still open.",
  spend_settled: "The reserve settled.",
  spend_reclaimed: "The reserve was reclaimed.",
  settlement_refused: "The settlement was refused by its owner; the trace names the reason.",
  spend_unknown_review: "The exposure needs review on the server; do not infer an amount locally.",
  spine_checkpoint_locked: "A writer holds the typed spine; retry the read.",
  effect_trace_gap: "The persisted trace has a gap; the server reports the missing range instead of inventing entries.",
  effect_head_missing: "The effect envelope has no persisted head; the owner's commit was torn.",
  effect_record_unreadable: "The persisted effect record could not be read by the server projection.",
  trace_too_large: "The persisted trace exceeds the server read bound.",
  explanation_facts_database_error: "The server could not read the typed spine; retry.",
  execution_truth_unreadable: "The server's facts and its assembler disagree; report this build."
};

export interface ExecutionReceipts {
  submission: boolean | null;
  observation: boolean;
  reconciliation: boolean;
  closeout: boolean;
}

export interface ExecutionEffectView {
  operationId: string | null;
  operationRevision: number | null;
  effectKind: string | null;
  state: string | null;
  nextActionAtMs: number | null;
  receipts: ExecutionReceipts;
  observationStatus: string | null;
  closeoutOutcome: string | null;
  jobId: string | null;
  traceId: string | null;
  refusal: string | null;
}

export interface ExecutionAttemptEffectView {
  effectKind: string | null;
  operationId: string | null;
  operationRevision: number | null;
  state: string | null;
}

export interface ExecutionAttemptView {
  attemptId: string | null;
  occurrenceId: string | null;
  authorityRevision: number | null;
  selected: boolean;
  effects: ExecutionAttemptEffectView[];
}

export interface ExecutionBlockerView {
  stage: string | null;
  code: string | null;
  provenance: string | null;
  available: boolean;
  nextAction: string | null;
}

export interface ExecutionLineageView {
  linkedReservationId: string | null;
  unit: string | null;
  amount: string | null;
  reservationAtMs: number | null;
  exposureState: string | null;
  settlementDisposition: string | null;
  closeoutId: string | null;
}

export type ExplanationSource = "typed_spine" | "rollout" | "none";

export interface ExecutionView {
  source: ExplanationSource;
  outcome: ExplanationOutcome;
  code: string | null;
  occurrenceId: string | null;
  attemptId: string | null;
  authorityRevision: number | null;
  stage: string | null;
  domainsBound: boolean | null;
  effect: ExecutionEffectView | null;
  attempts: ExecutionAttemptView[];
  attemptsTruncated: boolean;
  blocker: ExecutionBlockerView | null;
  refusal: string | null;
  completeThrough: number;
  gaps: unknown[];
  entries: ExplanationEntry[];
}

export interface SpendView {
  source: ExplanationSource;
  outcome: ExplanationOutcome;
  code: string | null;
  reservationId: string | null;
  settlementEffect: ExecutionEffectView | null;
  lineages: ExecutionLineageView[];
  reserveCount: number | null;
  settlementCount: number | null;
  refusal: string | null;
  completeThrough: number;
  gaps: unknown[];
  entries: ExplanationEntry[];
}

export interface ExecutionChange {
  path: string;
  previous: unknown;
  current: unknown;
}

export function executionView(explanation: PolicyExplanation): ExecutionView {
  const section = explanation.execution;
  const provenance = asObject(section.provenance);
  const source = sourceOf(section);
  return {
    source,
    outcome: section.outcome,
    code: section.code,
    occurrenceId: optionalString(provenance?.occurrenceId),
    attemptId: optionalString(provenance?.attemptId),
    authorityRevision: optionalInteger(provenance?.authorityRevision),
    stage: optionalString(provenance?.stage),
    domainsBound: typeof provenance?.domainsBound === "boolean" ? provenance.domainsBound : null,
    effect: effectView(provenance?.effect),
    attempts: attemptsView(provenance?.attempts),
    attemptsTruncated: provenance?.attemptsTruncated === true,
    blocker: blockerView(provenance?.blocker),
    refusal: refusalCode(provenance?.refusal),
    completeThrough: section.completeThrough,
    gaps: section.gaps,
    entries: section.entries
  };
}

export function spendView(explanation: PolicyExplanation): SpendView {
  const section = explanation.spendCloseout;
  const provenance = asObject(section.provenance);
  return {
    source: sourceOf(section),
    outcome: section.outcome,
    code: section.code,
    reservationId: optionalString(provenance?.reservationId),
    settlementEffect: effectView(provenance?.settlementEffect),
    lineages: lineagesView(provenance?.lineages),
    reserveCount: optionalInteger(provenance?.reserveCount),
    settlementCount: optionalInteger(provenance?.settlementCount),
    refusal: refusalCode(provenance?.refusal),
    completeThrough: section.completeThrough,
    gaps: section.gaps,
    entries: section.entries
  };
}

export function executionNextAction(outcome: ExplanationOutcome, code: string | null): string {
  if (code && NEXT_ACTION_BY_CODE[code]) return NEXT_ACTION_BY_CODE[code];
  if (outcome === "refused") {
    return `Server refused (${code ?? "unspecified"}). Follow the server next action; do not recompute eligibility or spend.`;
  }
  if (outcome === "absent") return `Server reports ${code ?? "absent"} on this section; do not infer locally.`;
  if (outcome === "notApplicable") return `Server reports notApplicable (${code ?? "unspecified"}).`;
  return `Server reports satisfied (${code ?? "unspecified"}).`;
}

/** Whether the execution has reached a terminal server state, and whether that is success. */
export function executionTerminal(explanation: PolicyExplanation): { terminal: boolean; success: boolean } {
  const view = executionView(explanation);
  if (view.source !== "typed_spine") return { terminal: false, success: false };
  if (view.code === "occurrence_complete") return { terminal: true, success: true };
  if (view.code === "effect_terminal_failed") return { terminal: true, success: false };
  return { terminal: false, success: false };
}

/** A persisted, server-named blocker the executor will not clear by itself this tick. */
export function executionStableBlocker(explanation: PolicyExplanation): string | null {
  const view = executionView(explanation);
  if (view.source !== "typed_spine") return null;
  if (view.code === "occurrence_blocked" && view.blocker?.available === true && view.blocker.code) {
    return view.blocker.code;
  }
  return null;
}

export function formatExecutionExplanation(explanation: PolicyExplanation): string {
  const execution = executionView(explanation);
  const spend = spendView(explanation);
  const lines = [`Execution (${explanation.schema})`];
  if (execution.source !== "typed_spine") {
    lines.push(`execution: ${execution.outcome}${codeSuffix(execution.code)}`);
    lines.push(`  next: ${executionNextAction(execution.outcome, execution.code)}`);
    lines.push("  source: this application has no typed-spine occurrence; the server reports its rollout rows.");
    lines.push(`spendCloseout: ${spend.outcome}${codeSuffix(spend.code)}`);
    lines.push(`  next: ${executionNextAction(spend.outcome, spend.code)}`);
    return lines.join("\n");
  }
  lines.push(`execution: ${execution.outcome}${codeSuffix(execution.code)}`);
  lines.push(`  next: ${executionNextAction(execution.outcome, execution.code)}`);
  lines.push(`  occurrence ${reported(execution.occurrenceId)}`);
  lines.push(`  attempt ${reported(execution.attemptId)} (authority revision ${reported(execution.authorityRevision)})`);
  lines.push(`  stage: ${stageRail(execution.stage)}`);
  if (execution.effect) lines.push(...effectLines("  effect", execution.effect));
  else lines.push("  effect: none persisted");
  if (execution.blocker) {
    const blocker = execution.blocker;
    lines.push(`  blocker: ${reported(blocker.code)} [${reported(blocker.provenance)}${blocker.available ? "" : ", unavailable"}] at ${reported(blocker.stage)}`);
    if (blocker.nextAction) lines.push(`    ${blocker.nextAction}`);
  }
  if (execution.refusal) lines.push(`  refusal: ${execution.refusal}`);
  if (execution.attempts.length > 0) {
    lines.push(`  attempts (newest first${execution.attemptsTruncated ? ", truncated" : ""}):`);
    for (const attempt of execution.attempts) {
      const effects = attempt.effects.length === 0
        ? "no effects"
        : attempt.effects.map((effect) => `${reported(effect.effectKind)}=${reported(effect.state)}`).join(", ");
      lines.push(`    ${attempt.selected ? "*" : "-"} ${reported(attempt.attemptId)}: ${effects}`);
    }
  }
  lines.push(...traceLines("  trace", execution.completeThrough, execution.gaps, execution.entries));

  lines.push(`spendCloseout: ${spend.outcome}${codeSuffix(spend.code)}`);
  lines.push(`  next: ${executionNextAction(spend.outcome, spend.code)}`);
  lines.push(`  reservation ${reported(spend.reservationId)}; reserves ${reported(spend.reserveCount)}, settlements ${reported(spend.settlementCount)}`);
  if (spend.settlementEffect) lines.push(...effectLines("  settlement effect", spend.settlementEffect));
  for (const lineage of spend.lineages) {
    const amount = lineage.amount === null ? "amount not reported" : `${lineage.amount} ${lineage.unit ?? "unit not reported"}`;
    const disposition = lineage.settlementDisposition ? `; ${lineage.settlementDisposition}${lineage.closeoutId ? ` (${lineage.closeoutId})` : ""}` : "";
    const state = lineage.exposureState ? `; ${lineage.exposureState}` : "";
    lines.push(`  lineage ${reported(lineage.linkedReservationId)}: ${amount}${state}${disposition}`);
  }
  if (spend.refusal) lines.push(`  refusal: ${spend.refusal}`);
  lines.push(...traceLines("  trace", spend.completeThrough, spend.gaps, spend.entries));
  return lines.join("\n");
}

/** One compact line for `application status`; `undefined` when the server reports no typed-spine occurrence. */
export function formatExecutionStatusLine(explanation: PolicyExplanation): string | undefined {
  const execution = executionView(explanation);
  if (execution.source !== "typed_spine") return undefined;
  const spend = spendView(explanation);
  const state = execution.effect?.state ?? "no effect";
  const job = execution.effect?.jobId ? `; job ${execution.effect.jobId}` : "";
  const blocker = execution.blocker ? `; blocker ${reported(execution.blocker.code)} [${reported(execution.blocker.provenance)}]` : "";
  return `execution: ${execution.outcome}${codeSuffix(execution.code)}; stage ${reported(execution.stage)}; effect ${state}${job}${blocker}; spend ${spend.outcome}${codeSuffix(spend.code)}`;
}

/** A stable digest of the semantic execution and spend facts, for watch mode. */
export function executionDigest(explanation: PolicyExplanation): string {
  return createHash("sha256").update(canonical(semanticFacts(explanation))).digest("hex");
}

/** The closed paths whose values changed between two envelopes. */
export function executionChanges(previous: PolicyExplanation, current: PolicyExplanation): ExecutionChange[] {
  const before = flatten(semanticFacts(previous));
  const after = flatten(semanticFacts(current));
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: ExecutionChange[] = [];
  for (const path of [...paths].sort()) {
    const left = before[path];
    const right = after[path];
    if (canonical(left) !== canonical(right)) changes.push({ path, previous: left ?? null, current: right ?? null });
  }
  return changes;
}

export function formatExecutionChange(observedAtMs: number, change: ExecutionChange): string {
  const time = new Date(observedAtMs).toISOString().slice(11, 19);
  return `${time} ${change.path} ${renderValue(change.previous)} -> ${renderValue(change.current)}`;
}

function semanticFacts(explanation: PolicyExplanation): Record<string, unknown> {
  const execution = executionView(explanation);
  const spend = spendView(explanation);
  return {
    execution: {
      outcome: execution.outcome,
      code: execution.code,
      attemptId: execution.attemptId,
      stage: execution.stage,
      domainsBound: execution.domainsBound,
      effectState: execution.effect?.state ?? null,
      effectKind: execution.effect?.effectKind ?? null,
      receipts: execution.effect?.receipts ?? null,
      observationStatus: execution.effect?.observationStatus ?? null,
      closeoutOutcome: execution.effect?.closeoutOutcome ?? null,
      jobId: execution.effect?.jobId ?? null,
      effectRefusal: execution.effect?.refusal ?? null,
      blockerCode: execution.blocker?.code ?? null,
      blockerProvenance: execution.blocker?.provenance ?? null,
      refusal: execution.refusal,
      completeThrough: execution.completeThrough,
      gaps: execution.gaps.length,
      entries: execution.entries.length
    },
    spendCloseout: {
      outcome: spend.outcome,
      code: spend.code,
      reservationId: spend.reservationId,
      settlementState: spend.settlementEffect?.state ?? null,
      settlementRefusal: spend.settlementEffect?.refusal ?? null,
      lineages: spend.lineages.map((lineage) => ({
        linkedReservationId: lineage.linkedReservationId,
        exposureState: lineage.exposureState,
        settlementDisposition: lineage.settlementDisposition,
        closeoutId: lineage.closeoutId
      })),
      refusal: spend.refusal,
      completeThrough: spend.completeThrough,
      entries: spend.entries.length
    }
  };
}

function flatten(value: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(value)) {
    value.forEach((item, index) => Object.assign(out, flatten(item, `${prefix}[${index}]`)));
    if (value.length === 0) out[prefix] = [];
    return out;
  }
  const record = asObject(value);
  if (record) {
    for (const [key, child] of Object.entries(record)) {
      Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
    }
    return out;
  }
  out[prefix] = value;
  return out;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = asObject(value);
  if (record) {
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sourceOf(section: ExplanationSection): ExplanationSource {
  const provenance = asObject(section.provenance);
  if (provenance?.source === "typed_spine") return "typed_spine";
  if (provenance) return "rollout";
  return "none";
}

function effectView(value: unknown): ExecutionEffectView | null {
  const record = asObject(value);
  if (!record) return null;
  const receipts = asObject(record.receipts);
  return {
    operationId: optionalString(record.operationId),
    operationRevision: optionalInteger(record.operationRevision),
    effectKind: optionalString(record.effectKind),
    state: optionalString(record.state),
    nextActionAtMs: optionalInteger(record.nextActionAtMs),
    receipts: {
      submission: typeof receipts?.submission === "boolean" ? receipts.submission : null,
      observation: receipts?.observation === true,
      reconciliation: receipts?.reconciliation === true,
      closeout: receipts?.closeout === true
    },
    observationStatus: optionalString(record.observationStatus),
    closeoutOutcome: optionalString(record.closeoutOutcome),
    jobId: optionalString(record.jobId),
    traceId: optionalString(record.traceId),
    refusal: refusalCode(record.refusal)
  };
}

function attemptsView(value: unknown): ExecutionAttemptView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asObject(item);
    if (!record) return [];
    const effects = Array.isArray(record.effects) ? record.effects : [];
    return [{
      attemptId: optionalString(record.attemptId),
      occurrenceId: optionalString(record.occurrenceId),
      authorityRevision: optionalInteger(record.authorityRevision),
      selected: record.selected === true,
      effects: effects.flatMap((effect) => {
        const row = asObject(effect);
        if (!row) return [];
        return [{
          effectKind: optionalString(row.effectKind),
          operationId: optionalString(row.operationId),
          operationRevision: optionalInteger(row.operationRevision),
          state: optionalString(row.state)
        }];
      })
    }];
  });
}

function blockerView(value: unknown): ExecutionBlockerView | null {
  const record = asObject(value);
  if (!record) return null;
  return {
    stage: optionalString(record.stage),
    code: optionalString(record.code),
    provenance: optionalString(record.provenance),
    available: record.available === true,
    nextAction: optionalString(record.nextAction)
  };
}

function lineagesView(value: unknown): ExecutionLineageView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asObject(item);
    if (!record) return [];
    return [{
      linkedReservationId: optionalString(record.linkedReservationId),
      unit: optionalString(record.unit),
      amount: optionalString(record.amount),
      reservationAtMs: optionalInteger(record.reservationAtMs),
      exposureState: optionalString(record.exposureState),
      settlementDisposition: optionalString(record.settlementDisposition),
      closeoutId: optionalString(record.closeoutId)
    }];
  });
}

function refusalCode(value: unknown): string | null {
  const record = asObject(value);
  return record ? optionalString(record.code) : null;
}

function effectLines(label: string, effect: ExecutionEffectView): string[] {
  const receipts = [
    `submission ${effect.receipts.submission === null ? "not reported" : effect.receipts.submission ? "yes" : "no"}`,
    `observation ${effect.receipts.observation ? "yes" : "no"}`,
    `reconciliation ${effect.receipts.reconciliation ? "yes" : "no"}`,
    `closeout ${effect.receipts.closeout ? "yes" : "no"}`
  ].join(", ");
  const lines = [
    `${label}: ${reported(effect.effectKind)} ${reported(effect.operationId)} r${reported(effect.operationRevision)} state ${reported(effect.state)}`,
    `${indentOf(label)}  receipts: ${receipts}`
  ];
  const facts = [
    effect.jobId ? `job ${effect.jobId}` : undefined,
    effect.observationStatus ? `observation ${effect.observationStatus}` : undefined,
    effect.closeoutOutcome ? `closeout ${effect.closeoutOutcome}` : undefined,
    effect.nextActionAtMs !== null ? `next action ${new Date(effect.nextActionAtMs).toISOString()}` : undefined
  ].filter((item): item is string => item !== undefined);
  if (facts.length > 0) lines.push(`${indentOf(label)}  ${facts.join("; ")}`);
  if (effect.refusal) lines.push(`${indentOf(label)}  refusal: ${effect.refusal}`);
  return lines;
}

function traceLines(label: string, completeThrough: number, gaps: unknown[], entries: ExplanationEntry[]): string[] {
  const gapText = gaps.length === 0 ? "" : `; ${gaps.length} gap${gaps.length === 1 ? "" : "s"} reported`;
  const lines = [`${label}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, complete through ${completeThrough}${gapText}`];
  for (const entry of entries) {
    lines.push(`${indentOf(label)}  ${entry.sequence} ${entry.domain} ${entry.decision} ${entry.code}: ${entry.summary}`);
  }
  return lines;
}

function stageRail(stage: string | null): string {
  if (stage === null) return "not reported";
  const index = (EXECUTION_STAGES as readonly string[]).indexOf(stage);
  if (index === -1) return stage;
  return EXECUTION_STAGES.map((name, position) => (position < index ? `${name} ✓` : position === index ? `[${name}]` : name)).join(" > ");
}

function codeSuffix(code: string | null): string {
  return code ? ` [${code}]` : "";
}

function reported(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "not reported" : String(value);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  return canonical(value);
}

function indentOf(label: string): string {
  return " ".repeat(label.length - label.trimStart().length);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

function optionalInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? value as number : null;
}
