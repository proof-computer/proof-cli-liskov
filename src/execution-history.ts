export interface LiskovExecutionHistoryAttempt {
  executionId: string;
  planItemId?: string;
  status: string;
  reason?: string;
  timeMs?: number;
}

export interface LiskovExecutionHistoryResponse {
  ok?: boolean;
  attempts: unknown[];
  count: number;
  total: number;
  nextOffset?: number;
  [key: string]: unknown;
}

export function isExecutionHistoryResponse(value: unknown): value is LiskovExecutionHistoryResponse {
  const body = record(value);
  return body?.ok === true &&
    Array.isArray(body.attempts) &&
    nonNegativeInteger(body.count) &&
    nonNegativeInteger(body.total) &&
    (body.nextOffset === undefined || nonNegativeInteger(body.nextOffset));
}

export function formatExecutionHistory(
  applicationRef: string,
  body: LiskovExecutionHistoryResponse
): string {
  const next = body.nextOffset === undefined ? "none" : String(body.nextOffset);
  const lines = [
    `Live custody executions for ${applicationRef}: returned ${body.count}, total ${body.total}, next offset ${next}.`
  ];
  for (const rawAttempt of body.attempts) {
    const attempt = safeAttempt(rawAttempt);
    const identifiers = [
      attempt.executionId,
      attempt.planItemId ? `plan ${attempt.planItemId}` : undefined
    ].filter((value): value is string => value !== undefined).join(", ");
    const reason = attempt.reason ? `; reason ${attempt.reason}` : "";
    const time = attempt.timeMs === undefined ? "" : `; ${new Date(attempt.timeMs).toISOString()}`;
    lines.push(`- ${identifiers}: ${attempt.status}${reason}${time}`);
  }
  return lines.join("\n");
}

function safeAttempt(value: unknown): LiskovExecutionHistoryAttempt {
  const attempt = record(value) ?? {};
  const reason = string(attempt.reason) ??
    string(attempt.operatorReviewReason) ??
    string(record(attempt.receipt)?.reason);
  const timeMs = integer(attempt.updatedAtMs) ??
    integer(attempt.createdAtMs) ??
    integer(attempt.observedAtMs) ??
    integer(attempt.operatorReviewedAtMs);
  return {
    executionId: string(attempt.executionId) ?? "unknown",
    planItemId: string(attempt.planItemId),
    status: string(attempt.status) ?? "unknown",
    reason,
    timeMs
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? value as number : undefined;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
