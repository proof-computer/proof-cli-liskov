import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_SLIPWAY_URL = "https://slipway.proof.computer";

export interface SlipwayCliOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  openBrowser?: (url: string) => boolean | Promise<boolean>;
  sleepMs?: (ms: number) => Promise<void>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  nowMs?: () => number;
}

export interface SlipwayLoginInput {
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
  noBrowser?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface SlipwayWhoamiInput {
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationStatusInput {
  applicationId: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationPlansInput {
  applicationId: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationLockboxGrantStatusInput {
  applicationId: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationImportInput {
  file?: string;
  github?: string;
  serverFetch?: boolean;
  publish?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayLogoutInput {
  config?: string;
  json?: boolean;
}

export interface SlipwaySessionFile {
  version: 1;
  slipwayUrl: string;
  sessionToken: string;
  savedAtMs: number;
  session?: PublicSlipwaySession;
}

export interface PublicSlipwaySession {
  sessionId?: string;
  address?: string;
  identity?: PublicSlipwayIdentity;
  createdAtMs?: number;
  expiresAtMs?: number;
}

export type PublicSlipwayIdentity =
  | { kind: "wallet"; address?: string }
  | { kind: "github_test"; githubUserId?: string; login?: string; repositories?: readonly string[] }
  | { kind: "github_app"; githubUserId?: string; login?: string; avatarUrl?: string; repositories?: readonly string[]; installations?: readonly unknown[] }
  | { kind?: string; [key: string]: unknown };

interface SlipwayApiSessionResponse {
  ok?: boolean;
  session?: PublicSlipwaySession;
  error?: string;
  reason?: string;
}

interface SlipwayCliLoginResponse {
  ok?: boolean;
  cliLogin?: PublicSlipwayCliLogin;
  verificationUri?: string;
  verificationUriComplete?: string;
  error?: string;
  reason?: string;
}

interface SlipwayCliLoginPollResponse {
  ok?: boolean;
  status?: string;
  cliLogin?: PublicSlipwayCliLogin;
  session?: PublicSlipwaySession;
  error?: string;
  reason?: string;
}

interface PublicSlipwayCliLogin {
  pendingLoginId?: string;
  userCode?: string;
  status?: string;
  expiresAtMs?: number;
  pollIntervalMs?: number;
}

interface SlipwayApplicationStatusResponse {
  ok?: boolean;
  application?: {
    applicationId?: string;
    status?: string;
    serviceCount?: number;
    replicas?: number;
    source?: { repository?: string };
  };
  activePolicy?: {
    policyVersionId?: string;
    status?: string;
  };
  desired?: {
    replicas?: number;
  };
  observed?: {
    activeReplicas?: number;
    scheduledReplicas?: number;
    missingReplicas?: number;
  };
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SlipwayApplicationPlansResponse {
  ok?: boolean;
  count?: number;
  plans?: Array<{
    planKind?: string;
    role?: string;
    replicaIndex?: number;
    reason?: string;
  }>;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SlipwayApplicationLockboxGrantStatusResponse {
  ok?: boolean;
  applicationId?: string;
  count?: number;
  statuses?: Array<{
    grant?: {
      grantId?: string;
      status?: string;
    };
    requests?: {
      acceptedCount?: number;
      rejectedCount?: number;
      pendingCount?: number;
    };
    requestSummaryError?: string;
  }>;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SlipwayApplicationImportResponse {
  ok?: boolean;
  count?: number;
  applicationCount?: number;
  serviceCount?: number;
  policies?: unknown[];
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SlipwayGithubPolicySpec {
  repository: string;
  path: string;
  ref: string;
}

export async function runSlipwayLogin(input: SlipwayLoginInput, options: SlipwayCliOptions = {}): Promise<number> {
  const slipwayUrl = normalizeBaseUrl(input.slipwayUrl ?? DEFAULT_SLIPWAY_URL);
  const env = options.env ?? process.env;
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env });
  const fetchImpl = options.fetchImpl ?? fetch;
  const sessionToken = randomHex(32);
  const pendingSecret = randomHex(32);
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/cli-login/pending", slipwayUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        tokenHash: sha256(sessionToken),
        pendingSecretHash: sha256(pendingSecret),
        clientName: "proof-cli-slipway"
      })
    });
  } catch (error) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_CLI_LOGIN_CREATE_FAILED",
      message: errorMessage(error),
      slipwayUrl,
      sessionFile
    }, `Error (SLIPWAY_CLI_LOGIN_CREATE_FAILED): could not create a Slipway CLI login request at ${slipwayUrl}.`);
    return 1;
  }

