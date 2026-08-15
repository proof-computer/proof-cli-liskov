export interface LiskovApplicationLogLine {
  tsMs?: number;
  timestamp?: string;
  level?: string;
  message?: string;
  event?: string;
  jobId?: string;
  runtimeInstanceId?: string;
  receivedAtMs?: number;
  origin?: string | { kind?: string };
  [key: string]: unknown;
}

export interface LiskovApplicationLogsResponse {
  ok: true;
  generatedAtMs: number;
  available: boolean;
  reason?: string;
  logs: LiskovApplicationLogLine[];
  summary: Record<string, unknown>;
  nextCursor?: string | null;
  latestCursor?: string;
  order?: string;
  [key: string]: unknown;
}

export const APPLICATION_LOGS_HEADER = "TIMESTAMP LEVEL ORIGIN JOB_ID INSTANCE MESSAGE";

export function isLiskovApplicationLogsResponse(value: unknown): value is LiskovApplicationLogsResponse {
  const body = record(value);
  if (!body || body.ok !== true || typeof body.generatedAtMs !== "number"
    || typeof body.available !== "boolean" || !Array.isArray(body.logs)
    || !record(body.summary)) return false;
  if (body.available === false && typeof body.reason !== "string") return false;
  if (body.nextCursor !== undefined && body.nextCursor !== null && typeof body.nextCursor !== "string") return false;
  if (body.latestCursor !== undefined && typeof body.latestCursor !== "string") return false;
  if (body.order !== undefined && typeof body.order !== "string") return false;
  return body.logs.every((line) => record(line) !== undefined);
}

export function formatApplicationLogs(body: LiskovApplicationLogsResponse, applicationRef: string): string {
  const safeApplicationRef = terminalSafe(applicationRef);
  if (!body.available) {
    return `Application logging is unavailable for ${safeApplicationRef}: ${terminalSafe(body.reason ?? "unavailable")}.`;
  }
  const lines = [
    `Application logs for ${safeApplicationRef}: ${body.logs.length} record${body.logs.length === 1 ? "" : "s"}.`,
    APPLICATION_LOGS_HEADER,
    ...body.logs.map((line) => formatApplicationLogLine(line))
  ];
  const footer = formatOriginCountsFooter(body.summary);
  if (footer !== undefined) lines.push(footer);
  return lines.join("\n");
}

export function formatApplicationLogLine(line: LiskovApplicationLogLine): string {
  const timestamp = formatTimestamp(line);
  const level = normalizedLevel(line.level);
  const origin = productOrigin(line.origin);
  const jobId = terminalSafe(stringValue(line.jobId) ?? "—");
  const instance = terminalSafe(stringValue(line.runtimeInstanceId) ?? "-");
  const message = terminalSafe(stringValue(line.message) ?? stringValue(line.event) ?? "");
  return `${timestamp} ${level} ${origin} ${jobId} ${instance} ${message}`;
}

export function eventGlobMatcher(glob: string): (event: string) => boolean {
  const pattern = glob
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("[\\s\\S]*");
  const regex = new RegExp(`^${pattern}$`, "u");
  return (event) => regex.test(event);
}

export function terminalSafe(value: string): string {
  let output = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      output += `\\u${codePoint.toString(16).padStart(4, "0")}`;
    } else {
      output += character;
    }
  }
  return output;
}

function formatOriginCountsFooter(summary: Record<string, unknown>): string | undefined {
  const counts = record(summary.originCounts);
  if (!counts) return undefined;
  const entries = Object.entries(counts).filter((entry): entry is [string, number] =>
    typeof entry[1] === "number" && Number.isFinite(entry[1]));
  if (entries.length === 0) return undefined;
  return `Origins: ${entries.map(([origin, count]) => `${terminalSafe(origin)} ${count}`).join(", ")}.`;
}

function formatTimestamp(line: LiskovApplicationLogLine): string {
  const explicit = stringValue(line.timestamp);
  if (explicit) return terminalSafe(explicit);
  const epochMs = numberValue(line.tsMs) ?? numberValue(line.receivedAtMs);
  if (epochMs === undefined) return "—";
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? terminalSafe(String(epochMs)) : date.toISOString();
}

function normalizedLevel(value: unknown): "ERROR" | "INFO" | "WARN" {
  const level = stringValue(value)?.toLowerCase();
  if (level === "error" || level === "err" || level === "fatal" || level === "panic") return "ERROR";
  if (level === "warn" || level === "warning") return "WARN";
  return "INFO";
}

function productOrigin(value: unknown): "Application" | "Runtime SSH" {
  const direct = stringValue(value);
  const kind = direct ?? stringValue(record(value)?.kind);
  return kind === "runtime_ssh" ? "Runtime SSH" : "Application";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
