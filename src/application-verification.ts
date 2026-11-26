import {
  LISKOV_ORGANIZATION_ENV,
  OrganizationSelectorError,
  organizationRequestHeaders
} from "./organization-context.js";
import {
  containsSecret,
  isoFromEpochMs,
  normalizeBaseUrl,
  objectRecord,
  readJsonResponse,
  readSlipwaySession,
  resolveSlipwaySessionFile,
  sessionUnauthorizedHuman,
  type SlipwayCliOptions
} from "./session.js";

type VerificationAction =
  | { kind: "show" }
  | { kind: "publish"; yes: boolean; publisherLabel: string | null | undefined }
  | { kind: "unpublish"; yes: boolean };

interface VerificationInput {
  applicationRef: string;
  config?: string;
  json?: boolean;
  slipwayUrl?: string;
}

const UNPUBLISHED = {
  published: false,
  handle: null,
  publisherLabel: null,
  publishedAtMs: null,
  publicPath: null
} as const;

const ERROR_PREFIX = "LISKOV_APPLICATION_VERIFICATION";
const REQUEST_FAILED = `${ERROR_PREFIX}_REQUEST_FAILED`;

export async function runApplicationVerification(
  input: VerificationInput,
  action: VerificationAction,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const fail = (error: string, message: string, status?: number): number => {
    if (input.json) {
      stdout(JSON.stringify({ ok: false, error, status, message }));
    } else {
      const detail = status === undefined ? message : `HTTP ${status}. ${message}`;
      stderr(sessionUnauthorizedHuman(error, `Error (${error}): ${detail}`));
    }
    return 1;
  };

  const applicationRef = input.applicationRef.trim();
  if (applicationRef === "" || applicationRef === "." || applicationRef === "..") {
    return fail(`${ERROR_PREFIX}_INVALID_APPLICATION`, "Supply a Liskov Application UID, name, or legacy ID.");
  }

  const env = options.env ?? process.env;
  const selector = options.organization ?? env[LISKOV_ORGANIZATION_ENV];
  const publisherLabel = action.kind === "publish" ? action.publisherLabel : undefined;
  const preview = action.kind !== "show" && !action.yes;
  const method = preview || action.kind === "show" ? "GET" : action.kind === "publish" ? "PUT" : "DELETE";
  let serviceUrl: string;
  let url: URL;
  let sessionToken: string;
  let headers: Record<string, string>;
  try {
    const saved = await readSlipwaySession(resolveSlipwaySessionFile({ config: input.config, env }));
    if (saved === undefined) {
      return fail("SLIPWAY_SESSION_NOT_FOUND", "Run `proof liskov login` first.");
    }
    sessionToken = saved.sessionToken;
    serviceUrl = normalizeBaseUrl(input.slipwayUrl ?? saved.slipwayUrl);
    url = new URL(`/api/applications/${encodeURIComponent(applicationRef)}/public-verification`, serviceUrl);
    const secrets = [sessionToken, encodeURIComponent(sessionToken)];
    if (sessionToken === "" || url.username || url.password ||
        containsSecret([url.href, serviceUrl, selector, publisherLabel], secrets)) {
      return fail(`${ERROR_PREFIX}_UNSAFE_INPUT`, "Check the session, service URL, application reference, organization, and label for credentials.");
    }
    headers = organizationRequestHeaders(sessionToken, selector);
  } catch (error) {
    if (error instanceof OrganizationSelectorError) return fail(error.code, error.message);
    return fail(`${ERROR_PREFIX}_INVALID_SESSION`, "Check the Liskov service URL and local session file.");
  }

  let response: Response;
  let body: unknown;
  try {
    if (method === "PUT") headers["content-type"] = "application/json";
    response = await (options.fetchImpl ?? fetch)(url, {
      method,
      headers,
      redirect: "error",
      body: method === "PUT" ? JSON.stringify({ publisherLabel }) : undefined
    });
    body = await readJsonResponse<unknown>(response, sessionToken);
  } catch {
    return fail(REQUEST_FAILED, "The Liskov request did not complete. Check the connection and use verification show to read the current state.");
  }

  if (!response.ok) {
    const { error } = objectRecord(body);
    const servedCode = typeof error === "string" && /^[a-zA-Z0-9_-]+$/u.test(error) ? error : undefined;
    const [code, message] = responseFailure(response.status, servedCode);
    return fail(code, message, response.status);
  }

  const state = decodePublication(body);
  if (state === undefined) {
    return fail(`${ERROR_PREFIX}_INVALID_RESPONSE`, "Liskov returned an invalid verification record. Check the service URL and server version.", response.status);
  }
  if (preview) {
    const next = action.kind === "unpublish"
      ? UNPUBLISHED
      : { ...state, published: true, publisherLabel: publisherLabel === undefined ? state.publisherLabel : publisherLabel };
    stdout(input.json
      ? JSON.stringify({ ok: true, dryRun: true, current: state, next })
      : formatPreview(action.kind, state.published, next.publisherLabel));
  } else {
    stdout(input.json ? JSON.stringify(body) : formatPublication(state, serviceUrl));
  }
  return 0;
}