  const created = await readJsonResponse<SlipwayCliLoginResponse>(response);
  const cliLogin = created?.cliLogin;
  const pendingLoginId = stringValue(cliLogin?.pendingLoginId);
  const userCode = stringValue(cliLogin?.userCode);
  if (!response.ok || created?.ok !== true || !pendingLoginId || !userCode) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_CLI_LOGIN_CREATE_FAILED",
      status: response.status,
      reason: created?.reason ?? created?.error,
      slipwayUrl,
      sessionFile
    }, `Error (SLIPWAY_CLI_LOGIN_CREATE_FAILED): Slipway did not create a pending CLI login request.`);
    return 1;
  }

  const verificationUri = resolveVerificationUrl(
    created.verificationUriComplete ?? created.verificationUri ?? `/cli-login.html?pendingLoginId=${encodeURIComponent(pendingLoginId)}&userCode=${encodeURIComponent(userCode)}`,
    slipwayUrl
  );
  const browserOpened = input.noBrowser === true ? false : await openVerificationUrl(verificationUri, options);
  emitLoginInstruction(options, {
    json: input.json,
    browserOpened,
    verificationUri,
    userCode
  });

  const nowMs = options.nowMs ?? Date.now;
  const startedAtMs = nowMs();
  const expiresAtMs = typeof cliLogin?.expiresAtMs === "number" ? cliLogin.expiresAtMs : startedAtMs + 10 * 60_000;
  const timeoutAtMs = input.timeoutMs === undefined ? expiresAtMs : Math.min(expiresAtMs, startedAtMs + Math.max(1, input.timeoutMs));
  const pollIntervalMs = Math.max(100, input.pollIntervalMs ?? cliLogin?.pollIntervalMs ?? 2_000);
  const sleep = options.sleepMs ?? defaultSleep;

  while (nowMs() <= timeoutAtMs) {
    let pollResponse: Response;
    try {
      pollResponse = await fetchImpl(new URL(`/api/cli-login/${encodeURIComponent(pendingLoginId)}/poll`, slipwayUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ pendingSecret })
      });
    } catch (error) {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_CLI_LOGIN_POLL_FAILED",
        message: errorMessage(error),
        slipwayUrl,
        sessionFile
      }, `Error (SLIPWAY_CLI_LOGIN_POLL_FAILED): could not poll Slipway CLI login status at ${slipwayUrl}.`);
      return 1;
    }

    const polled = await readJsonResponse<SlipwayCliLoginPollResponse>(pollResponse);
    if (!pollResponse.ok || polled?.ok !== true) {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_CLI_LOGIN_POLL_FAILED",
        status: pollResponse.status,
        reason: polled?.reason ?? polled?.error,
        slipwayUrl,
        sessionFile
      }, "Error (SLIPWAY_CLI_LOGIN_POLL_FAILED): Slipway rejected the CLI login poll request.");
      return 1;
    }

    if (polled.status === "authorized" && polled.session) {
      await saveSlipwaySession({
        version: 1,
        slipwayUrl,
        sessionToken,
        savedAtMs: nowMs(),
        session: polled.session
      }, { config: sessionFile, env, nowMs });
      writeStructuredOrHuman(options, input.json, {
        ok: true,
        status: "authorized",
        slipwayUrl,
        sessionFile,
        browserOpened,
        session: polled.session
      }, `Logged in to ${slipwayUrl} as ${formatSessionIdentity(polled.session)}.`);
      return 0;
    }

    if (polled.status === "expired" || polled.status === "cancelled") {
      const error = polled.status === "expired" ? "SLIPWAY_CLI_LOGIN_EXPIRED" : "SLIPWAY_CLI_LOGIN_CANCELLED";
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error,
        status: polled.status,
        slipwayUrl,
        sessionFile
      }, `Error (${error}): Slipway CLI login ${polled.status}. Run \`proof slipway login\` again.`);
      return 1;
    }

    await sleep(pollIntervalMs);
  }

  writeStructuredOrHuman(options, input.json, {
    ok: false,
    error: "SLIPWAY_CLI_LOGIN_TIMEOUT",
    status: "pending",
    slipwayUrl,
    sessionFile
  }, "Error (SLIPWAY_CLI_LOGIN_TIMEOUT): Slipway CLI login timed out. Run `proof slipway login` again.");
  return 1;
}

