import {
  LISKOV_ORGANIZATION_ENV,
  OrganizationSelectorError,
  organizationRequestHeaders,
  organizationSelector
} from "./organization-context.js";
import {
  canonicalSessionOrganizationId,
  containsSecret,
  normalizeBaseUrl,
  readJsonResponse,
  readSlipwaySession,
  resolveSlipwaySessionFile,
  type SlipwayApiSessionResponse,
  type SlipwayCliOptions
} from "./session.js";

interface WorkloadRevisionsInput {
  applicationId: string;
  config?: string;
  slipwayUrl?: string;
  json?: boolean;
}

const text = (value: unknown): value is string =>
  typeof value === "string" && !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);
const nullableText = (value: unknown): value is string | null => value === null || text(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
const availability = (value: unknown): value is "current" | "stale" =>
  value === "current" || value === "stale";

type Field<T> = (value: unknown) => value is T;
type Fields<T> = { [K in keyof T]: Field<T[K]> };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

// Allowlist the owner wire fields. Additive fields, including any accidental
// credential or argument fields, cannot reach either rendering path.
function decode<T>(value: unknown, fields: Fields<T>): T | undefined {
  const wire = record(value);
  if (wire === undefined) return undefined;
  const entries = Object.entries<Field<unknown>>(fields);
  if (!entries.every(([key, valid]) => valid(wire[key]))) return undefined;
  return Object.fromEntries(entries.map(([key]) => [key, wire[key]])) as T;
}

function decodeRevision(value: unknown) {
  const wire = record(value);
  if (wire === undefined || !availability(wire.availability)) return undefined;
  const registration = decode(wire.registration, {
    launchId: text, processorId: text, runtimeInstanceId: text,
    originKind: text, originKey: text, sequence: text,
    launchPolicyDigest: text, registrationDigest: text,
    bootstrapDigest: text, rootfsDigest: text, helperDigest: text,
    phaseGridDigest: text, providerConstraintsDigest: text,
    paidStartMs: integer, paidEndMs: integer
  });
  const desired = decode(wire.desired, {
    targetEpoch: integer, targetRevisionDigest: text, desiredPolicyDigest: text,
    desiredReleaseDigest: text, sourceRevisionDigest: text,
    notBeforeMs: integer, expiresAtMs: integer, scheduleDeadlineMs: integer
  });
  const staged = decode(wire.staged, { stage: text, stagedRequestDigest: nullableText });
  const serving = decode(wire.serving, {
    currentEpoch: integer, currentRevisionDigest: nullableText,
    servingReady: boolean, converged: boolean, rolledBack: boolean
  });
  if (!registration || !desired || !staged || !serving) return undefined;
  return { registration, desired, staged, serving, availability: wire.availability };
}

type WorkloadRevision = NonNullable<ReturnType<typeof decodeRevision>>;

function decodeRevisions(value: unknown) {
  const wire = record(value);
  if (wire === undefined || !Array.isArray(wire.revisions) || !boolean(wire.truncated)) return undefined;
  const revisions: WorkloadRevision[] = [];
  for (const row of wire.revisions) {
    const revision = decodeRevision(row);
    if (revision === undefined) return undefined;
    revisions.push(revision);
  }
  return { revisions, truncated: wire.truncated };
}

function formatRevisions({ revisions, truncated }: { revisions: WorkloadRevision[]; truncated: boolean }): string {
  const lines = ["Observed workload revisions"];
  if (revisions.length === 0) lines.push("No workload revisions were reported for this application.");
  for (const { registration, desired, staged, serving, availability } of revisions) {
    lines.push(
      "",
      `Launch ${registration.launchId} (processor ${registration.processorId}, runtime ${registration.runtimeInstanceId})`,
      `  Registered provider artifact: bootstrap ${registration.bootstrapDigest}, rootfs ${registration.rootfsDigest}, helper ${registration.helperDigest}`,
      `  Desired payload: revision ${desired.targetRevisionDigest}, release ${desired.desiredReleaseDigest}, epoch ${desired.targetEpoch}, deadline ${desired.scheduleDeadlineMs} ms since Unix epoch`,
      `  Staged update: ${staged.stage}, request digest ${staged.stagedRequestDigest ?? "none reported"}`,
      `  Serving payload: revision ${serving.currentRevisionDigest ?? "none reported"}, epoch ${serving.currentEpoch}, ready ${serving.servingReady}, converged ${serving.converged}, rolled back ${serving.rolledBack}`,
      `  Observation: ${availability}`
    );
    if (staged.stage === "failed") {
      lines.push("  Update failed. Check the application logs before publishing a corrected revision.");
    }
    if (serving.rolledBack || staged.stage === "rolled_back") {
      lines.push("  Update rolled back. Check the reported serving revision and readiness before publishing again.");
    }
    if (availability === "stale") {
      lines.push("  Observation is stale. Check the execution status and schedule before relying on the serving state.");
    }
  }
  if (truncated) lines.push("", "The server truncated this list. More registrations may exist.");
  return lines.join("\n");
}

function pathSegment(value: unknown): value is string {
  return text(value) && value.trim() !== "" && value !== "." && value !== "..";
}

export async function runWorkloadRevisions(input: WorkloadRevisionsInput, options: SlipwayCliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const fail = (error: string, message: string, status?: number, unavailable = false): number => {
    if (input.json) {
      stdout(JSON.stringify({ ok: false, error, status, ...(unavailable ? { availability: "unavailable" } : {}), message }));
    } else {
      stderr(`Error (${error}): ${message}`);
    }
    return 1;
  };
  const invalidSession = () => fail(
    "workload_revisions_invalid_session",
    "Check the Liskov service URL and local session, then retry."
  );
  const unavailable = (status?: number) => fail(
    "workload_revisions_unavailable",
    "Workload revision status is unavailable. Check the Liskov connection and retry later.",
    status,
    true
  );
  const httpFailure = (status: number) => {
    if (status === 401) return fail("SLIPWAY_SESSION_UNAUTHORIZED", "Run `proof liskov login` again.", status);
    if (status === 403) return fail("workload_revisions_access_denied", "Check your membership in the selected organization.", status);
    if (status >= 500) return unavailable(status);
    return fail("workload_revisions_request_failed", "Check the Liskov endpoint and organization, then retry.", status);
  };

  const env = options.env ?? process.env;
  let selector: string | undefined;
  let saved: Awaited<ReturnType<typeof readSlipwaySession>>;
  let serviceUrl: URL;
  try {
    selector = organizationSelector(options.organization ?? env[LISKOV_ORGANIZATION_ENV]);
    saved = await readSlipwaySession(resolveSlipwaySessionFile({ config: input.config, env }));
    if (saved === undefined) {
      return fail("SLIPWAY_SESSION_NOT_FOUND", "Run `proof liskov login` first.");
    }
    serviceUrl = new URL(normalizeBaseUrl(input.slipwayUrl ?? saved.slipwayUrl));
  } catch (error) {
    if (error instanceof OrganizationSelectorError) return fail(error.code, error.message);
    return invalidSession();
  }
  if (!text(saved.sessionToken) || !saved.sessionToken || serviceUrl.username || serviceUrl.password) {
    return invalidSession();
  }
  const secrets = [saved.sessionToken, encodeURIComponent(saved.sessionToken)];
  if (containsSecret(serviceUrl.origin, secrets)) return invalidSession();
  if (!pathSegment(input.applicationId) || containsSecret(input.applicationId, secrets)) {
    return fail("workload_revisions_invalid_application", "Supply a valid Liskov application ID.");
  }
  if (containsSecret(selector, secrets)) {
    return fail("LISKOV_ORGANIZATION_SELECTOR_INVALID", "Supply a valid Liskov organization ID or slug.");
  }

  const read = (path: string, organization?: string) => {
    const url = new URL(path, serviceUrl);
    if (containsSecret(url.href, secrets)) throw new Error("Credential in request URL");
    return (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: organizationRequestHeaders(saved.sessionToken, organization),
      redirect: "error"
    });
  };

  try {
    const session = await read("/api/session", selector);
    if (!session.ok) return httpFailure(session.status);
    const context = await readJsonResponse<SlipwayApiSessionResponse>(session);
    const organizationId = context?.ok === true ? canonicalSessionOrganizationId(context) : undefined;
    if (!pathSegment(organizationId) || containsSecret(organizationId, secrets) ||
        (selector !== undefined && context?.organizationContext?.source !== "request")) {
      return fail("workload_revisions_organization_unavailable", "Could not resolve the effective organization. Check your session and organization selector.");
    }

    const response = await read(
      `/api/organizations/${encodeURIComponent(organizationId)}/applications/${encodeURIComponent(input.applicationId)}/workload-revisions`
    );
    if (response.status === 404) {
      const body = record(await readJsonResponse<unknown>(response));
      if (body?.error === "application_not_found") {
        return fail("application_not_found", "Check the application ID and selected organization.", 404);
      }
      if (body?.error === "organization_not_found") {
        return fail("organization_not_found", "Check the selected organization.", 404);
      }
      return fail("workload_revisions_route_not_found", "This endpoint did not expose workload revisions. Check the Liskov service URL and server version.", 404, true);
    }
    if (!response.ok) return httpFailure(response.status);

    const revisions = decodeRevisions(await readJsonResponse<unknown>(response));
    if (revisions === undefined || containsSecret(revisions, secrets)) {
      return fail("workload_revisions_invalid_response", "Liskov returned an invalid workload revisions response. Check the service URL and server version.", response.status, true);
    }
    stdout(input.json ? JSON.stringify(revisions) : formatRevisions(revisions));
    return 0;
  } catch {
    return unavailable();
  }
}
