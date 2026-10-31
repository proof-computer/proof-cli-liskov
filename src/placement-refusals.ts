/**
 * Owner: liskov-rs, application_placement_refusals_v1 (BKLG-20261003-v8rd).
 * Prints the tokens the server sends. There is no placement evaluation, no
 * country inference and no table from a refusal code to advice, so a token this
 * build has never seen prints like any other.
 */
export interface PlacementRefusalCountryReason {
  reason: string;
  predicate: string;
  source: string;
  nextAction: string;
  candidates: number;
}
export interface PlacementRefusalSpreadReason {
  reason: string;
  key: string | null;
  nextAction: string;
  observations: number;
}
export interface PlacementRefusalObservation {
  windowStartMs: number;
  placementCode: string;
  launchReason: string;
  country: PlacementRefusalCountryReason[];
  spread: PlacementRefusalSpreadReason[];
}
export interface ApplicationPlacementRefusals {
  ok: true;
  schema: "application_placement_refusals_v1";
  applicationId: string;
  generatedAtMs: number;
  observations: PlacementRefusalObservation[];
  nextCursor: string | null;
  incomplete: boolean;
}
export interface PlacementRefusalsQuery {
  fromMs: number;
  toMs: number;
  limit: number;
  cursor?: string;
}

const MAX_LIMIT = 100;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const countryReason = (value: unknown): boolean =>
  record(value) && text(value.reason) && text(value.predicate) && text(value.source) &&
  text(value.nextAction) && count(value.candidates);
const spreadReason = (value: unknown): boolean =>
  record(value) && text(value.reason) && (value.key === null || text(value.key)) &&
  text(value.nextAction) && count(value.observations);
const observation = (value: unknown): boolean =>
  record(value) && count(value.windowStartMs) && text(value.placementCode) && text(value.launchReason) &&
  Array.isArray(value.country) && value.country.every(countryReason) &&
  Array.isArray(value.spread) && value.spread.every(spreadReason);

/** A cursor on a page the server calls complete contradicts the owner's rule. */
export function isApplicationPlacementRefusals(body: unknown): body is ApplicationPlacementRefusals {
  return record(body) && body.ok === true && body.schema === "application_placement_refusals_v1" &&
    text(body.applicationId) && count(body.generatedAtMs) &&
    Array.isArray(body.observations) && body.observations.every(observation) &&
    (body.nextCursor === null || text(body.nextCursor)) && typeof body.incomplete === "boolean" &&
    (body.nextCursor === null || body.incomplete);
}

/** Digits only, as the owner parses them: `Number()` alone would take `1e3`, `0x10` and `" 1"`. */
function digits(raw: string): number | undefined {
  if (!/^\d+$/u.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** Refusal reasons are the owner's own `badRequests` tokens. The cursor is opaque and passes through untouched. */
export function parsePlacementRefusalsQuery(input: { fromMs: string; toMs: string; limit: string; cursor?: string }):
  | { ok: true; query: PlacementRefusalsQuery }
  | { ok: false; reason: string; message: string } {
  const fromMs = digits(input.fromMs);
  if (fromMs === undefined) return { ok: false, reason: "invalid_from_ms", message: "--from-ms must be a non-negative whole number of Unix milliseconds." };
  const toMs = digits(input.toMs);
  if (toMs === undefined) return { ok: false, reason: "invalid_to_ms", message: "--to-ms must be a non-negative whole number of Unix milliseconds." };
  if (fromMs >= toMs) return { ok: false, reason: "invalid_time_bounds", message: "--from-ms must be earlier than --to-ms." };
  const limit = digits(input.limit);
  if (limit === undefined || limit < 1 || limit > MAX_LIMIT) return { ok: false, reason: "invalid_limit", message: `--limit must be a whole number from 1 through ${MAX_LIMIT}.` };
  return { ok: true, query: { fromMs, toMs, limit, ...(input.cursor === undefined ? {} : { cursor: input.cursor }) } };
}

/** The route refuses an unknown or repeated parameter, so these four names go once each. */
export function placementRefusalsPath(applicationId: string, query: PlacementRefusalsQuery): string {
  const params = new URLSearchParams({ fromMs: String(query.fromMs), toMs: String(query.toMs), limit: String(query.limit) });
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  return `/api/applications/${encodeURIComponent(applicationId)}/placement/refusals?${params.toString()}`;
}

export function formatPlacementRefusals(body: ApplicationPlacementRefusals): string {
  const lines = [
    "Placement refusals recorded in this page",
    `Application: ${body.applicationId}`
  ];
  if (body.observations.length === 0) lines.push("There are no recorded refusals in this page.");
  for (const row of body.observations) {
    lines.push(`Window ${row.windowStartMs}: ${row.placementCode} (launch reason ${row.launchReason})`);
    for (const reason of row.country) {
      lines.push(
        `  Country: ${reason.reason} (predicate ${reason.predicate}, source ${reason.source}, recorded candidates ${reason.candidates})`,
        `    Next action: ${reason.nextAction}`
      );
    }
    for (const reason of row.spread) {
      lines.push(
        `  Spread: ${reason.reason} (key ${reason.key ?? "none"}, observations ${reason.observations})`,
        `    Next action: ${reason.nextAction}`
      );
    }
    if (row.country.length === 0 && row.spread.length === 0) lines.push("  No country or spread reason is recorded for this refusal.");
  }
  lines.push(body.incomplete
    ? "Page incomplete: another page exists, or a recorded refusal left out a candidate or a reason. This marks the whole page, not one row, and a reason absent here may still have occurred."
    : "Page not marked incomplete: this does not mean every refusal is present. Only the first refusal of each Application, code and hour is kept, and a refusal whose write failed has no row.");
  if (body.observations.some((row) => row.country.length > 0)) lines.push("Recorded candidates count only what was recorded, not every candidate refused.");
  lines.push("This read does not say placement succeeded, and it does not cover all Application history.");
  if (body.nextCursor !== null) lines.push(`Next page: repeat with the same --from-ms and --to-ms and --cursor ${body.nextCursor}`);
  return lines.join("\n");
}