export async function runSlipwayWhoami(input: SlipwayWhoamiInput, options: SlipwayCliOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env });
  const saved = await readSlipwaySession(sessionFile);
  if (!saved) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_SESSION_NOT_FOUND",
      message: "No Slipway CLI session is stored locally.",
      sessionFile
    }, `Error (SLIPWAY_SESSION_NOT_FOUND): no Slipway CLI session found. Run \`proof slipway login\` first.`);
    return 1;
  }

  const slipwayUrl = normalizeBaseUrl(input.slipwayUrl ?? saved.slipwayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/session", slipwayUrl), {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${saved.sessionToken}`
      }
    });
  } catch (error) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_SESSION_READ_FAILED",
      message: errorMessage(error),
      slipwayUrl,
      sessionFile
    }, `Error (SLIPWAY_SESSION_READ_FAILED): could not read Slipway session from ${slipwayUrl}.`);
    return 1;
  }

  const body = await readJsonResponse<SlipwayApiSessionResponse>(response);
  if (!response.ok || body?.ok !== true || !body.session) {
    const error = response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_SESSION_READ_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: response.status,
      reason: body?.reason ?? body?.error,
      slipwayUrl,
      sessionFile
    }, `Error (${error}): Slipway did not accept the stored CLI session. Run \`proof slipway login\` again.`);
    return 1;
  }

  await saveSlipwaySession({
    ...saved,
    slipwayUrl,
    session: body.session
  }, { config: sessionFile, env, nowMs: options.nowMs });

  writeStructuredOrHuman(options, input.json, {
    ok: true,
    slipwayUrl,
    sessionFile,
    session: body.session
  }, `Logged in to ${slipwayUrl} as ${formatSessionIdentity(body.session)}.`);
  return 0;
}

export async function runSlipwayApplicationStatus(input: SlipwayApplicationStatusInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayApplicationStatusResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationId)}`,
    requestErrorCode: "SLIPWAY_APPLICATION_STATUS_FAILED",
    notFoundMessage: "No Slipway CLI session is stored locally.",
    fetchFailedMessage: "could not read Slipway Application status"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true || !body.application) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_STATUS_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      applicationId: input.applicationId,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Slipway could not read Application ${input.applicationId}.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    formatApplicationStatus(body, input.applicationId)
  );
  return 0;
}

export async function runSlipwayApplicationPlans(input: SlipwayApplicationPlansInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayApplicationPlansResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationId)}/plans`,
    requestErrorCode: "SLIPWAY_APPLICATION_PLANS_FAILED",
    notFoundMessage: "No Slipway CLI session is stored locally.",
    fetchFailedMessage: "could not read Slipway Application plans"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_PLANS_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      applicationId: input.applicationId,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Slipway could not read plans for Application ${input.applicationId}.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    `${typeof body.count === "number" ? body.count : body.plans?.length ?? 0} plan(s) for ${input.applicationId}.`
  );
  return 0;
}