function responseFailure(status: number, servedCode: string | undefined): [string, string] {
  if (status === 401) return ["SLIPWAY_SESSION_UNAUTHORIZED", "Run `proof liskov login` again."];
  if (servedCode === "application_not_found") return [servedCode, "Check the application reference and selected organization."];
  if (servedCode === "organization_not_found" || servedCode === "not_a_member" || servedCode === "invalid_organization_selector") {
    return [servedCode, "Check the selected organization."];
  }
  if (status === 404) {
    return [`${ERROR_PREFIX}_ROUTE_NOT_FOUND`, "This Liskov endpoint does not expose application verification. Check the service URL and server version."];
  }
  if (status === 403) return [servedCode ?? "forbidden", "Check your organization role. Publishing and unpublishing require an organization admin."];
  if (servedCode === "publisher_label_invalid") return [servedCode, "Check the publisher label."];
  return [servedCode ?? REQUEST_FAILED, "Liskov refused the application verification request."];
}

function decodePublication(body: unknown) {
  const { published, handle, publisherLabel, publishedAtMs, publicPath } = objectRecord(objectRecord(body).publicVerification);
  if (published === false && handle === null && publisherLabel === null && publishedAtMs === null && publicPath === null) {
    return UNPUBLISHED;
  }
  if (published !== true || typeof handle !== "string" || handle.length === 0 ||
      (publisherLabel !== null && typeof publisherLabel !== "string") ||
      typeof publishedAtMs !== "number" || isoFromEpochMs(publishedAtMs) === undefined ||
      typeof publicPath !== "string" || !/^\/(?!\/)/u.test(publicPath) || /[\\\s\p{Cc}]/u.test(publicPath)) {
    return undefined;
  }
  return { published, handle, publisherLabel, publishedAtMs, publicPath } as const;
}

type Publication = NonNullable<ReturnType<typeof decodePublication>>;

function formatPublication(state: Publication, serviceUrl: string): string {
  if (!state.published) return "Application verification is not published.";
  return [
    "Application verification is published.",
    `Handle: ${terminalText(state.handle)}`,
    formatLabel(state.publisherLabel),
    `Published at: ${isoFromEpochMs(state.publishedAtMs)}`,
    `Public URL: ${serviceUrl}${state.publicPath}`
  ].join("\n");
}

function formatPreview(action: "publish" | "unpublish", published: boolean, label: string | null): string {
  if (action === "unpublish") {
    const linkEffect = published
      ? "With --yes, the current public link stops working. Publishing again gives a new handle and a new link."
      : "Application verification is not published. Running with --yes leaves it unpublished.";
    return `Dry run. ${linkEffect}`;
  }
  const publicationEffect = published
    ? "With --yes, the handle and link stay the same."
    : "With --yes, anyone with the link can read the application's jobs, job keys, processor addresses, attestation facts, and chain coordinates without logging in.";
  return `Dry run. ${publicationEffect}\n${formatLabel(label)}`;
}

function formatLabel(label: string | null): string {
  return label === null ? "no label" : `label set by publisher: ${terminalText(label)}`;
}

function terminalText(value: string): string {
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
