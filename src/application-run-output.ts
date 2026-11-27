import { usd } from "./organization-output.js";

/**
 * The preview and confirm body of `POST /api/applications/:applicationId/run`.
 * `expectedCost` is the server's optional estimate; human text is derived here
 * and `--json` still emits the body the caller received.
 */
export interface ApplicationRunPreview {
  authorized?: boolean;
  settledGeneration?: number | null;
  jobs?: number | null;
  jobWindowMs?: number | null;
  perJobServiceCreditMicros?: string | null;
  availableServiceCreditMicros?: number | null;
  expectedCost?: unknown;
}

/**
 * The preview and the accepted confirm share one body, so they share one
 * formatter; `authorized` is the only field whose meaning differs.
 *
 * Nothing here promises a launch. The route records intent and opens no
 * reserve — the executor's admission checks remain the authority — so the
 * wording is always that a reserve *would* or *will* be opened.
 */
export function formatApplicationRun(applicationRef: string, body: ApplicationRunPreview): string {
  const authorized = body.authorized === true;
  const generation = typeof body.settledGeneration === "number"
    ? ` after settled generation ${body.settledGeneration}`
    : "";
  const lines = [authorized
    ? `Authorized one more run of ${applicationRef}${generation}.`
    : `Dry run: ${applicationRef} would run again${generation}.`];

  const shape = formatApplicationRunShape(body, authorized);
  if (shape !== undefined) lines.push(shape);
  const expected = formatExpectedCost(body);
  if (expected !== undefined) lines.push(expected);
  if (typeof body.availableServiceCreditMicros === "number") {
    lines.push(`Available Service Credit: ${usd(body.availableServiceCreditMicros / 1_000_000)}.`);
  }

  lines.push(authorized
    ? `Track it with \`proof liskov application execution show ${applicationRef} --watch\`.`
    : "This authorizes one more occurrence; it does not promise a launch. Add --yes to authorize the run.");
  return lines.join("\n");
}

/**
 * The jobs/window/reserve sentence, built only from figures the body actually
 * carries. A policy compiled to `independent_caps` has no per-job amount, so
 * the reserve clause is dropped rather than guessed at.
 */
function formatApplicationRunShape(body: ApplicationRunPreview, authorized: boolean): string | undefined {
  const parts: string[] = [];
  const jobs = typeof body.jobs === "number" ? body.jobs : undefined;
  if (jobs !== undefined) {
    const window = typeof body.jobWindowMs === "number" ? ` over a ${formatJobWindowMs(body.jobWindowMs)} window` : "";
    parts.push(`${jobs} job${jobs === 1 ? "" : "s"}${window}`);
  }
  const reserveUsd = serviceCreditUsd(body.perJobServiceCreditMicros, jobs);
  if (reserveUsd !== undefined) {
    parts.push(`a reserve of up to ${usd(reserveUsd)} Service Credit ${authorized ? "will" : "would"} be opened`);
  }
  return parts.length === 0 ? undefined : `${parts.join("; ")}.`;
}

/**
 * One sentence after the reserve. An absent `expectedCost` prints nothing, so
 * an older server keeps today's output. Money is Service Credit micros only.
 */
function formatExpectedCost(body: ApplicationRunPreview): string | undefined {
  if (!Object.hasOwn(body, "expectedCost")) return undefined;
  const cost = objectRecord(body.expectedCost);
  if (cost === undefined) return "Expected cost is not available.";
  if (cost.available === true) return formatAvailableExpectedCost(cost, body.jobs);
  if (cost.available === false) return formatUnavailableExpectedCost(cost.reason);
  return "Expected cost is not available.";
}

function formatAvailableExpectedCost(cost: Record<string, unknown>, jobs: number | null | undefined): string {
  const perJobMicros = typeof cost.perJobServiceCreditMicros === "string" ? cost.perJobServiceCreditMicros : undefined;
  const perJob = serviceCreditUsd(perJobMicros, 1);
  if (perJob === undefined) return "Expected cost is not available.";
  const run = serviceCreditUsd(perJobMicros, typeof jobs === "number" ? jobs : undefined);
  const amount = run === undefined
    ? `Expected about ${usd(perJob)} Service Credit per job`
    : `Expected about ${usd(perJob)} Service Credit per job (${usd(run)} for this run)`;
  const capped = cost.capped === true ? "; the cap bound this estimate" : "";
  return `${amount}${capped}.`;
}

const UNAVAILABLE_EXPECTED_COST: Record<string, string> = {
  not_v5_managed: "Expected cost is not available for an application that is not managed on V5.",
  constraints_not_estimated: "Expected cost is not available when the application limits which processors can run it.",
  rate_unavailable: "Expected cost is not available because the Service Credit rate is not available.",
  projection_stale: "Expected cost is not available because placement prices are out of date.",
  no_priced_candidates: "Expected cost is not available because no processor has a current price.",
  fewer_priced_candidates_than_jobs: "Expected cost is not available because fewer processors are priced than this run needs."
};

function formatUnavailableExpectedCost(reason: unknown): string {
  if (typeof reason !== "string") return "Expected cost is not available.";
  return UNAVAILABLE_EXPECTED_COST[reason] ?? "Expected cost is not available.";
}

/**
 * `perJobServiceCreditMicros` is an exact decimal string, not a number, so the
 * multiplication is done in `BigInt`. Anything that is not a plain micro count
 * — a null, a non-integer, a total past exact float range — returns undefined,
 * and the caller omits the clause rather than printing `NaN`.
 */
function serviceCreditUsd(perJob: string | null | undefined, jobs: number | undefined): number | undefined {
  if (typeof perJob !== "string" || !/^\d+$/u.test(perJob)) return undefined;
  if (jobs === undefined || !Number.isSafeInteger(jobs) || jobs < 0) return undefined;
  const micros = BigInt(perJob) * BigInt(jobs);
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(micros) / 1_000_000;
}

/**
 * A paid job window reads in the largest whole unit that divides it (`45s`,
 * `6h`); anything that divides evenly into none of them stays in milliseconds
 * rather than being rounded into a figure the policy does not say.
 */
function formatJobWindowMs(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) return `${ms} ms`;
  for (const [unit, size] of [["d", 86_400_000], ["h", 3_600_000], ["m", 60_000], ["s", 1_000]] as const) {
    if (ms >= size && ms % size === 0) return `${ms / size}${unit}`;
  }
  return `${ms} ms`;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