export async function runSlipwayApplicationLockboxGrantStatus(input: SlipwayApplicationLockboxGrantStatusInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayApplicationLockboxGrantStatusResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationId)}/lockbox/grant-status`,
    requestErrorCode: "SLIPWAY_APPLICATION_LOCKBOX_GRANT_STATUS_FAILED",
    notFoundMessage: "No Slipway CLI session is stored locally.",
    fetchFailedMessage: "could not read Slipway Application Lockbox grant status"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_LOCKBOX_GRANT_STATUS_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      applicationId: input.applicationId,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Slipway could not read Lockbox grant status for Application ${input.applicationId}.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    formatLockboxGrantStatus(body, input.applicationId)
  );
  return 0;
}

export async function runSlipwayApplicationImport(input: SlipwayApplicationImportInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.file && !input.github) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_IMPORT_SOURCE_REQUIRED",
      message: "Specify --file PATH or --github owner/repo:path@ref."
    }, "Error (SLIPWAY_APPLICATION_IMPORT_SOURCE_REQUIRED): specify --file PATH or --github owner/repo:path@ref.");
    return 1;
  }
  if (input.file && input.github) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_IMPORT_SOURCE_CONFLICT",
      message: "Use only one Application import source."
    }, "Error (SLIPWAY_APPLICATION_IMPORT_SOURCE_CONFLICT): use only --file or --github.");
    return 1;
  }

  let body: Record<string, unknown>;
  if (input.file) {
    let document: unknown;
    const filePath = path.resolve(input.file);
    try {
      document = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_APPLICATION_IMPORT_FILE_FAILED",
        message: errorMessage(error),
        file: filePath
      }, `Error (SLIPWAY_APPLICATION_IMPORT_FILE_FAILED): could not read Application policy JSON from ${filePath}.`);
      return 1;
    }
    body = {
      document,
      source: { kind: "upload", filename: path.basename(filePath) },
      publish: input.publish === true
    };
  } else {
    let github: SlipwayGithubPolicySpec;
    try {
      github = parseGithubSpec(input.github!);
    } catch (error) {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_APPLICATION_IMPORT_GITHUB_SPEC_INVALID",
        message: errorMessage(error)
      }, "Error (SLIPWAY_APPLICATION_IMPORT_GITHUB_SPEC_INVALID): --github must be owner/repo:path@ref.");
      return 1;
    }

    const source = {
      kind: "github",
      repository: github.repository,
      ref: github.ref,
      path: github.path
    };
    if (input.serverFetch === true) {
      body = {
        source,
        publish: input.publish === true
      };
    } else {
      let document: unknown;
      try {
        document = await fetchGithubPolicyJson(options.fetchImpl ?? fetch, github);
      } catch (error) {
        writeStructuredOrHuman(options, input.json, {
          ok: false,
          error: "SLIPWAY_APPLICATION_IMPORT_GITHUB_FETCH_FAILED",
          message: errorMessage(error),
          source
        }, `Error (SLIPWAY_APPLICATION_IMPORT_GITHUB_FETCH_FAILED): could not fetch ${github.repository}:${github.path}@${github.ref}.`);
        return 1;
      }
      body = {
        document,
        source,
        publish: input.publish === true
      };
    }
  }

  const request = await authenticatedSlipwayJsonRequest<SlipwayApplicationImportResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: "/api/applications/imports",
    body,
    requestErrorCode: "SLIPWAY_APPLICATION_IMPORT_FAILED",
    notFoundMessage: "No Slipway CLI session is stored locally.",
    fetchFailedMessage: "could not import Slipway Application policy"
  }, options);
  if (!request.ok) return request.exitCode;

  const responseBody = request.body;
  if (responseBody?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_IMPORT_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: responseBody?.reason ?? responseBody?.error,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Slipway could not import the Application policy.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    responseBody,
    `Imported ${String(responseBody.count ?? responseBody.applicationCount ?? 0)} application(s), ${String(responseBody.serviceCount ?? 0)} service(s).`
  );
  return 0;
}

export async function runSlipwayLogout(input: SlipwayLogoutInput, options: SlipwayCliOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env });
  const saved = await readSlipwaySession(sessionFile);
  await rm(sessionFile, { force: true });
  writeStructuredOrHuman(options, input.json, {
    ok: true,
    loggedOut: saved !== undefined,
    slipwayUrl: saved?.slipwayUrl,
    sessionFile
  }, saved ? `Logged out from ${saved.slipwayUrl}.` : "No Slipway CLI session was stored locally.");
  return 0;
}

export async function saveSlipwaySession(
  session: SlipwaySessionFile,
  input: { config?: string; env?: NodeJS.ProcessEnv; nowMs?: () => number } = {}
): Promise<string> {
  const env = input.env ?? process.env;
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env });
  await mkdir(path.dirname(sessionFile), { recursive: true });
  const saved: SlipwaySessionFile = {
    ...session,
    version: 1,
    slipwayUrl: normalizeBaseUrl(session.slipwayUrl),
    savedAtMs: input.nowMs?.() ?? session.savedAtMs
  };
  await writeFile(sessionFile, `${JSON.stringify(saved, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(sessionFile, 0o600);
  return sessionFile;
}

export function resolveSlipwaySessionFile(input: { config?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const env = input.env ?? process.env;
  const explicit = input.config ?? env.PROOF_SLIPWAY_SESSION_FILE;
  if (explicit) return path.resolve(explicit);
  const configHome = env.XDG_CONFIG_HOME ? path.resolve(env.XDG_CONFIG_HOME) : path.join(homedir(), ".config");
  return path.join(configHome, "proof", "slipway", "session.json");
}

async function authenticatedSlipwayRequest<T>(
  input: {
    config?: string;
    slipwayUrl?: string;
    json?: boolean;
    path: string;
    requestErrorCode: string;
    notFoundMessage: string;
    fetchFailedMessage: string;
  },
  options: SlipwayCliOptions
): Promise<
  | {
      ok: true;
      body: T | undefined;
      response: Response;
      slipwayUrl: string;
      sessionFile: string;
    }
  | { ok: false; exitCode: number }
> {
  const env = options.env ?? process.env;
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env });
  const saved = await readSlipwaySession(sessionFile);
  if (!saved) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_SESSION_NOT_FOUND",
      message: input.notFoundMessage,
      sessionFile
    }, `Error (SLIPWAY_SESSION_NOT_FOUND): no Slipway CLI session found. Run \`proof slipway login\` first.`);
    return { ok: false, exitCode: 1 };
  }

  const slipwayUrl = normalizeBaseUrl(input.slipwayUrl ?? saved.slipwayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(new URL(input.path, slipwayUrl), {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${saved.sessionToken}`
      }
    });
  } catch (error) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: input.requestErrorCode,
      message: errorMessage(error),
      slipwayUrl,
      sessionFile
    }, `Error (${input.requestErrorCode}): ${input.fetchFailedMessage} at ${slipwayUrl}.`);
    return { ok: false, exitCode: 1 };
  }

  return {
    ok: true,
    body: await readJsonResponse<T>(response),
    response,
    slipwayUrl,
    sessionFile
  };
}

async function authenticatedSlipwayJsonRequest<T>(
  input: {
    config?: string;
    slipwayUrl?: string;
    json?: boolean;
    method: "POST";
    path: string;
    body: unknown;
    requestErrorCode: string;
    notFoundMessage: string;
    fetchFailedMessage: string;
  },
  options: SlipwayCliOptions
): Promise<
  | {
      ok: true;
      body: T | undefined;
      response: Response;
      slipwayUrl: string;
      sessionFile: string;
    }
  | { ok: false; exitCode: number }
> {
  const env = options.env ?? process.env;
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env });
  const saved = await readSlipwaySession(sessionFile);
  if (!saved) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_SESSION_NOT_FOUND",
      message: input.notFoundMessage,
      sessionFile
    }, `Error (SLIPWAY_SESSION_NOT_FOUND): no Slipway CLI session found. Run \`proof slipway login\` first.`);
    return { ok: false, exitCode: 1 };
  }

  const slipwayUrl = normalizeBaseUrl(input.slipwayUrl ?? saved.slipwayUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(new URL(input.path, slipwayUrl), {
      method: input.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${saved.sessionToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(input.body)
    });
  } catch (error) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: input.requestErrorCode,
      message: errorMessage(error),
      slipwayUrl,
      sessionFile
    }, `Error (${input.requestErrorCode}): ${input.fetchFailedMessage} at ${slipwayUrl}.`);
    return { ok: false, exitCode: 1 };
  }

  return {
    ok: true,
    body: await readJsonResponse<T>(response),
    response,
    slipwayUrl,
    sessionFile
  };
}

async function readSlipwaySession(sessionFile: string): Promise<SlipwaySessionFile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(sessionFile, "utf8")) as Partial<SlipwaySessionFile>;
    if (parsed.version !== 1 || typeof parsed.slipwayUrl !== "string" || typeof parsed.sessionToken !== "string") {
      throw new Error(`Slipway session file ${sessionFile} is not a version 1 session file`);
    }
    return {
      version: 1,
      slipwayUrl: normalizeBaseUrl(parsed.slipwayUrl),
      sessionToken: parsed.sessionToken,
      savedAtMs: typeof parsed.savedAtMs === "number" ? parsed.savedAtMs : 0,
      session: parsed.session
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readJsonResponse<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function writeStructuredOrHuman(options: SlipwayCliOptions, json: boolean | undefined, value: unknown, human: string): void {
  if (json) {
    emit(options, JSON.stringify(value));
    return;
  }
  emit(options, human);
}

function emit(options: SlipwayCliOptions, line: string): void {
  (options.stdout ?? console.log)(line);
}

function emitError(options: SlipwayCliOptions, line: string): void {
  (options.stderr ?? console.error)(line);
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Slipway URL must use http or https");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/u, "");
}

function resolveVerificationUrl(value: string, slipwayUrl: string): string {
  const url = new URL(value, slipwayUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Slipway verification URL must use http or https");
  }
  return url.toString();
}

async function openVerificationUrl(url: string, options: SlipwayCliOptions): Promise<boolean> {
  if (options.openBrowser) return Boolean(await options.openBrowser(url));
  return openBrowser(url);
}

function openBrowser(url: string): boolean {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function emitLoginInstruction(
  options: SlipwayCliOptions,
  input: { json?: boolean; browserOpened: boolean; verificationUri: string; userCode: string }
): void {
  const lines = [
    input.browserOpened
      ? "Browser opened for Slipway CLI authorization."
      : "Open this URL to authorize Slipway CLI login:",
    input.verificationUri,
    `Code: ${input.userCode}`,
    "Waiting for browser authorization..."
  ].join("\n");
  if (input.json) emitError(options, lines);
  else emit(options, lines);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseGithubSpec(value: string): SlipwayGithubPolicySpec {
  const match = /^([^:]+\/[^:]+):(.+)@([^@]+)$/u.exec(value.trim());
  if (!match) throw new Error("--github must be owner/repo:path@ref");
  return {
    repository: match[1]!,
    path: match[2]!.replace(/^\/+/u, ""),
    ref: match[3]!
  };
}

async function fetchGithubPolicyJson(fetchImpl: typeof fetch, input: SlipwayGithubPolicySpec): Promise<unknown> {
  const [owner, repo] = input.repository.split("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/${encodeURIComponent(input.ref)}/${input.path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json,text/plain;q=0.9,*/*;q=0.1" }
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  return JSON.parse(await response.text());
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatApplicationStatus(body: SlipwayApplicationStatusResponse, fallbackApplicationId: string): string {
  const app = body.application;
  const applicationId = app?.applicationId ?? fallbackApplicationId;
  const status = app?.status ?? body.activePolicy?.status ?? "unknown";
  const desired = typeof body.desired?.replicas === "number" ? body.desired.replicas : app?.replicas;
  const active = body.observed?.activeReplicas;
  const missing = body.observed?.missingReplicas;
  const replicaSummary = [
    typeof desired === "number" ? `desired ${desired}` : undefined,
    typeof active === "number" ? `active ${active}` : undefined,
    typeof missing === "number" ? `missing ${missing}` : undefined
  ].filter((item): item is string => item !== undefined).join(", ");
  const policy = body.activePolicy?.policyVersionId ? `; policy ${body.activePolicy.policyVersionId}` : "";
  const repository = app?.source?.repository ? `; repo ${app.source.repository}` : "";
  return `${applicationId}: ${status}${replicaSummary ? ` (${replicaSummary})` : ""}${policy}${repository}`;
}

function formatLockboxGrantStatus(body: SlipwayApplicationLockboxGrantStatusResponse, fallbackApplicationId: string): string {
  const applicationId = body.applicationId ?? fallbackApplicationId;
  const statuses = body.statuses ?? [];
  const accepted = statuses.reduce((sum, item) => sum + (typeof item.requests?.acceptedCount === "number" ? item.requests.acceptedCount : 0), 0);
  const requestErrors = statuses.filter((item) => typeof item.requestSummaryError === "string" && item.requestSummaryError.length > 0).length;
  const errorSummary = requestErrors > 0 ? `, ${requestErrors} request summary error(s)` : "";
  return `Lockbox grant status for ${applicationId}: ${statuses.length} grant(s), ${accepted} accepted job request(s)${errorSummary}.`;
}

function formatSessionIdentity(session: PublicSlipwaySession): string {
  const identity = session.identity;
  if (identity?.kind === "github_app" || identity?.kind === "github_test") {
    const login = typeof identity.login === "string" ? identity.login : undefined;
    return login ? `@${login}` : identity.kind;
  }
  if (identity?.kind === "wallet") {
    const address = typeof identity.address === "string" ? identity.address : undefined;
    return address ?? session.address ?? "wallet";
  }
  return session.address ?? session.sessionId ?? "unknown";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
