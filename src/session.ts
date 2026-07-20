import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_SLIPWAY_URL = "https://liskov.proof.computer";
const DEFAULT_RUNTIME_IMAGE_WORKFLOW_OUTPUT = ".github/workflows/liskov-runtime-image.yml";
const DEFAULT_RUNTIME_IMAGE_WORKFLOW_NAME = "Liskov Runtime Image Upload";
const DEFAULT_RUNTIME_IMAGE_OIDC_AUDIENCE = "liskov-runtime-image-upload";
const RUNTIME_IMAGE_UPLOAD_SESSION_DOMAIN = "proof.liskov.runtime-image-upload-session.v1";

export interface SlipwayCliOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  environmentHandoffBuilder?: (input: SlipwayEnvironmentHandoffBuildInput) => Promise<SlipwayEncryptedEnvironmentHandoff>;
  openBrowser?: (url: string) => boolean | Promise<boolean>;
  sleepMs?: (ms: number) => Promise<void>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  nowMs?: () => number;
}

export interface SlipwayEnvironmentHandoffBuildInput {
  action: SlipwaySetEnvironmentAction;
  variables: readonly { key: string; value: string }[];
  network: "mainnet" | "canary";
  rpcUrl: string;
  timeoutMs: number;
  pollMs: number;
}

export interface SlipwayEncryptedEnvironmentHandoff {
  domain: "proof.slipway.acurast-environment-handoff.v1";
  actionId: string;
  applicationId: string;
  policyDigest: string;
  childSessionId: string;
  jobId: string;
  deploymentId?: string;
  acurastJobRef: { origin: unknown; sequence: number; canonicalJobId: string };
  envNames: string[];
  assignments: Array<{
    processor: string;
    publicKey: string;
    variables: Array<{
      key: string;
      encryptedValue: { iv: string; ciphertext: string; authTag: string };
    }>;
  }>;
}

interface SlipwayEnvironmentVariableAction {
  name: string;
  required: boolean;
  source: "local" | "literal" | "secret" | "switchboard" | "localAction";
  value?: string;
  secretId?: string;
  bundleId?: string;
}

export interface SlipwaySetEnvironmentAction {
  actionId: string;
  kind: "acurast.setEnvironment";
  applicationId: string;
  serviceId: string;
  role: string;
  policyDigest: string;
  childSessionId: string;
  jobId: string;
  deploymentId?: string;
  acurastJobRef: { origin: unknown; sequence: number; canonicalJobId: string };
  expectedProcessors: string[];
  envNames: string[];
  variables: SlipwayEnvironmentVariableAction[];
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

export interface SlipwayApplicationListInput {
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationDeleteInput {
  applicationRef: string;
  owner?: string;
  reason?: string;
  force?: boolean;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationStatusTransitionInput {
  applicationRef: string;
  status: "active" | "paused";
  owner?: string;
  reason?: string;
  overrideReplacementHold?: boolean;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationSetRepositoryInput {
  applicationRef: string;
  repository: string;
  workflowRef?: string;
  owner?: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationRenameInput {
  applicationRef: string;
  displayName: string;
  owner?: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationPublishInput {
  applicationRef: string;
  paused?: boolean;
  reason?: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationBackfillIdentitiesInput {
  yes?: boolean;
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

export interface SlipwayApplicationSecretsInput {
  applicationId: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayGenericResponse {
  ok?: boolean;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface SlipwayApplicationDeploymentStatusInput {
  applicationRef: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationDevtoolsViewKeyInput {
  applicationRef: string;
  deploymentId: string;
  accountRef?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationActivityInput {
  applicationRef: string;
  limit?: number;
  before?: number;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationActionPlanInput {
  applicationRef: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationActionPlanRetryInput {
  applicationRef: string;
  decisionId: string;
  reason: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationArtifactPinListInput {
  applicationRef: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationArtifactPinRestoreInput {
  applicationRef: string;
  pinId: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationLockboxGrantListInput {
  applicationRef: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayAdminProcessorListInput {
  greylisted?: boolean;
  adminToken?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayAdminProcessorClearGreylistInput {
  processorId: string;
  reason?: string;
  yes?: boolean;
  adminToken?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayAdminExecutorOperationReconcileInput {
  operationId: string;
  expectApplication: string;
  expectKind: string;
  expectDeployment: string;
  expectJob: string;
  expectStatus: string;
  reason: string;
  yes?: boolean;
  adminToken?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayAdminDeploySpendResolveInput {
  reserveId: string;
  expectOrganization: string;
  expectApplication: string;
  expectDeployment: string;
  expectExecution: string;
  expectBillingTransaction: string;
  expectStatus: string;
  finalUsdMicros: number;
  evidenceRef: string;
  evidenceSha256: string;
  reason: string;
  yes?: boolean;
  adminToken?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationRuntimeImageWorkflowInput {
  applicationRef: string;
  liskovUrl?: string;
  oidcAudience?: string;
  output?: string;
  workflowName?: string;
  yes?: boolean;
  json?: boolean;
}

export interface SlipwayApplicationLockboxGrantStatusInput {
  applicationId: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationDeploymentImportInput {
  applicationRef: string;
  sequence: number;
  origin: string;
  deploymentId?: string;
  replicaIndex?: number;
  processor?: string;
  gatewayId?: string;
  endpointHostname?: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationLockboxSetupPrInput {
  applicationRef: string;
  baseRef?: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationLockboxDispatchInput {
  applicationRef: string;
  ref?: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationLockboxGrantEnsureInput {
  applicationRef: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationLockboxGrantVerifyInput {
  applicationRef: string;
  grantId: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationBlackboxConfigureInput {
  applicationRef: string;
  yes?: boolean;
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

export type SlipwayAcurastNetworkFlag = "mainnet" | "testnet" | "canary";

export interface SlipwayCustodyAccountEnsureInput {
  applicationRef: string;
  chain: "acurast";
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyPreflightInput {
  applicationRef: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyPairInput {
  applicationRef: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyEnvironmentUploadInput {
  applicationRef: string;
  secretsFile: string;
  repoDir?: string;
  network?: SlipwayAcurastNetworkFlag;
  rpcUrl?: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyExecutionListInput {
  applicationRef: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyExecutionSubmitInput {
  applicationRef: string;
  planItemId: string;
  idempotencyKey: string;
  yes?: boolean;
  yesSpend?: boolean;
  secretsFile?: string;
  repoDir?: string;
  network?: SlipwayAcurastNetworkFlag;
  rpcUrl?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyExecutionObserveInput {
  applicationRef: string;
  executionId: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyExecutionRunOneInput {
  applicationRef: string;
  executionId?: string;
  planItemId?: string;
  idempotencyKey?: string;
  expectKind: string;
  expectPolicyDigest: string;
  expectDeploymentId?: string;
  yes?: boolean;
  yesSpend?: boolean;
  secretsFile?: string;
  repoDir?: string;
  network?: SlipwayAcurastNetworkFlag;
  rpcUrl?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyExecutionDiagnoseInput {
  applicationRef: string;
  executionId: string;
  network?: SlipwayAcurastNetworkFlag;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyExecutionRecoverInput {
  applicationRef: string;
  executionId: string;
  reason: string;
  mode?: "review" | "retry" | "abandon";
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyExecutionRetryInput {
  applicationRef: string;
  executionId: string;
  reason: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayCustodyMachineCatalogInput {
  network?: SlipwayAcurastNetworkFlag;
  slipwayUrl?: string;
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

interface PublicSlipwayApplicationSummary {
  applicationUid?: string;
  applicationName?: string;
  applicationId?: string;
  ownerAddress?: string;
  displayName?: string;
  status?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  deletedAtMs?: number;
  deletedBy?: string;
  deleteReason?: string;
  replicas?: number;
  serviceCount?: number;
  source?: { repository?: string };
  artifact?: { status?: string };
  activePolicy?: { policyVersionId?: string; status?: string };
  activePolicyVersionId?: string;
  activePolicyDigest?: string;
  duplicateLegacyId?: boolean;
}

interface PublicSlipwayApplicationRefCandidate {
  applicationUid?: string;
  applicationName?: string;
  applicationId?: string;
  ownerAddress?: string;
  status?: string;
  repository?: string;
}

interface SlipwayApplicationDeleteBlocker {
  code?: string;
  message?: string;
  count?: number;
}

interface PublicSelfCustodySigner {
  status?: string;
  address?: string | null;
  connected?: boolean;
  pendingRequestCount?: number;
  offlineTtlMs?: number;
  offlineDeadlineAtMs?: number | null;
  message?: string;
  [key: string]: unknown;
}

interface SlipwayApplicationStatusResponse {
  ok?: boolean;
  application?: PublicSlipwayApplicationSummary;
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
  selfCustodySigner?: PublicSelfCustodySigner;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SlipwayApplicationListResponse {
  ok?: boolean;
  count?: number;
  applications?: PublicSlipwayApplicationSummary[];
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SlipwayApplicationDeleteResponse {
  ok?: boolean;
  dryRun?: boolean;
  deleted?: boolean;
  force?: boolean;
  application?: PublicSlipwayApplicationSummary;
  blockers?: SlipwayApplicationDeleteBlocker[];
  error?: string;
  reason?: string;
  candidates?: PublicSlipwayApplicationRefCandidate[];
  [key: string]: unknown;
}

interface SlipwayApplicationStatusTransitionResponse {
  ok?: boolean;
  dryRun?: boolean;
  changed?: boolean;
  previousStatus?: string;
  status?: "active" | "paused";
  application?: PublicSlipwayApplicationSummary;
  replacementHold?: PublicSlipwayReplacementHold;
  overrideRequired?: boolean;
  error?: string;
  reason?: string;
  candidates?: PublicSlipwayApplicationRefCandidate[];
  [key: string]: unknown;
}

interface SlipwayApplicationRepositoryRefs {
  repository?: string | null;
  artifactRepository?: string | null;
  workflowRef?: string | null;
}

interface SlipwayApplicationSetRepositoryResponse {
  ok?: boolean;
  dryRun?: boolean;
  changed?: boolean;
  from?: SlipwayApplicationRepositoryRefs;
  to?: SlipwayApplicationRepositoryRefs;
  policy?: { policyVersionId?: string; [key: string]: unknown };
  error?: string;
  reasonCode?: string;
  reason?: string;
  candidates?: PublicSlipwayApplicationRefCandidate[];
  [key: string]: unknown;
}

interface SlipwayApplicationRenameRefs {
  displayName?: string | null;
  applicationName?: string | null;
  expectedPolicyPath?: string | null;
}

interface SlipwayApplicationRenameResponse {
  ok?: boolean;
  dryRun?: boolean;
  changed?: boolean;
  from?: SlipwayApplicationRenameRefs;
  to?: SlipwayApplicationRenameRefs;
  policy?: { policyVersionId?: string; [key: string]: unknown };
  error?: string;
  reason?: string;
  candidates?: PublicSlipwayApplicationRefCandidate[];
  [key: string]: unknown;
}

interface PublicSlipwayReplacementHold {
  domain?: string;
  source?: string;
  executionId?: string;
  deploymentId?: string;
  policyDigest?: string;
  dossierClassification?: string;
  replacementRisk?: string;
  recommendation?: string;
  comparisonCounts?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SlipwayApplicationBackfillIdentitiesResponse {
  ok?: boolean;
  dryRun?: boolean;
  changed?: boolean;
  scanned?: number;
  changedCount?: number;
  changes?: Array<{
    ownerAddress?: string;
    applicationId?: string;
    applicationUid?: string;
    applicationName?: string;
    previousApplicationUid?: string;
    previousApplicationName?: string;
    reasons?: string[];
  }>;
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

interface SlipwayApplicationSecretsResponse {
  ok?: boolean;
  secrets?: {
    declarations?: Array<{
      secretId?: string;
      name?: string;
      bundleId?: string;
      target?: string;
      required?: boolean;
      scope?: string;
    }>;
    counts?: { required?: number; present?: number | null; missing?: number | null };
    resolution?: { available?: boolean; reason?: string };
  };
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

interface SlipwayActionPlanResponse {
  ok?: boolean;
  applicationId?: string;
  count?: number;
  items?: unknown[];
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

interface SlipwayLiveCustodyCommandResponse {
  ok?: boolean;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SlipwayCustodyPairingTokenResponse {
  ok?: boolean;
  pairingToken?: string;
  organizationId?: string;
  applicationId?: string;
  expiresAtMs?: number;
  websocketPath?: string;
  protocolVersion?: number;
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
    }, `Error (SLIPWAY_CLI_LOGIN_CREATE_FAILED): could not create a Liskov CLI login request at ${slipwayUrl}.`);
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
    }, `Error (SLIPWAY_CLI_LOGIN_CREATE_FAILED): Liskov did not create a pending CLI login request.`);
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
      }, `Error (SLIPWAY_CLI_LOGIN_POLL_FAILED): could not poll Liskov CLI login status at ${slipwayUrl}.`);
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
      }, "Error (SLIPWAY_CLI_LOGIN_POLL_FAILED): Liskov rejected the CLI login poll request.");
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
      }, `Error (${error}): Liskov CLI login ${polled.status}. Run \`proof liskov login\` again.`);
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
  }, "Error (SLIPWAY_CLI_LOGIN_TIMEOUT): Liskov CLI login timed out. Run `proof liskov login` again.");
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
      message: "No Liskov CLI session is stored locally.",
      sessionFile
    }, `Error (SLIPWAY_SESSION_NOT_FOUND): no Liskov CLI session found. Run \`proof liskov login\` first.`);
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
    }, `Error (SLIPWAY_SESSION_READ_FAILED): could not read Liskov session from ${slipwayUrl}.`);
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
    }, `Error (${error}): Liskov did not accept the stored CLI session. Run \`proof liskov login\` again.`);
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
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application status"
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
    }, `Error (${error}): Liskov could not read Application ${input.applicationId}.`);
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

export async function runSlipwayApplicationList(input: SlipwayApplicationListInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayApplicationListResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: "/api/applications",
    requestErrorCode: "SLIPWAY_APPLICATION_LIST_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not list Liskov Applications"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true || !Array.isArray(body.applications)) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_LIST_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Liskov could not list Applications.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    formatApplicationList(body)
  );
  return 0;
}

export async function runSlipwayApplicationBackfillIdentities(input: SlipwayApplicationBackfillIdentitiesInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayJsonRequest<SlipwayApplicationBackfillIdentitiesResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: "/api/applications/backfill-identities",
    body: {
      confirm: input.yes === true
    },
    requestErrorCode: "SLIPWAY_APPLICATION_BACKFILL_IDENTITIES_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not backfill Liskov Application identities"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true || !Array.isArray(body.changes)) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_BACKFILL_IDENTITIES_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Liskov could not backfill Application identities.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    formatApplicationBackfillIdentities(body)
  );
  return 0;
}

export async function runSlipwayApplicationDelete(input: SlipwayApplicationDeleteInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayJsonRequest<SlipwayApplicationDeleteResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "DELETE",
    path: applicationDeletePath(input.applicationRef, input.owner),
    body: {
      confirm: input.yes === true,
      force: input.force === true,
      reason: input.reason
    },
    requestErrorCode: "SLIPWAY_APPLICATION_DELETE_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not delete Liskov Application"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true || !body.application) {
    const ambiguous = body?.error === "ambiguous_application" && Array.isArray(body.candidates);
    const error = request.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : ambiguous
        ? "SLIPWAY_APPLICATION_AMBIGUOUS"
        : "SLIPWAY_APPLICATION_DELETE_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      applicationRef: input.applicationRef,
      candidates: body?.candidates,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, ambiguous
      ? formatApplicationAmbiguity(input.applicationRef, body!.candidates!)
      : `Error (${error}): Liskov could not delete Application ${input.applicationRef}.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    formatApplicationDelete(body)
  );
  return 0;
}

export async function runSlipwayApplicationStatusTransition(input: SlipwayApplicationStatusTransitionInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayJsonRequest<SlipwayApplicationStatusTransitionResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: applicationStatusPath(input.applicationRef, input.owner),
    body: {
      status: input.status,
      confirm: input.yes === true,
      reason: input.reason,
      overrideReplacementHold: input.overrideReplacementHold === true ? true : undefined
    },
    requestErrorCode: "SLIPWAY_APPLICATION_STATUS_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not update Liskov Application status"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true || !body.application) {
    const ambiguous = body?.error === "ambiguous_application" && Array.isArray(body.candidates);
    const replacementHoldBlocked = body?.error === "application_resume_blocked_by_replacement_hold";
    const error = request.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : ambiguous
        ? "SLIPWAY_APPLICATION_AMBIGUOUS"
        : replacementHoldBlocked
          ? "application_resume_blocked_by_replacement_hold"
        : "SLIPWAY_APPLICATION_STATUS_FAILED";
    const output = replacementHoldBlocked
      ? body
      : {
          ok: false,
          error,
          status: request.response.status,
          reason: body?.reason ?? body?.error,
          applicationRef: input.applicationRef,
          candidates: body?.candidates,
          slipwayUrl: request.slipwayUrl,
          sessionFile: request.sessionFile
        };
    writeStructuredOrHuman(options, input.json, output, ambiguous
      ? formatApplicationAmbiguity(input.applicationRef, body!.candidates!)
      : replacementHoldBlocked
        ? formatReplacementHoldBlocked(input.applicationRef, body as SlipwayApplicationStatusTransitionResponse)
        : `Error (${error}): Liskov could not update Application ${input.applicationRef} status.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    formatApplicationStatusTransition(body)
  );
  return 0;
}

export async function runSlipwayApplicationSetRepository(input: SlipwayApplicationSetRepositoryInput, options: SlipwayCliOptions = {}): Promise<number> {
  let repository: string;
  try {
    repository = parseRepositorySlug(input.repository);
  } catch (error) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_SET_REPOSITORY_INVALID",
      message: errorMessage(error),
      applicationRef: input.applicationRef
    }, "Error (SLIPWAY_SET_REPOSITORY_INVALID): repository must be owner/repo.");
    return 1;
  }
  const request = await authenticatedSlipwayJsonRequest<SlipwayApplicationSetRepositoryResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: applicationRepositoryPath(input.applicationRef, input.owner),
    body: {
      repository,
      workflowRef: input.workflowRef,
      confirm: input.yes === true
    },
    requestErrorCode: "SLIPWAY_APPLICATION_SET_REPOSITORY_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not update Liskov Application repository"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true) {
    const ambiguous = body?.error === "ambiguous_application" && Array.isArray(body.candidates);
    const accessDenied = body?.reasonCode === "github_repository_access_denied" || body?.error === "github_repository_access_denied";
    const error = request.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : ambiguous
        ? "SLIPWAY_APPLICATION_AMBIGUOUS"
        : accessDenied
          ? "SLIPWAY_REPOSITORY_ACCESS_DENIED"
          : "SLIPWAY_APPLICATION_SET_REPOSITORY_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      applicationRef: input.applicationRef,
      candidates: body?.candidates,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, ambiguous
      ? formatApplicationAmbiguity(input.applicationRef, body!.candidates!)
      : `Error (${error}): Liskov could not update Application ${input.applicationRef} repository.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    formatApplicationSetRepository(input.applicationRef, body)
  );
  return 0;
}

export async function runSlipwayApplicationRename(input: SlipwayApplicationRenameInput, options: SlipwayCliOptions = {}): Promise<number> {
  const displayName = (input.displayName ?? "").trim();
  if (!displayName) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_RENAME_INVALID",
      message: "displayName must not be empty",
      applicationRef: input.applicationRef
    }, "Error (SLIPWAY_RENAME_INVALID): a non-empty display name is required.");
    return 1;
  }
  const request = await authenticatedSlipwayJsonRequest<SlipwayApplicationRenameResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: applicationRenamePath(input.applicationRef, input.owner),
    body: {
      displayName,
      confirm: input.yes === true
    },
    requestErrorCode: "SLIPWAY_APPLICATION_RENAME_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not rename Liskov Application"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true) {
    const ambiguous = body?.error === "ambiguous_application" && Array.isArray(body.candidates);
    const error = request.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : ambiguous
        ? "SLIPWAY_APPLICATION_AMBIGUOUS"
        : "SLIPWAY_APPLICATION_RENAME_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      applicationRef: input.applicationRef,
      candidates: body?.candidates,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, ambiguous
      ? formatApplicationAmbiguity(input.applicationRef, body!.candidates!)
      : `Error (${error}): Liskov could not rename Application ${input.applicationRef}.`);
    return 1;
  }

  writeStructuredOrHuman(
    options,
    input.json,
    body,
    formatApplicationRename(input.applicationRef, body)
  );
  return 0;
}

export async function runSlipwayApplicationPublish(input: SlipwayApplicationPublishInput, options: SlipwayCliOptions = {}): Promise<number> {
  const reason = input.reason?.trim();
  if (input.paused && !reason) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_PUBLISH_PAUSED_REASON_REQUIRED",
      applicationRef: input.applicationRef
    }, "Error (SLIPWAY_APPLICATION_PUBLISH_PAUSED_REASON_REQUIRED): --paused requires a non-empty --reason.");
    return 1;
  }
  if (!input.paused && reason) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_PUBLISH_REASON_WITHOUT_PAUSED",
      applicationRef: input.applicationRef
    }, "Error (SLIPWAY_APPLICATION_PUBLISH_REASON_WITHOUT_PAUSED): --reason is only valid with --paused.");
    return 1;
  }
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_PUBLISH_CONFIRMATION_REQUIRED", "Application publish");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/publish`,
    body: input.paused ? { postPublishStatus: "paused", reason } : {},
    errorCode: "SLIPWAY_APPLICATION_PUBLISH_FAILED",
    fetchFailedMessage: "could not publish Liskov Application",
    human: (body) => {
      const policy = objectRecord(objectRecord(body).policy);
      const version = stringValue(policy.policyVersionId) ?? stringValue(policy.versionId);
      return input.paused
        ? `Published ${version ? `policy ${version}` : "policy"} for ${input.applicationRef}; Application is paused.`
        : `Published ${version ? `policy ${version}` : "active policy"} for ${input.applicationRef}.`;
    }
  }, options);
}

export async function runSlipwayApplicationPlans(input: SlipwayApplicationPlansInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayApplicationPlansResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationId)}/plans`,
    requestErrorCode: "SLIPWAY_APPLICATION_PLANS_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application plans"
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
    }, `Error (${error}): Liskov could not read plans for Application ${input.applicationId}.`);
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

export async function runSlipwayApplicationSecrets(input: SlipwayApplicationSecretsInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayApplicationSecretsResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationId)}/secrets`,
    requestErrorCode: "SLIPWAY_APPLICATION_SECRETS_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application secrets"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_SECRETS_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      applicationId: input.applicationId,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Liskov could not read secrets for Application ${input.applicationId}.`);
    return 1;
  }

  writeStructuredOrHuman(options, input.json, body, formatApplicationSecrets(body, input.applicationId));
  return 0;
}

export async function runSlipwayApplicationDeploymentStatus(input: SlipwayApplicationDeploymentStatusInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/deployments`,
    requestErrorCode: "SLIPWAY_APPLICATION_DEPLOYMENT_STATUS_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application deployment status"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_DEPLOYMENT_STATUS_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: request.response.status, reason: body?.reason ?? body?.error, applicationRef: input.applicationRef, slipwayUrl: request.slipwayUrl, sessionFile: request.sessionFile }, `Error (${error}): Liskov could not read the deployment status for Application ${input.applicationRef}.`);
    return 1;
  }
  writeStructuredOrHuman(options, input.json, body, formatApplicationDeploymentStatus(body, input.applicationRef));
  return 0;
}

export async function runSlipwayApplicationDevtoolsViewKey(input: SlipwayApplicationDevtoolsViewKeyInput, options: SlipwayCliOptions = {}): Promise<number> {
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/devtools/view-key`,
    body: {
      deploymentId: input.deploymentId,
      accountRef: input.accountRef
    },
    errorCode: "SLIPWAY_APPLICATION_DEVTOOLS_VIEW_KEY_FAILED",
    fetchFailedMessage: "could not mint a Liskov Acurast DevTools view key",
    human: (body) => formatApplicationDevtoolsViewKey(body, input)
  }, options);
}

export async function runSlipwayApplicationActivity(input: SlipwayApplicationActivityInput, options: SlipwayCliOptions = {}): Promise<number> {
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.before !== undefined) query.set("before", String(input.before));
  const queryString = query.toString();
  const request = await authenticatedSlipwayRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/activity${queryString ? `?${queryString}` : ""}`,
    requestErrorCode: "SLIPWAY_APPLICATION_ACTIVITY_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application activity"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_ACTIVITY_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: request.response.status, reason: body?.reason ?? body?.error, applicationRef: input.applicationRef, slipwayUrl: request.slipwayUrl, sessionFile: request.sessionFile }, `Error (${error}): Liskov could not read the activity for Application ${input.applicationRef}.`);
    return 1;
  }
  const events = body.events;
  const count = typeof body.count === "number" ? body.count : Array.isArray(events) ? events.length : 0;
  writeStructuredOrHuman(options, input.json, body, formatApplicationActivity(body, input.applicationRef, count));
  return 0;
}

export async function runSlipwayApplicationActionPlan(input: SlipwayApplicationActionPlanInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/action-plan`,
    requestErrorCode: "SLIPWAY_APPLICATION_ACTION_PLAN_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application action plan"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_ACTION_PLAN_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: request.response.status, reason: body?.reason ?? body?.error, applicationRef: input.applicationRef, slipwayUrl: request.slipwayUrl, sessionFile: request.sessionFile }, `Error (${error}): Liskov could not read the action plan for Application ${input.applicationRef}.`);
    return 1;
  }
  writeStructuredOrHuman(options, input.json, body, `Action plan for ${input.applicationRef}.`);
  return 0;
}

export async function runSlipwayApplicationActionPlanRetry(input: SlipwayApplicationActionPlanRetryInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_ACTION_PLAN_RETRY_CONFIRMATION_REQUIRED", "application action-plan retry");
  const actionPlan = await authenticatedSlipwayRequest<SlipwayActionPlanResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/action-plan`,
    requestErrorCode: "SLIPWAY_APPLICATION_ACTION_PLAN_RETRY_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application action plan"
  }, options);
  if (!actionPlan.ok) return actionPlan.exitCode;
  if (!actionPlan.response.ok || actionPlan.body?.ok === false) {
    const error = actionPlan.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_ACTION_PLAN_RETRY_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: actionPlan.response.status, reason: actionPlan.body?.reason ?? actionPlan.body?.error, applicationRef: input.applicationRef, decisionId: input.decisionId, slipwayUrl: actionPlan.slipwayUrl, sessionFile: actionPlan.sessionFile }, `Error (${error}): Liskov could not read the action plan for Application ${input.applicationRef}.`);
    return 1;
  }

  const blockingDecision = objectRecord(objectRecord(actionPlan.body).blockingDecision);
  const actions = arrayValue(blockingDecision.actions).map(objectRecord);
  const retryAction = stringValue(blockingDecision.decisionId) === input.decisionId
    ? actions.find((action) => stringValue(action.action) === "retry_all")
    : undefined;
  const href = stringValue(retryAction?.href);
  if (!retryAction || !href) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_ACTION_PLAN_DECISION_NOT_SERVED",
      applicationRef: input.applicationRef,
      decisionId: input.decisionId,
      reason: "action_plan_decision_not_served"
    }, `Error (SLIPWAY_APPLICATION_ACTION_PLAN_DECISION_NOT_SERVED): action-plan decision ${input.decisionId} is no longer served for Application ${input.applicationRef}. Refresh the action plan and retry.`);
    return 1;
  }

  const servedBody = objectRecord(retryAction.body);
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: href,
    body: { ...servedBody, reason: input.reason },
    errorCode: "SLIPWAY_APPLICATION_ACTION_PLAN_RETRY_FAILED",
    fetchFailedMessage: "could not retry Liskov Application action-plan decision",
    human: (body) => {
      const record = objectRecord(body);
      const affected = numberValue(record.affectedReplicaCount) ?? numberValue(record.affectedDeploymentCount);
      const suffix = affected === undefined ? "" : ` (${affected} affected)`;
      return `Retried action-plan decision ${stringValue(record.decisionId) ?? input.decisionId} for ${input.applicationRef}${suffix}.`;
    }
  }, options);
}

export async function runSlipwayApplicationArtifactPinList(input: SlipwayApplicationArtifactPinListInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/artifact-pins`,
    requestErrorCode: "SLIPWAY_APPLICATION_ARTIFACT_PIN_LIST_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application artifact pins"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_ARTIFACT_PIN_LIST_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: request.response.status, reason: body?.reason ?? body?.error, applicationRef: input.applicationRef, slipwayUrl: request.slipwayUrl, sessionFile: request.sessionFile }, `Error (${error}): Liskov could not read artifact pins for Application ${input.applicationRef}.`);
    return 1;
  }
  const pins = body.pins;
  const count = typeof body.count === "number" ? body.count : Array.isArray(pins) ? pins.length : 0;
  writeStructuredOrHuman(options, input.json, body, `${count} artifact pin(s) for ${input.applicationRef}.`);
  return 0;
}

export async function runSlipwayApplicationArtifactPinRestore(input: SlipwayApplicationArtifactPinRestoreInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayJsonRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/artifact-pins/${encodeURIComponent(input.pinId)}/restore`,
    body: withoutUndefinedDeep({ confirm: input.yes === true }),
    requestErrorCode: "SLIPWAY_APPLICATION_ARTIFACT_PIN_RESTORE_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not restore Liskov Application artifact pin"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_ARTIFACT_PIN_RESTORE_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: request.response.status, reason: body?.reason ?? body?.error, applicationRef: input.applicationRef, pinId: input.pinId, slipwayUrl: request.slipwayUrl, sessionFile: request.sessionFile }, `Error (${error}): Liskov could not restore pin ${input.pinId} for Application ${input.applicationRef}.`);
    return 1;
  }
  writeStructuredOrHuman(options, input.json, body, body.dryRun
    ? `Dry run: would restore pin ${input.pinId} for ${input.applicationRef}. Pass --yes to apply.`
    : `Restored pin ${input.pinId} for ${input.applicationRef}.`);
  return 0;
}

export async function runSlipwayApplicationLockboxGrantList(input: SlipwayApplicationLockboxGrantListInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/lockbox/grants`,
    requestErrorCode: "SLIPWAY_APPLICATION_LOCKBOX_GRANT_LIST_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application lockbox grants"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_APPLICATION_LOCKBOX_GRANT_LIST_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: request.response.status, reason: body?.reason ?? body?.error, applicationRef: input.applicationRef, slipwayUrl: request.slipwayUrl, sessionFile: request.sessionFile }, `Error (${error}): Liskov could not read lockbox grants for Application ${input.applicationRef}.`);
    return 1;
  }
  const grants = body.grants;
  const count = typeof body.count === "number" ? body.count : Array.isArray(grants) ? grants.length : 0;
  writeStructuredOrHuman(options, input.json, body, `${count} lockbox grant(s) for ${input.applicationRef}.`);
  return 0;
}

export async function runSlipwayAdminProcessorList(input: SlipwayAdminProcessorListInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/admin/processors${input.greylisted ? "?greylisted=true" : ""}`,
    authToken: resolveAdminToken({ token: input.adminToken, env: options.env ?? process.env }),
    requestErrorCode: "SLIPWAY_ADMIN_PROCESSOR_LIST_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov admin processors"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_ADMIN_PROCESSOR_LIST_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: request.response.status, reason: body?.reason ?? body?.error, slipwayUrl: request.slipwayUrl, sessionFile: request.sessionFile }, `Error (${error}): Liskov could not read admin processors.`);
    return 1;
  }
  const processors = body.processors;
  const total = Array.isArray(processors) ? processors.length : 0;
  const greylistedCount = typeof body.greylistedCount === "number"
    ? body.greylistedCount
    : Array.isArray(processors)
      ? processors.filter((p) => p && typeof p === "object" && (p as { greylisted?: unknown }).greylisted === true).length
      : 0;
  writeStructuredOrHuman(options, input.json, body, `${greylistedCount} of ${total} processor(s) greylisted.`);
  return 0;
}

export async function runSlipwayAdminProcessorClearGreylist(input: SlipwayAdminProcessorClearGreylistInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayJsonRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/admin/processors/${encodeURIComponent(input.processorId)}/clear-greylist`,
    body: withoutUndefinedDeep({ confirm: input.yes === true, reason: input.reason }),
    authToken: resolveAdminToken({ token: input.adminToken, env: options.env ?? process.env }),
    requestErrorCode: "SLIPWAY_ADMIN_PROCESSOR_CLEAR_GREYLIST_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not clear Liskov processor greylist"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_ADMIN_PROCESSOR_CLEAR_GREYLIST_FAILED";
    writeStructuredOrHuman(options, input.json, { ok: false, error, status: request.response.status, reason: body?.reason ?? body?.error, processorId: input.processorId, slipwayUrl: request.slipwayUrl, sessionFile: request.sessionFile }, `Error (${error}): Liskov could not clear the greylist for processor ${input.processorId}.`);
    return 1;
  }
  writeStructuredOrHuman(options, input.json, body, body.dryRun
    ? `Dry run: ${body.wasGreylisted ? "would clear" : "nothing to clear for"} processor ${input.processorId}. Pass --yes to apply.`
    : body.cleared
      ? `Cleared greylist for processor ${input.processorId}.`
      : `No greylist to clear for processor ${input.processorId}.`);
  return 0;
}

export async function runSlipwayAdminExecutorOperationReconcile(
  input: SlipwayAdminExecutorOperationReconcileInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const reason = input.reason?.trim();
  if (!reason) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_ADMIN_EXECUTOR_OPERATION_RECONCILE_REASON_REQUIRED",
      operationId: input.operationId
    }, "Error (SLIPWAY_ADMIN_EXECUTOR_OPERATION_RECONCILE_REASON_REQUIRED): --reason must not be empty.");
    return 1;
  }
  const request = await authenticatedSlipwayJsonRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/admin/executor-operations/${encodeURIComponent(input.operationId)}/reconcile`,
    body: {
      expectApplication: input.expectApplication,
      expectKind: input.expectKind,
      expectDeployment: input.expectDeployment,
      expectJob: input.expectJob,
      expectStatus: input.expectStatus,
      reason,
      confirm: input.yes === true
    },
    authToken: resolveAdminToken({ token: input.adminToken, env: options.env ?? process.env }),
    requestErrorCode: "SLIPWAY_ADMIN_EXECUTOR_OPERATION_RECONCILE_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not reconcile Liskov executor operation"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const blockers = Array.isArray(body?.blockers)
      ? body.blockers.filter((value): value is string => typeof value === "string")
      : [];
    const error = request.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : request.response.status === 403
        ? "SLIPWAY_PLATFORM_ADMIN_REQUIRED"
        : "SLIPWAY_ADMIN_EXECUTOR_OPERATION_RECONCILE_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      blockers,
      operationId: input.operationId,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): executor operation ${input.operationId} is not eligible for reconciliation${blockers.length ? ` (${blockers.join(", ")})` : ""}.`);
    return 1;
  }
  writeStructuredOrHuman(options, input.json, body, body.dryRun
    ? `Dry run: executor operation ${input.operationId} is eligible. Pass --yes to reconcile it.`
    : body.idempotentReplay
      ? `Executor operation ${input.operationId} was already reconciled.`
      : `Reconciled executor operation ${input.operationId}; its unsubmitted placeholder is parked.`);
  return 0;
}

export async function runSlipwayAdminDeploySpendResolve(
  input: SlipwayAdminDeploySpendResolveInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const reason = input.reason?.trim();
  const evidenceRef = input.evidenceRef?.trim();
  const evidenceSha256 = input.evidenceSha256?.trim();
  if (!reason || !evidenceRef || !/^[0-9a-f]{64}$/.test(evidenceSha256 ?? "")
      || !Number.isSafeInteger(input.finalUsdMicros) || input.finalUsdMicros < 0) {
    const error = "SLIPWAY_ADMIN_DEPLOY_SPEND_RESOLVE_INPUT_INVALID";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      reserveId: input.reserveId
    }, `Error (${error}): reason/evidence are required, evidence SHA-256 must be lowercase hex, and final USD micros must be a non-negative safe integer.`);
    return 1;
  }
  const request = await authenticatedSlipwayJsonRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/admin/billing/deploy-spend/${encodeURIComponent(input.reserveId)}/resolve`,
    body: {
      expectOrganization: input.expectOrganization,
      expectApplication: input.expectApplication,
      expectDeployment: input.expectDeployment,
      expectExecution: input.expectExecution,
      expectBillingTransaction: input.expectBillingTransaction,
      expectStatus: input.expectStatus,
      finalUsdMicros: input.finalUsdMicros,
      evidenceRef,
      evidenceSha256,
      reason,
      confirm: input.yes === true
    },
    authToken: resolveAdminToken({ token: input.adminToken, env: options.env ?? process.env }),
    requestErrorCode: "SLIPWAY_ADMIN_DEPLOY_SPEND_RESOLVE_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not resolve Liskov deploy-spend review"
  }, options);
  if (!request.ok) return request.exitCode;
  const body = request.body;
  if (body?.ok !== true) {
    const blockers = Array.isArray(body?.blockers)
      ? body.blockers.filter((value): value is string => typeof value === "string")
      : [];
    const error = request.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : request.response.status === 403
        ? "SLIPWAY_PLATFORM_ADMIN_REQUIRED"
        : "SLIPWAY_ADMIN_DEPLOY_SPEND_RESOLVE_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      blockers,
      reserveId: input.reserveId,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): deploy-spend reserve ${input.reserveId} is not eligible${blockers.length ? ` (${blockers.join(", ")})` : ""}.`);
    return 1;
  }
  writeStructuredOrHuman(options, input.json, body, body.dryRun
    ? `Dry run: deploy-spend reserve ${input.reserveId} is eligible. Pass --yes to resolve it.`
    : body.idempotentReplay
      ? `Deploy-spend reserve ${input.reserveId} was already resolved identically.`
      : `Resolved deploy-spend reserve ${input.reserveId} at ${input.finalUsdMicros} USD micros.`);
  return 0;
}

export async function runSlipwayApplicationRuntimeImageWorkflow(
  input: SlipwayApplicationRuntimeImageWorkflowInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const output = path.resolve(input.output ?? DEFAULT_RUNTIME_IMAGE_WORKFLOW_OUTPUT);
  if (!input.yes && await fileExists(output)) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_RUNTIME_IMAGE_WORKFLOW_EXISTS",
      message: `Refusing to overwrite ${output}; pass --yes to replace it.`,
      output
    }, `Error (SLIPWAY_RUNTIME_IMAGE_WORKFLOW_EXISTS): ${output} already exists. Pass --yes to overwrite it.`);
    return 1;
  }

  const workflowPath = workflowPathForOutput(output);
  const workflow = renderRuntimeImageWorkflow({
    applicationRef: input.applicationRef,
    liskovUrl: normalizeBaseUrl(input.liskovUrl ?? DEFAULT_SLIPWAY_URL),
    oidcAudience: input.oidcAudience ?? DEFAULT_RUNTIME_IMAGE_OIDC_AUDIENCE,
    workflowName: input.workflowName ?? DEFAULT_RUNTIME_IMAGE_WORKFLOW_NAME
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, workflow, { encoding: "utf8", mode: 0o644 });

  const value = {
    ok: true,
    applicationRef: input.applicationRef,
    output,
    workflowPath,
    workflowName: input.workflowName ?? DEFAULT_RUNTIME_IMAGE_WORKFLOW_NAME,
    liskovUrl: normalizeBaseUrl(input.liskovUrl ?? DEFAULT_SLIPWAY_URL),
    oidcAudience: input.oidcAudience ?? DEFAULT_RUNTIME_IMAGE_OIDC_AUDIENCE,
    uploadSessionRoute: `/api/applications/${encodeURIComponent(input.applicationRef)}/runtime-images/upload-session`,
    finalizeRoute: `/api/applications/${encodeURIComponent(input.applicationRef)}/runtime-images/upload-sessions/:sessionId/finalize`,
    policyWorkflowRefHint: `<owner>/<repo>/${workflowPath}@refs/heads/<branch>`
  };
  writeStructuredOrHuman(
    options,
    input.json,
    value,
    `Wrote Liskov runtime-image upload workflow to ${output}. Configure runtimeImageAutomation.github to allow the repository/ref, and workflowRef ${value.policyWorkflowRefHint} if the policy pins workflowRef.`
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
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application Lockbox grant status"
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
    }, `Error (${error}): Liskov could not read Lockbox grant status for Application ${input.applicationId}.`);
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

export async function runSlipwayApplicationDeploymentImport(input: SlipwayApplicationDeploymentImportInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_DEPLOYMENT_IMPORT_CONFIRMATION_REQUIRED", "deployment import");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_DEPLOYMENT_IMPORT_SEQUENCE_INVALID",
      message: "--sequence must be a non-negative integer."
    }, "Error (SLIPWAY_APPLICATION_DEPLOYMENT_IMPORT_SEQUENCE_INVALID): --sequence must be a non-negative integer.");
    return 1;
  }
  const origin = { acurast: input.origin };
  const result = await runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/deployments/imports`,
    body: {
      acurastJobRef: {
        origin,
        sequence: input.sequence,
        canonicalJobId: JSON.stringify([origin, input.sequence])
      },
      deploymentId: input.deploymentId,
      replicaIndex: input.replicaIndex,
      processorId: input.processor,
      gatewayId: input.gatewayId,
      endpointHostname: input.endpointHostname
    },
    errorCode: "SLIPWAY_APPLICATION_DEPLOYMENT_IMPORT_FAILED",
    fetchFailedMessage: "could not import Liskov Application deployment",
    human: (body) => {
      const child = objectRecord(objectRecord(body).child);
      return `Imported deployment ${input.deploymentId ?? String(input.sequence)} for ${input.applicationRef}; child ${stringValue(child.childSessionId) ?? "recorded"}.`;
    }
  }, options);
  return result;
}

export async function runSlipwayApplicationLockboxSetupPr(input: SlipwayApplicationLockboxSetupPrInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_LOCKBOX_SETUP_PR_CONFIRMATION_REQUIRED", "Lockbox setup PR");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/lockbox/workflow-pr`,
    body: { baseRef: input.baseRef },
    errorCode: "SLIPWAY_APPLICATION_LOCKBOX_SETUP_PR_FAILED",
    fetchFailedMessage: "could not create Liskov Lockbox setup PR",
    human: (body) => {
      const setup = objectRecord(objectRecord(body).setup);
      const pullRequest = objectRecord(setup.pullRequest);
      return `Lockbox setup PR ${stringValue(pullRequest.url) ?? stringValue(setup.status) ?? "ready"} for ${input.applicationRef}.`;
    }
  }, options);
}

export async function runSlipwayApplicationLockboxDispatch(input: SlipwayApplicationLockboxDispatchInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_LOCKBOX_DISPATCH_CONFIRMATION_REQUIRED", "Lockbox workflow dispatch");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/lockbox/workflow-dispatch`,
    body: { ref: input.ref },
    errorCode: "SLIPWAY_APPLICATION_LOCKBOX_DISPATCH_FAILED",
    fetchFailedMessage: "could not dispatch Liskov Lockbox workflow",
    human: (body) => {
      const dispatch = objectRecord(objectRecord(body).dispatch);
      return `Lockbox dispatch ${stringValue(dispatch.dispatchId) ?? "submitted"} ${stringValue(dispatch.status) ?? "ready"} for ${input.applicationRef}.`;
    }
  }, options);
}

export async function runSlipwayApplicationLockboxGrantEnsure(input: SlipwayApplicationLockboxGrantEnsureInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_LOCKBOX_GRANT_ENSURE_CONFIRMATION_REQUIRED", "Lockbox grant ensure");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/lockbox/grants`,
    body: {},
    errorCode: "SLIPWAY_APPLICATION_LOCKBOX_GRANT_ENSURE_FAILED",
    fetchFailedMessage: "could not ensure Liskov Lockbox grant",
    human: (body) => {
      const grant = objectRecord(objectRecord(body).grant);
      return `Lockbox grant ${stringValue(grant.grantId) ?? "recorded"} ${stringValue(grant.status) ?? "ready"} for ${input.applicationRef}.`;
    }
  }, options);
}

export async function runSlipwayApplicationLockboxGrantVerify(input: SlipwayApplicationLockboxGrantVerifyInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_LOCKBOX_GRANT_VERIFY_CONFIRMATION_REQUIRED", "Lockbox grant verify");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/lockbox/grants/${encodeURIComponent(input.grantId)}/verify`,
    body: {},
    errorCode: "SLIPWAY_APPLICATION_LOCKBOX_GRANT_VERIFY_FAILED",
    fetchFailedMessage: "could not verify Liskov Lockbox grant",
    human: (body) => {
      const grant = objectRecord(objectRecord(body).grant);
      return `Lockbox grant ${stringValue(grant.grantId) ?? input.grantId} ${stringValue(grant.status) ?? "verified"} for ${input.applicationRef}.`;
    }
  }, options);
}

export async function runSlipwayApplicationBlackboxConfigure(input: SlipwayApplicationBlackboxConfigureInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_BLACKBOX_CONFIGURE_CONFIRMATION_REQUIRED", "Blackbox configuration");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/blackbox/configurations`,
    body: {},
    errorCode: "SLIPWAY_APPLICATION_BLACKBOX_CONFIGURE_FAILED",
    fetchFailedMessage: "could not configure Liskov Blackbox",
    human: (body) => {
      const configuration = objectRecord(objectRecord(body).configuration);
      return `Blackbox configuration ${stringValue(configuration.configurationId) ?? "recorded"} for ${input.applicationRef}.`;
    }
  }, options);
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
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not import Liskov Application policy"
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
    }, `Error (${error}): Liskov could not import the Application policy.`);
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

export async function runSlipwayCustodyAccountEnsure(input: SlipwayCustodyAccountEnsureInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_ACCOUNT_ENSURE_CONFIRMATION_REQUIRED", "custody account ensure");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/account`,
    body: { chain: input.chain },
    errorCode: "SLIPWAY_CUSTODY_ACCOUNT_ENSURE_FAILED",
    fetchFailedMessage: "could not ensure Liskov live custody account",
    human: (body) => {
      const account = objectRecord(objectRecord(body).account);
      return `${input.applicationRef} ${stringValue(account.chain) ?? input.chain} custody account ${stringValue(account.address) ?? stringValue(account.accountRef) ?? "ready"}.`;
    }
  }, options);
}

export async function runSlipwayCustodyPreflight(input: SlipwayCustodyPreflightInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayLiveCustodyCommandResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/preflight`,
    requestErrorCode: "SLIPWAY_CUSTODY_PREFLIGHT_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov live custody preflight"
  }, options);
  if (!request.ok) return request.exitCode;
  return writeCommandResponse({
    body: request.body,
    response: request.response,
    errorCode: "SLIPWAY_CUSTODY_PREFLIGHT_FAILED",
    json: input.json,
    human: (body) => {
      const actionPlan = objectRecord(objectRecord(body).actionPlan);
      const count = numberValue(actionPlan.count) ?? arrayValue(actionPlan.items).length;
      const selectionInstruction = count > 0
        ? " Run preflight with --json, then copy both planItemId and the opaque idempotencyKey from the same custodial.live actionPlan item."
        : "";
      const reclaim = objectRecord(objectRecord(body).reclaim);
      const candidateCount = numberValue(reclaim.candidateCount);
      if (candidateCount === undefined) return `${count} live custody plan item(s) for ${input.applicationRef}.${selectionInstruction}`;
      const reclaimableCount = numberValue(reclaim.reclaimableCount) ?? 0;
      const blockedCount = numberValue(reclaim.blockedCount) ?? 0;
      const failedCount = numberValue(reclaim.failedCount) ?? 0;
      const alreadyReclaimedCount = numberValue(reclaim.alreadyReclaimedCount) ?? 0;
      const alreadyDeregisteredCount = numberValue(reclaim.alreadyDeregisteredCount) ?? 0;
      const skippedByLimitCount = numberValue(reclaim.skippedByLimitCount) ?? 0;
      return `${count} live custody plan item(s) for ${input.applicationRef}. Reclaim: ${candidateCount} candidate(s), ${reclaimableCount} reclaimable, ${blockedCount} blocked, ${failedCount} failed, ${alreadyReclaimedCount} already reclaimed, ${alreadyDeregisteredCount} already deregistered, ${skippedByLimitCount} skipped by limit.${selectionInstruction}`;
    },
    options
  });
}

export async function runSlipwayCustodyPair(input: SlipwayCustodyPairInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayJsonRequest<SlipwayCustodyPairingTokenResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/custody/signer/pairing-token`,
    body: {},
    requestErrorCode: "SLIPWAY_CUSTODY_PAIR_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not issue Liskov self-custody signer pairing token"
  }, options);
  if (!request.ok) return request.exitCode;

  const body = request.body;
  const pairingToken = stringValue(body?.pairingToken);
  if (!request.response.ok || body?.ok !== true || !pairingToken) {
    const error = request.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : "SLIPWAY_CUSTODY_PAIR_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: body?.reason ?? body?.error,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Liskov could not issue a self-custody signer pairing token.`);
    return 1;
  }

  const controlPlaneUrl = signerControlPlaneUrl(request.slipwayUrl);
  const websocketUrl = signerWebsocketUrl(request.slipwayUrl, body.websocketPath, pairingToken);
  const signerCommand = `liskov-self-custody-signer --control-plane-url ${shellQuote(controlPlaneUrl)} --pairing-token ${shellQuote(pairingToken)}`;
  const output = {
    ...body,
    controlPlaneUrl,
    websocketUrl,
    signerCommand
  };
  const expiresAtMs = numberValue(body.expiresAtMs);
  const expiresAt = expiresAtMs === undefined ? "unknown" : new Date(expiresAtMs).toISOString();
  writeStructuredOrHuman(
    options,
    input.json,
    output,
    [
      `Issued self-custody signer pairing token for ${stringValue(body.applicationId) ?? input.applicationRef}.`,
      `Control plane: ${controlPlaneUrl}`,
      `Expires at: ${expiresAt}`,
      `Run signer: ${signerCommand}`
    ].join("\n")
  );
  return 0;
}

export async function runSlipwayCustodyEnvironmentUpload(input: SlipwayCustodyEnvironmentUploadInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_ENVIRONMENT_UPLOAD_CONFIRMATION_REQUIRED", "custody environment upload");
  const prepared = await prepareEnvironmentHandoffs(input, options);
  if (!prepared.ok) return prepared.exitCode;
  const uploads: unknown[] = [];
  for (const handoff of prepared.handoffs) {
    const request = await authenticatedSlipwayJsonRequest<SlipwayLiveCustodyCommandResponse>({
      config: input.config,
      slipwayUrl: input.slipwayUrl,
      json: input.json,
      method: "POST",
      path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/environment-handoffs`,
      body: { environmentHandoff: handoff },
      requestErrorCode: "SLIPWAY_CUSTODY_ENVIRONMENT_UPLOAD_FAILED",
      notFoundMessage: "No Liskov CLI session is stored locally.",
      fetchFailedMessage: "could not upload Liskov live custody environment handoff"
    }, options);
    if (!request.ok) return request.exitCode;
    if (request.body?.ok !== true) {
      return writeCommandResponse({
        body: request.body,
        response: request.response,
        errorCode: "SLIPWAY_CUSTODY_ENVIRONMENT_UPLOAD_FAILED",
        json: input.json,
        human: () => `Error (SLIPWAY_CUSTODY_ENVIRONMENT_UPLOAD_FAILED): Liskov could not upload environment handoff for ${input.applicationRef}.`,
        options
      });
    }
    uploads.push(request.body);
  }
  writeStructuredOrHuman(options, input.json, {
    ok: true,
    applicationId: input.applicationRef,
    count: uploads.length,
    uploads
  }, `Uploaded ${uploads.length} live custody environment handoff(s) for ${input.applicationRef}.`);
  return 0;
}

export async function runSlipwayCustodyExecutionList(input: SlipwayCustodyExecutionListInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayLiveCustodyCommandResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions`,
    requestErrorCode: "SLIPWAY_CUSTODY_EXECUTION_LIST_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not list Liskov live custody executions"
  }, options);
  if (!request.ok) return request.exitCode;
  return writeCommandResponse({
    body: request.body,
    response: request.response,
    errorCode: "SLIPWAY_CUSTODY_EXECUTION_LIST_FAILED",
    json: input.json,
    human: (body) => `${arrayValue(objectRecord(body).attempts).length} live custody execution(s) for ${input.applicationRef}.`,
    options
  });
}

export async function runSlipwayCustodyExecutionSubmit(input: SlipwayCustodyExecutionSubmitInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_EXECUTION_SUBMIT_CONFIRMATION_REQUIRED", "custody execution submit");
  if (!input.yesSpend) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_EXECUTION_SUBMIT_SPEND_CONFIRMATION_REQUIRED", "custody execution submit spend", "--yes-spend");
  const body: Record<string, unknown> = {
    planItemId: input.planItemId,
    idempotencyKey: input.idempotencyKey,
    yesSpend: true,
    acknowledgement: "yes-spend"
  };
  if (input.secretsFile) {
    const prepared = await prepareEnvironmentHandoffs({
      applicationRef: input.applicationRef,
      secretsFile: input.secretsFile,
      repoDir: input.repoDir,
      network: input.network,
      rpcUrl: input.rpcUrl,
      config: input.config,
      slipwayUrl: input.slipwayUrl,
      json: input.json
    }, options, input.planItemId);
    if (!prepared.ok) return prepared.exitCode;
    if (prepared.handoffs.length > 0) body.environmentHandoff = prepared.handoffs[0];
  }
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions`,
    body,
    errorCode: "SLIPWAY_CUSTODY_EXECUTION_SUBMIT_FAILED",
    fetchFailedMessage: "could not submit Liskov live custody execution",
    human: (responseBody) => {
      const attempt = objectRecord(objectRecord(responseBody).attempt);
      return `Submitted live custody execution ${stringValue(attempt.executionId) ?? input.planItemId} ${stringValue(attempt.status) ?? ""}`.trim();
    }
  }, options);
}

export async function runSlipwayCustodyExecutionObserve(input: SlipwayCustodyExecutionObserveInput, options: SlipwayCliOptions = {}): Promise<number> {
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions/${encodeURIComponent(input.executionId)}/observe`,
    body: {},
    errorCode: "SLIPWAY_CUSTODY_EXECUTION_OBSERVE_FAILED",
    fetchFailedMessage: "could not observe Liskov live custody execution",
    human: (body) => {
      const attempt = objectRecord(objectRecord(body).attempt);
      return `Observed live custody execution ${stringValue(attempt.executionId) ?? input.executionId}: ${stringValue(attempt.status) ?? "updated"}.`;
    }
  }, options);
}

export async function runSlipwayCustodyExecutionRunOne(input: SlipwayCustodyExecutionRunOneInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_CONFIRMATION_REQUIRED", "custody execution run-one");
  const observeMode = input.executionId !== undefined;
  const submitMode = input.planItemId !== undefined || input.idempotencyKey !== undefined;
  if (observeMode === submitMode) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_MODE_REQUIRED",
      message: "custody execution run-one requires either --execution-id or --plan-item-id with --idempotency-key."
    }, "Error (SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_MODE_REQUIRED): provide either --execution-id or --plan-item-id with --idempotency-key.");
    return 1;
  }
  const body: Record<string, unknown> = {
    expectedKind: input.expectKind,
    expectedPolicyDigest: input.expectPolicyDigest,
    expectedDeploymentId: input.expectDeploymentId,
    yes: true,
    acknowledgement: "run-one"
  };
  if (observeMode) {
    body.executionId = input.executionId;
  } else {
    if (!input.planItemId || !input.idempotencyKey) {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_SUBMIT_ID_REQUIRED",
        message: "custody execution run-one submit requires --plan-item-id and --idempotency-key."
      }, "Error (SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_SUBMIT_ID_REQUIRED): submit mode requires --plan-item-id and --idempotency-key.");
      return 1;
    }
    if (!input.yesSpend) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_SPEND_CONFIRMATION_REQUIRED", "custody execution run-one spend", "--yes-spend");
    if (input.secretsFile !== undefined && input.expectKind !== "acurast.setEnvironment") {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_SECRETS_UNSUPPORTED",
        message: "--secrets-file is only supported for acurast.setEnvironment run-one submit."
      }, "Error (SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_SECRETS_UNSUPPORTED): --secrets-file is only supported for acurast.setEnvironment submit.");
      return 1;
    }
    const preflight = await selectFreshRunOnePlanItem(input, options);
    if (!preflight.ok) return preflight.exitCode;
    body.planItemId = preflight.planItemId;
    body.idempotencyKey = preflight.idempotencyKey;
    body.yesSpend = true;
    body.spendAcknowledgement = "yes-spend";
    if (input.secretsFile !== undefined) {
      const prepared = await prepareEnvironmentHandoffs({
        applicationRef: input.applicationRef,
        secretsFile: input.secretsFile,
        repoDir: input.repoDir,
        network: input.network,
        rpcUrl: input.rpcUrl,
        config: input.config,
        slipwayUrl: input.slipwayUrl,
        json: input.json
      }, options, preflight.planItemId);
      if (!prepared.ok) return prepared.exitCode;
      if (prepared.handoffs.length > 0) body.environmentHandoff = prepared.handoffs[0];
    }
  }
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions/run-one`,
    body,
    errorCode: "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_FAILED",
    fetchFailedMessage: "could not run one Liskov live custody execution",
    human: (responseBody) => {
      const bodyRecord = objectRecord(responseBody);
      const attempt = objectRecord(bodyRecord.attempt);
      const receipt = objectRecord(attempt.receipt);
      const executionId = stringValue(attempt.executionId) ?? input.executionId ?? input.planItemId ?? "unknown";
      const status = stringValue(attempt.status) ?? "updated";
      const deploymentId = stringValue(receipt.deploymentId);
      const outcome = stringValue(bodyRecord.waiting) ?? (bodyRecord.recovered === true ? "recovered" : stringValue(bodyRecord.mode) ?? (bodyRecord.replayed === true ? "replayed" : "run"));
      const deployment = deploymentId ? ` deployment ${deploymentId}` : "";
      return `Run-one ${executionId}: ${status}${deployment} (${outcome}).`;
    }
  }, options);
}

type FreshRunOnePlanSelection =
  | { ok: true; planItemId: string; idempotencyKey: string }
  | { ok: false; exitCode: number };

async function selectFreshRunOnePlanItem(
  input: SlipwayCustodyExecutionRunOneInput & { planItemId?: string; idempotencyKey?: string },
  options: SlipwayCliOptions
): Promise<FreshRunOnePlanSelection> {
  const fail = (reason: string, status?: number): FreshRunOnePlanSelection => {
    const message = `Could not read a fresh authorized live custody preflight for ${input.applicationRef}; verify the saved session and UID-scoped access, then retry.`;
    const output: Record<string, unknown> = {
      ok: false,
      error: "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_PREFLIGHT_FAILED",
      reason,
      message
    };
    if (status !== undefined) output.status = status;
    writeStructuredOrHuman(
      options,
      input.json,
      output,
      `Error (SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_PREFLIGHT_FAILED): ${message} (${reason})`
    );
    return { ok: false, exitCode: 1 };
  };
  const reject = (reason: string, details: Record<string, unknown> = {}): FreshRunOnePlanSelection => {
    const message = `Fresh preflight rejected run-one submit; run \`proof liskov custody preflight ${input.applicationRef} --json\` and copy planItemId plus the opaque idempotencyKey from the same custodial.live item.`;
    writeStructuredOrHuman(
      options,
      input.json,
      {
        ok: false,
        error: "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_PREFLIGHT_REJECTED",
        reason,
        message,
        ...details
      },
      `Error (SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_PREFLIGHT_REJECTED): ${message} (${reason})`
    );
    return { ok: false, exitCode: 1 };
  };

  const env = options.env ?? process.env;
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env });
  let saved: SlipwaySessionFile | undefined;
  try {
    saved = await readSlipwaySession(sessionFile);
  } catch {
    return fail("session_read_failed");
  }
  if (!saved) return fail("session_not_found");

  const slipwayUrl = normalizeBaseUrl(input.slipwayUrl ?? saved.slipwayUrl);
  let response: Response;
  let preflight: SlipwayLiveCustodyCommandResponse | undefined;
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL(`/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/preflight`, slipwayUrl),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${saved.sessionToken}`
        }
      }
    );
    preflight = await readJsonResponse<SlipwayLiveCustodyCommandResponse>(response);
  } catch {
    return fail("preflight_read_failed");
  }
  if (!response.ok || preflight?.ok !== true) {
    return fail(stringValue(preflight?.reason) ?? stringValue(preflight?.error) ?? "preflight_request_failed", response.status);
  }

  const actionPlan = preflight.actionPlan;
  if (!actionPlan || typeof actionPlan !== "object" || Array.isArray(actionPlan)) {
    return reject("invalid_live_custody_preflight", { field: "actionPlan" });
  }
  const items = (actionPlan as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    return reject("invalid_live_custody_preflight", { field: "actionPlan.items" });
  }
  const liveItems = items
    .map((item) => objectRecord(item))
    .filter((item) => item.executorMode === "custodial.live");
  const malformedCount = liveItems.filter((item) =>
    !nonEmptyOpaqueString(item.planItemId)
    || !nonEmptyOpaqueString(item.idempotencyKey)
    || !nonEmptyOpaqueString(item.kind)
    || !nonEmptyOpaqueString(item.policyDigest)
    || !Array.isArray(item.blockers)
  ).length;
  if (malformedCount > 0) {
    return reject("invalid_live_custody_plan_item", {
      field: "actionPlan.items",
      malformedCount,
      livePlanCount: liveItems.length
    });
  }

  const planItemId = input.planItemId!;
  const idempotencyKey = input.idempotencyKey!;
  const exact = liveItems.filter((item) => item.planItemId === planItemId && item.idempotencyKey === idempotencyKey);
  let selected: Record<string, unknown> | undefined;
  if (exact.length === 1) {
    selected = exact[0];
  } else if (exact.length > 1) {
    return reject("live_custody_run_one_ambiguous_plan_item", { matches: exact.length });
  } else {
    const planItemMatches = liveItems.filter((item) => item.planItemId === planItemId);
    const idempotencyMatches = liveItems.filter((item) => item.idempotencyKey === idempotencyKey);
    if (planItemMatches.length === 0 && idempotencyMatches.length === 1) {
      selected = idempotencyMatches[0];
    } else if (planItemMatches.length === 0 && idempotencyMatches.length > 1) {
      return reject("live_custody_run_one_ambiguous_plan_item", { matches: idempotencyMatches.length });
    } else if (planItemMatches.length > 0 || idempotencyMatches.length > 0) {
      return reject("live_custody_run_one_plan_guard_mismatch", {
        planItemMatches: planItemMatches.length,
        idempotencyMatches: idempotencyMatches.length
      });
    } else {
      return reject("plan_item_not_found", { planItemMatches: 0, idempotencyMatches: 0 });
    }
  }

  const guardMismatch = (field: string, expected: unknown, actual: unknown): FreshRunOnePlanSelection =>
    reject("live_custody_run_one_guard_mismatch", { field, expected, actual });
  if (selected.kind !== input.expectKind) return guardMismatch("kind", input.expectKind, selected.kind);
  if (selected.policyDigest !== input.expectPolicyDigest) {
    return guardMismatch("policyDigest", input.expectPolicyDigest, selected.policyDigest);
  }
  if (input.expectDeploymentId !== undefined) {
    const actualDeploymentId = liveCustodyPlanItemDeploymentId(selected);
    if (actualDeploymentId !== input.expectDeploymentId) {
      return guardMismatch("deploymentId", input.expectDeploymentId, actualDeploymentId ?? null);
    }
  }
  const blockers = selected.blockers as unknown[];
  if (blockers.length > 0) {
    return reject("live_custody_plan_blocked", { field: "blockers", blockerCount: blockers.length });
  }

  return {
    ok: true,
    planItemId: selected.planItemId as string,
    idempotencyKey: selected.idempotencyKey as string
  };
}

function nonEmptyOpaqueString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function liveCustodyPlanItemDeploymentId(item: Record<string, unknown>): string | undefined {
  const callSummary = objectRecord(item.callSummary);
  return stringValue(callSummary.deploymentId)
    ?? stringValue(objectRecord(callSummary.job).deploymentId)
    ?? stringValue(objectRecord(item.expectedObservation).deploymentId);
}

export async function runSlipwayCustodyExecutionDiagnose(input: SlipwayCustodyExecutionDiagnoseInput, options: SlipwayCliOptions = {}): Promise<number> {
  const query = new URLSearchParams();
  if (input.network) query.set("network", normalizeNetworkFlag(input.network));
  const suffix = query.toString();
  const request = await authenticatedSlipwayRequest<SlipwayLiveCustodyCommandResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions/${encodeURIComponent(input.executionId)}/diagnosis${suffix ? `?${suffix}` : ""}`,
    requestErrorCode: "SLIPWAY_CUSTODY_EXECUTION_DIAGNOSE_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not diagnose Liskov live custody execution"
  }, options);
  if (!request.ok) return request.exitCode;
  return writeCommandResponse({
    body: request.body,
    response: request.response,
    errorCode: "SLIPWAY_CUSTODY_EXECUTION_DIAGNOSE_FAILED",
    json: input.json,
    human: (body) => formatSlipwayAcurastDiagnosisHuman(input.applicationRef, input.executionId, body),
    options
  });
}

function formatSlipwayAcurastDiagnosisHuman(applicationRef: string, executionId: string, body: unknown): string {
  const record = objectRecord(body);
  const classification = stringValue(record.classification) ?? "unknown";
  const dossier = objectRecord(record.dossier);
  const evaluator = objectRecord(dossier.evaluator);
  const assignmentRows = objectRecord(record.assignmentRows);
  const attempt = objectRecord(record.attempt);
  const deploymentId = stringValue(attempt.deploymentId);
  const parts = [`${applicationRef} ${executionId} Acurast job diagnosis: ${classification}.`];
  const dossierClassification = stringValue(evaluator.classification);
  const replacementRisk = stringValue(evaluator.replacementRisk);
  if (dossierClassification || replacementRisk) {
    parts.push(`Dossier: ${dossierClassification ?? "unclassified"}${replacementRisk ? `, replacement risk ${replacementRisk}` : ""}.`);
  }
  const assignedProcessorsCount = numberValue(assignmentRows.assignedProcessorsCount);
  const storedMatchesCount = numberValue(assignmentRows.storedMatchesCount);
  const storedMatchesWithRequiredKeys = numberValue(assignmentRows.storedMatchesWithRequiredKeys);
  if (deploymentId || assignedProcessorsCount !== undefined || storedMatchesCount !== undefined || storedMatchesWithRequiredKeys !== undefined) {
    parts.push(`Deployment ${deploymentId ?? "unknown"} assignment rows: assigned ${assignedProcessorsCount ?? "?"}, stored matches ${storedMatchesCount ?? "?"}, required keys ${storedMatchesWithRequiredKeys ?? "?"}.`);
  }
  const recommendation = stringValue(evaluator.recommendation);
  if (recommendation) parts.push(`Recommendation: ${recommendation}.`);
  return parts.join(" ");
}

export async function runSlipwayCustodyExecutionRecover(input: SlipwayCustodyExecutionRecoverInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_EXECUTION_RECOVER_CONFIRMATION_REQUIRED", "custody execution recover");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions/${encodeURIComponent(input.executionId)}/recover`,
    body: { yesRecover: true, acknowledgement: "operator-reviewed", reason: input.reason, mode: input.mode },
    errorCode: "SLIPWAY_CUSTODY_EXECUTION_RECOVER_FAILED",
    fetchFailedMessage: "could not recover Liskov live custody execution",
    human: (body) => {
      const attempt = objectRecord(objectRecord(body).attempt);
      return `Recovered live custody execution ${stringValue(attempt.executionId) ?? input.executionId}: ${stringValue(attempt.status) ?? "reviewed"}.`;
    }
  }, options);
}

export async function runSlipwayCustodyExecutionRetry(input: SlipwayCustodyExecutionRetryInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_EXECUTION_RETRY_CONFIRMATION_REQUIRED", "custody execution retry");
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions/${encodeURIComponent(input.executionId)}/recover`,
    body: { yesRecover: true, acknowledgement: "operator-reviewed", reason: input.reason, mode: "retry" },
    errorCode: "SLIPWAY_CUSTODY_EXECUTION_RETRY_FAILED",
    fetchFailedMessage: "could not retry Liskov live custody execution",
    human: (body) => {
      const attempt = objectRecord(objectRecord(body).attempt);
      return `Retried live custody execution ${stringValue(attempt.executionId) ?? input.executionId}: ${stringValue(attempt.status) ?? "reviewed"}.`;
    }
  }, options);
}

export async function runSlipwayCustodyMachineCatalog(input: SlipwayCustodyMachineCatalogInput, options: SlipwayCliOptions = {}): Promise<number> {
  const query = new URLSearchParams();
  if (input.network) query.set("network", normalizeNetworkFlag(input.network));
  const suffix = query.toString();
  const request = await authenticatedSlipwayRequest<SlipwayLiveCustodyCommandResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/live-custody/machine-catalog${suffix ? `?${suffix}` : ""}`,
    requestErrorCode: "SLIPWAY_CUSTODY_MACHINE_CATALOG_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Acurast machine catalog"
  }, options);
  if (!request.ok) return request.exitCode;
  return writeCommandResponse({
    body: request.body,
    response: request.response,
    errorCode: "SLIPWAY_CUSTODY_MACHINE_CATALOG_FAILED",
    json: input.json,
    human: (body) => `${arrayValue(objectRecord(body).classes).length} Acurast machine class(es).`,
    options
  });
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
  }, saved ? `Logged out from ${saved.slipwayUrl}.` : "No Liskov CLI session was stored locally.");
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
  return path.join(configHome, "proof", "liskov", "session.json");
}

/**
 * Resolve the bearer token for an admin (`/api/admin/*`) request: an explicit
 * `--admin-token` flag, else `PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN`, else `undefined`
 * so the caller falls back to the saved session token (a platform-admin GitHub
 * session also satisfies the backend admin gate).
 */
export function resolveAdminToken(input: { token?: string; env?: NodeJS.ProcessEnv } = {}): string | undefined {
  const env = input.env ?? process.env;
  const token = input.token ?? env.PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function workflowPathForOutput(output: string): string {
  return path.relative(process.cwd(), output).split(path.sep).join("/");
}

function yamlSingleQuoted(value: string): string {
  if (/[\r\n]/u.test(value)) throw new Error("Workflow scalar values must not contain newlines");
  return `'${value.replace(/'/gu, "''")}'`;
}

function renderRuntimeImageWorkflow(input: {
  applicationRef: string;
  liskovUrl: string;
  oidcAudience: string;
  workflowName: string;
}): string {
  return [
    `name: ${yamlSingleQuoted(input.workflowName)}`,
    "",
    "\"on\":",
    "  workflow_dispatch:",
    "    inputs:",
    "      image_url:",
    `        description: ${yamlSingleQuoted("Pinned upstream PRoot image URL to upload unchanged")}`,
    "        required: true",
    "        type: string",
    "      expected_sha256:",
    `        description: ${yamlSingleQuoted("Optional sha256 digest, with or without sha256: prefix")}`,
    "        required: false",
    "        type: string",
    "",
    "permissions:",
    "  contents: read",
    "  id-token: write",
    "",
    "jobs:",
    "  upload-runtime-image:",
    "    runs-on: ubuntu-latest",
    "    env:",
    `      LISKOV_URL: ${yamlSingleQuoted(input.liskovUrl)}`,
    `      LISKOV_APPLICATION_REF: ${yamlSingleQuoted(input.applicationRef)}`,
    `      LISKOV_OIDC_AUDIENCE: ${yamlSingleQuoted(input.oidcAudience)}`,
    "    steps:",
    "      - name: Check upload tools",
    "        shell: bash",
    "        run: |",
    "          set -euo pipefail",
    "          command -v aws >/dev/null",
    "          command -v curl >/dev/null",
    "          command -v node >/dev/null",
    "          command -v sha256sum >/dev/null",
    "",
    "      - name: Download runtime image",
    "        id: image",
    "        shell: bash",
    "        env:",
    "          LISKOV_RUNTIME_IMAGE_URL: ${{ inputs.image_url }}",
    "          LISKOV_EXPECTED_SHA256: ${{ inputs.expected_sha256 }}",
    "        run: |",
    "          set -euo pipefail",
    "          image_path=\"$RUNNER_TEMP/liskov-runtime-image.tar.zst\"",
    "          curl --fail --location --show-error --silent --output \"$image_path\" \"$LISKOV_RUNTIME_IMAGE_URL\"",
    "          expected=\"${LISKOV_EXPECTED_SHA256#sha256:}\"",
    "          expected=\"${expected#SHA256:}\"",
    "          expected=\"$(printf '%s' \"$expected\" | tr '[:upper:]' '[:lower:]')\"",
    "          if [ -n \"$expected\" ]; then",
    "            printf '%s  %s\\n' \"$expected\" \"$image_path\" | sha256sum --check --strict",
    "          fi",
    "          digest=\"sha256:$(sha256sum \"$image_path\" | awk '{print $1}')\"",
    "          byte_size=\"$(stat -c '%s' \"$image_path\")\"",
    "          printf 'image_path=%s\\n' \"$image_path\" >> \"$GITHUB_OUTPUT\"",
    "          printf 'digest=%s\\n' \"$digest\" >> \"$GITHUB_OUTPUT\"",
    "          printf 'byte_size=%s\\n' \"$byte_size\" >> \"$GITHUB_OUTPUT\"",
    "",
    "      - name: Create Liskov upload session and upload runtime image",
    "        id: upload_session",
    "        shell: bash",
    "        run: |",
    "          set -euo pipefail",
    "          workflow_escape() {",
    "            WORKFLOW_VALUE=\"$1\" node -e 'process.stdout.write((process.env.WORKFLOW_VALUE ?? \"\").replace(/%/g, \"%25\").replace(/\\r/g, \"%0D\").replace(/\\n/g, \"%0A\"))'",
    "          }",
    "          get_oidc_token() {",
    "            local audience oidc_json",
    "            audience=\"$(node -e 'process.stdout.write(encodeURIComponent(process.env.LISKOV_OIDC_AUDIENCE ?? \"\"))')\"",
    "            oidc_json=\"$RUNNER_TEMP/liskov-upload-session-oidc.json\"",
    "            curl --fail --show-error --silent --header \"Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}\" \"${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${audience}\" > \"$oidc_json\"",
    "            node - \"$oidc_json\" <<'NODE'",
    "          const fs = require(\"fs\");",
    "          const [oidcPath] = process.argv.slice(2);",
    "          const body = JSON.parse(fs.readFileSync(oidcPath, \"utf8\"));",
    "          if (typeof body.value !== \"string\" || body.value.length === 0) {",
    "            throw new Error(\"GitHub OIDC response did not contain value\");",
    "          }",
    "          process.stdout.write(body.value);",
    "          NODE",
    "          }",
    "          oidc_token=\"$(get_oidc_token)\"",
    "          printf '::add-mask::%s\\n' \"$(workflow_escape \"$oidc_token\")\"",
    "          application_path=\"$(node -e 'process.stdout.write(encodeURIComponent(process.env.LISKOV_APPLICATION_REF ?? \"\"))')\"",
    "          response_json=\"$RUNNER_TEMP/liskov-upload-session.json\"",
    "          curl --fail-with-body --show-error --silent --request POST \\",
    "            \"${LISKOV_URL%/}/api/applications/${application_path}/runtime-images/upload-session\" \\",
    "            --header \"Authorization: Bearer ${oidc_token}\" \\",
    "            --header 'Content-Type: application/json' \\",
    `            --data '${JSON.stringify({ domain: RUNTIME_IMAGE_UPLOAD_SESSION_DOMAIN })}' \\`,
    "            > \"$response_json\"",
    "          mapfile -d '' upload_values < <(node - \"$response_json\" \"$GITHUB_OUTPUT\" <<'NODE'",
    "          const fs = require(\"fs\");",
    "          const [responsePath, outputPath] = process.argv.slice(2);",
    "          const response = JSON.parse(fs.readFileSync(responsePath, \"utf8\"));",
    "          function required(value, field) {",
    "            if (typeof value !== \"string\" || value.length === 0) {",
    "              throw new Error(`Liskov upload-session response missing ${field}`);",
    "            }",
    "            if (/[\\r\\n\\u0000]/u.test(value)) {",
    "              throw new Error(`Liskov upload-session response field ${field} contains a control character`);",
    "            }",
    "            return value;",
    "          }",
    "          function line(name, value) {",
    "            return `${name}=${value}\\n`;",
    "          }",
    "          const uploadSession = response.uploadSession ?? {};",
    "          const upload = response.upload ?? {};",
    "          const credentials = response.credentials ?? {};",
    "          const sessionId = required(uploadSession.sessionId, \"uploadSession.sessionId\");",
    "          const objectKey = required(upload.objectKey, \"upload.objectKey\");",
    "          const bucket = required(upload.bucket, \"upload.bucket\");",
    "          const endpointUrl = required(upload.endpointUrl, \"upload.endpointUrl\");",
    "          const region = required(upload.region, \"upload.region\");",
    "          const accessKeyId = required(credentials.accessKeyId, \"credentials.accessKeyId\");",
    "          const secretAccessKey = required(credentials.secretAccessKey, \"credentials.secretAccessKey\");",
    "          fs.appendFileSync(outputPath, line(\"session_id\", sessionId) + line(\"object_key\", objectKey) + line(\"bucket\", bucket));",
    "          process.stdout.write([accessKeyId, secretAccessKey, region, endpointUrl, bucket, objectKey].join(\"\\u0000\") + \"\\u0000\");",
    "          NODE",
    "          )",
    "          if [ \"${#upload_values[@]}\" -ne 6 ]; then",
    "            echo \"Liskov upload-session response did not produce upload credentials\" >&2",
    "            exit 1",
    "          fi",
    "          access_key_id=\"${upload_values[0]}\"",
    "          secret_access_key=\"${upload_values[1]}\"",
    "          region=\"${upload_values[2]}\"",
    "          endpoint_url=\"${upload_values[3]}\"",
    "          bucket=\"${upload_values[4]}\"",
    "          object_key=\"${upload_values[5]}\"",
    "          printf '::add-mask::%s\\n' \"$(workflow_escape \"$secret_access_key\")\"",
    "          AWS_ACCESS_KEY_ID=\"$access_key_id\" \\",
    "          AWS_SECRET_ACCESS_KEY=\"$secret_access_key\" \\",
    "          AWS_REGION=\"$region\" \\",
    "          AWS_ENDPOINT_URL_S3=\"$endpoint_url\" \\",
    "          aws s3api put-object \\",
    "            --endpoint-url \"$endpoint_url\" \\",
    "            --bucket \"$bucket\" \\",
    "            --key \"$object_key\" \\",
    "            --body \"${{ steps.image.outputs.image_path }}\" \\",
    "            --metadata \"sha256=${{ steps.image.outputs.digest }}\"",
    "          unset secret_access_key",
    "",
    "      - name: Finalize Liskov upload session",
    "        shell: bash",
    "        env:",
    "          LISKOV_DIGEST: ${{ steps.image.outputs.digest }}",
    "          LISKOV_BYTE_SIZE: ${{ steps.image.outputs.byte_size }}",
    "          LISKOV_OBJECT_KEY: ${{ steps.upload_session.outputs.object_key }}",
    "          LISKOV_RUNTIME_IMAGE_URL: ${{ inputs.image_url }}",
    "          LISKOV_UPLOAD_SESSION_ID: ${{ steps.upload_session.outputs.session_id }}",
    "          LISKOV_WORKFLOW_REF: ${{ github.workflow_ref }}",
    "        run: |",
    "          set -euo pipefail",
    "          workflow_escape() {",
    "            WORKFLOW_VALUE=\"$1\" node -e 'process.stdout.write((process.env.WORKFLOW_VALUE ?? \"\").replace(/%/g, \"%25\").replace(/\\r/g, \"%0D\").replace(/\\n/g, \"%0A\"))'",
    "          }",
    "          get_oidc_token() {",
    "            local audience oidc_json",
    "            audience=\"$(node -e 'process.stdout.write(encodeURIComponent(process.env.LISKOV_OIDC_AUDIENCE ?? \"\"))')\"",
    "            oidc_json=\"$RUNNER_TEMP/liskov-finalize-oidc.json\"",
    "            curl --fail --show-error --silent --header \"Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}\" \"${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${audience}\" > \"$oidc_json\"",
    "            node - \"$oidc_json\" <<'NODE'",
    "          const fs = require(\"fs\");",
    "          const [oidcPath] = process.argv.slice(2);",
    "          const body = JSON.parse(fs.readFileSync(oidcPath, \"utf8\"));",
    "          if (typeof body.value !== \"string\" || body.value.length === 0) {",
    "            throw new Error(\"GitHub OIDC response did not contain value\");",
    "          }",
    "          process.stdout.write(body.value);",
    "          NODE",
    "          }",
    "          payload_json=\"$RUNNER_TEMP/liskov-finalize.json\"",
    "          node - \"$payload_json\" <<'NODE'",
    "          const fs = require(\"fs\");",
    "          const [payloadPath] = process.argv.slice(2);",
    "          function requiredEnv(name) {",
    "            const value = process.env[name];",
    "            if (typeof value !== \"string\" || value.length === 0) throw new Error(`${name} is required`);",
    "            return value;",
    "          }",
    "          const byteSize = Number.parseInt(requiredEnv(\"LISKOV_BYTE_SIZE\"), 10);",
    "          if (!Number.isSafeInteger(byteSize) || byteSize <= 0) throw new Error(\"LISKOV_BYTE_SIZE must be a positive integer\");",
    "          const payload = {",
    "            objectKey: requiredEnv(\"LISKOV_OBJECT_KEY\"),",
    "            digest: requiredEnv(\"LISKOV_DIGEST\"),",
    "            byteSize,",
    "            provenance: {",
    "              repository: requiredEnv(\"GITHUB_REPOSITORY\"),",
    "              ref: requiredEnv(\"GITHUB_REF\"),",
    "              sha: requiredEnv(\"GITHUB_SHA\"),",
    "              workflowRef: requiredEnv(\"LISKOV_WORKFLOW_REF\"),",
    "              workflow: process.env.GITHUB_WORKFLOW,",
    "              runId: process.env.GITHUB_RUN_ID,",
    "              runAttempt: process.env.GITHUB_RUN_ATTEMPT,",
    "              actor: process.env.GITHUB_ACTOR,",
    "              eventName: process.env.GITHUB_EVENT_NAME,",
    "              sourceImageUrl: process.env.LISKOV_RUNTIME_IMAGE_URL",
    "            }",
    "          };",
    "          fs.writeFileSync(payloadPath, `${JSON.stringify(payload)}\\n`);",
    "          NODE",
    "          oidc_token=\"$(get_oidc_token)\"",
    "          printf '::add-mask::%s\\n' \"$(workflow_escape \"$oidc_token\")\"",
    "          application_path=\"$(node -e 'process.stdout.write(encodeURIComponent(process.env.LISKOV_APPLICATION_REF ?? \"\"))')\"",
    "          session_path=\"$(node -e 'process.stdout.write(encodeURIComponent(process.env.LISKOV_UPLOAD_SESSION_ID ?? \"\"))')\"",
    "          curl --fail-with-body --show-error --silent --request POST \\",
    "            \"${LISKOV_URL%/}/api/applications/${application_path}/runtime-images/upload-sessions/${session_path}/finalize\" \\",
    "            --header \"Authorization: Bearer ${oidc_token}\" \\",
    "            --header 'Content-Type: application/json' \\",
    "            --data @\"$payload_json\" \\",
    "            > \"$RUNNER_TEMP/liskov-finalized.json\"",
    ""
  ].join("\n");
}

async function authenticatedSlipwayRequest<T>(
  input: {
    config?: string;
    slipwayUrl?: string;
    json?: boolean;
    path: string;
    authToken?: string;
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
    }, `Error (SLIPWAY_SESSION_NOT_FOUND): no Liskov CLI session found. Run \`proof liskov login\` first.`);
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
        authorization: `Bearer ${input.authToken ?? saved.sessionToken}`
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
    method: "DELETE" | "POST";
    path: string;
    body: unknown;
    authToken?: string;
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
    }, `Error (SLIPWAY_SESSION_NOT_FOUND): no Liskov CLI session found. Run \`proof liskov login\` first.`);
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
        authorization: `Bearer ${input.authToken ?? saved.sessionToken}`,
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

async function runSlipwayJsonCommand(
  input: {
    config?: string;
    slipwayUrl?: string;
    json?: boolean;
    method: "DELETE" | "POST";
    path: string;
    body: unknown;
    errorCode: string;
    fetchFailedMessage: string;
    human: (body: unknown) => string;
  },
  options: SlipwayCliOptions
): Promise<number> {
  const request = await authenticatedSlipwayJsonRequest<SlipwayLiveCustodyCommandResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: input.method,
    path: input.path,
    body: withoutUndefinedDeep(input.body),
    requestErrorCode: input.errorCode,
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: input.fetchFailedMessage
  }, options);
  if (!request.ok) return request.exitCode;
  return writeCommandResponse({
    body: request.body,
    response: request.response,
    errorCode: input.errorCode,
    json: input.json,
    human: input.human,
    options
  });
}

function writeCommandResponse(input: {
  body: SlipwayLiveCustodyCommandResponse | undefined;
  response: Response;
  errorCode: string;
  json?: boolean;
  human: (body: unknown) => string;
  options: SlipwayCliOptions;
}): number {
  if (!input.response.ok || input.body?.ok === false) {
    const error = input.response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : input.errorCode;
    writeStructuredOrHuman(input.options, input.json, {
      ok: false,
      error,
      status: input.response.status,
      reason: input.body?.reason ?? input.body?.error
    }, `Error (${error}): Liskov request failed.`);
    return 1;
  }
  writeStructuredOrHuman(input.options, input.json, input.body, input.human(input.body));
  return 0;
}

function writeConfirmationRequired(
  options: SlipwayCliOptions,
  json: boolean | undefined,
  error: string,
  action: string,
  flag = "--yes"
): number {
  writeStructuredOrHuman(options, json, {
    ok: false,
    error,
    message: `${action} requires ${flag}.`
  }, `Error (${error}): ${action} requires ${flag}.`);
  return 1;
}

async function prepareEnvironmentHandoffs(
  input: Pick<SlipwayCustodyEnvironmentUploadInput, "applicationRef" | "config" | "json" | "network" | "repoDir" | "rpcUrl" | "secretsFile" | "slipwayUrl">,
  options: SlipwayCliOptions,
  onlyPlanItemId?: string
): Promise<{ ok: true; handoffs: SlipwayEncryptedEnvironmentHandoff[] } | { ok: false; exitCode: number }> {
  const actionPlan = await authenticatedSlipwayRequest<SlipwayActionPlanResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/action-plan`,
    requestErrorCode: "SLIPWAY_CUSTODY_ENVIRONMENT_PLAN_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov live custody action plan"
  }, options);
  if (!actionPlan.ok) return { ok: false, exitCode: actionPlan.exitCode };
  if (!actionPlan.response.ok || actionPlan.body?.ok === false) {
    return {
      ok: false,
      exitCode: writeCommandResponse({
        body: actionPlan.body,
        response: actionPlan.response,
        errorCode: "SLIPWAY_CUSTODY_ENVIRONMENT_PLAN_FAILED",
        json: input.json,
        human: () => `Error (SLIPWAY_CUSTODY_ENVIRONMENT_PLAN_FAILED): Liskov could not read action plan for ${input.applicationRef}.`,
        options
      })
    };
  }

  const policyContext = await loadPolicyContext(input, options);
  if (!policyContext.ok) return { ok: false, exitCode: policyContext.exitCode };

  let secrets: Record<string, string> = {};
  if (input.secretsFile !== undefined) {
    try {
      secrets = parseDotenv(await readFile(path.resolve(input.secretsFile), "utf8"));
    } catch (error) {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_CUSTODY_ENVIRONMENT_SECRETS_FILE_FAILED",
        message: errorMessage(error),
        file: path.resolve(input.secretsFile)
      }, `Error (SLIPWAY_CUSTODY_ENVIRONMENT_SECRETS_FILE_FAILED): could not read ${path.resolve(input.secretsFile)}.`);
      return { ok: false, exitCode: 1 };
    }
  }

  const actions = arrayValue(actionPlan.body?.items)
    .map((item) => setEnvironmentActionFromPlanItem(item, policyContext.policy))
    .filter((action): action is SlipwaySetEnvironmentAction => action !== undefined)
    .filter((action) => onlyPlanItemId === undefined || action.actionId === onlyPlanItemId);
  if (actions.length === 0) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_CUSTODY_ENVIRONMENT_UPLOAD_NO_ACTIONS",
      message: onlyPlanItemId
        ? `No acurast.setEnvironment plan item matched ${onlyPlanItemId}.`
        : "No acurast.setEnvironment plan items are available."
    }, `Error (SLIPWAY_CUSTODY_ENVIRONMENT_UPLOAD_NO_ACTIONS): no acurast.setEnvironment plan item is available for ${input.applicationRef}.`);
    return { ok: false, exitCode: 1 };
  }

  const submitMaterials = await loadSubmitMaterials({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    actions
  }, options);
  if (!submitMaterials.ok) return { ok: false, exitCode: submitMaterials.exitCode };

  const network = normalizeNetworkFlag(input.network);
  const rpcUrl = input.rpcUrl ?? defaultAcurastRpcUrl(network);
  const handoffs: SlipwayEncryptedEnvironmentHandoff[] = [];
  for (const action of actions) {
    const variables = environmentVariablesForAction(action, secrets, submitMaterials.values.get(action.actionId) ?? {});
    if (variables.missingRequired.length > 0) {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_CUSTODY_ENVIRONMENT_VALUES_MISSING",
        missingRequired: variables.missingRequired
      }, `Error (SLIPWAY_CUSTODY_ENVIRONMENT_VALUES_MISSING): missing required value(s): ${variables.missingRequired.map((item) => item.name).join(", ")}.`);
      return { ok: false, exitCode: 1 };
    }
    try {
      auditEnvironmentVariables(variables.variables, action.actionId);
      const builder = options.environmentHandoffBuilder ?? buildEncryptedEnvironmentHandoffWithSdk;
      const handoff = await builder({
        action,
        variables: variables.variables,
        network,
        rpcUrl,
        timeoutMs: 240_000,
        pollMs: 10_000
      });
      assertEnvironmentHandoffHasNoPlaintext(handoff, variables.variables, action.actionId);
      handoffs.push(handoff);
    } catch (error) {
      writeStructuredOrHuman(options, input.json, {
        ok: false,
        error: "SLIPWAY_CUSTODY_ENVIRONMENT_HANDOFF_FAILED",
        message: errorMessage(error),
        actionId: action.actionId
      }, `Error (SLIPWAY_CUSTODY_ENVIRONMENT_HANDOFF_FAILED): could not build encrypted handoff for ${action.actionId}.`);
      return { ok: false, exitCode: 1 };
    }
  }
  return { ok: true, handoffs };
}

async function loadPolicyContext(
  input: Pick<SlipwayCustodyEnvironmentUploadInput, "applicationRef" | "config" | "json" | "slipwayUrl">,
  options: SlipwayCliOptions
): Promise<{ ok: true; policy: { policyDigest?: string; environmentVariables: SlipwayEnvironmentVariableAction[] } } | { ok: false; exitCode: number }> {
  const request = await authenticatedSlipwayRequest<SlipwayApplicationStatusResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}`,
    requestErrorCode: "SLIPWAY_CUSTODY_ENVIRONMENT_POLICY_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application policy"
  }, options);
  if (!request.ok) return { ok: false, exitCode: request.exitCode };
  if (!request.response.ok || request.body?.ok === false) {
    return {
      ok: false,
      exitCode: writeCommandResponse({
        body: request.body,
        response: request.response,
        errorCode: "SLIPWAY_CUSTODY_ENVIRONMENT_POLICY_FAILED",
        json: input.json,
        human: () => `Error (SLIPWAY_CUSTODY_ENVIRONMENT_POLICY_FAILED): Liskov could not read Application ${input.applicationRef}.`,
        options
      })
    };
  }
  const activePolicy = objectRecord(request.body?.activePolicy);
  return {
    ok: true,
    policy: {
      policyDigest: stringValue(activePolicy.policyDigest),
      environmentVariables: envVariablesValue(objectRecord(activePolicy.environment).variables)
    }
  };
}

async function loadSubmitMaterials(
  input: {
    config?: string;
    slipwayUrl?: string;
    json?: boolean;
    actions: readonly SlipwaySetEnvironmentAction[];
  },
  options: SlipwayCliOptions
): Promise<{ ok: true; values: Map<string, Record<string, string>> } | { ok: false; exitCode: number }> {
  const values = new Map<string, Record<string, string>>();
  for (const action of input.actions) {
    if (!action.variables.some((variable) => variable.source === "switchboard" || variable.source === "localAction")) continue;
    const request = await authenticatedSlipwayRequest<{ ok?: boolean; values?: unknown[]; error?: string; reason?: string }>({
      config: input.config,
      slipwayUrl: input.slipwayUrl,
      json: input.json,
      path: `/api/actions/${encodeURIComponent(action.actionId)}/submit-material`,
      requestErrorCode: "SLIPWAY_CUSTODY_ENVIRONMENT_SUBMIT_MATERIAL_FAILED",
      notFoundMessage: "No Liskov CLI session is stored locally.",
      fetchFailedMessage: "could not read Liskov submit material"
    }, options);
    if (!request.ok) return { ok: false, exitCode: request.exitCode };
    if (!request.response.ok || request.body?.ok === false) {
      return {
        ok: false,
        exitCode: writeCommandResponse({
          body: request.body,
          response: request.response,
          errorCode: "SLIPWAY_CUSTODY_ENVIRONMENT_SUBMIT_MATERIAL_FAILED",
          json: input.json,
          human: () => `Error (SLIPWAY_CUSTODY_ENVIRONMENT_SUBMIT_MATERIAL_FAILED): Liskov could not read submit material for ${action.actionId}.`,
          options
        })
      };
    }
    const mapped: Record<string, string> = {};
    for (const item of request.body?.values ?? []) {
      const record = objectRecord(item);
      const key = stringValue(record.key);
      const value = typeof record.value === "string" ? record.value : undefined;
      if (key && value !== undefined) mapped[key] = value;
    }
    values.set(action.actionId, mapped);
  }
  return { ok: true, values };
}

function setEnvironmentActionFromPlanItem(
  item: unknown,
  policy: { policyDigest?: string; environmentVariables: SlipwayEnvironmentVariableAction[] }
): SlipwaySetEnvironmentAction | undefined {
  const record = objectRecord(item);
  if (stringValue(record.kind) !== "acurast.setEnvironment") return undefined;
  const summary = objectRecord(record.callSummary);
  const actionId = stringValue(record.planItemId);
  const applicationId = stringValue(record.applicationId) ?? stringValue(summary.applicationId);
  const policyDigest = stringValue(record.policyDigest) ?? stringValue(summary.policyDigest) ?? policy.policyDigest;
  const childSessionId = stringValue(summary.childSessionId);
  const jobId = stringValue(summary.jobId);
  const acurastJobRef = acurastJobRefValue(summary.acurastJobRef);
  if (!actionId || !applicationId || !policyDigest || !childSessionId || !jobId || !acurastJobRef) return undefined;
  const actionVariables = envVariablesValue(summary.variables);
  return {
    actionId,
    kind: "acurast.setEnvironment",
    applicationId,
    serviceId: stringValue(summary.serviceId) ?? applicationId,
    role: stringValue(summary.role) ?? stringValue(summary.serviceId) ?? applicationId,
    policyDigest,
    childSessionId,
    jobId,
    deploymentId: stringValue(summary.deploymentId),
    acurastJobRef,
    expectedProcessors: stringArrayValue(summary.expectedProcessors),
    envNames: stringArrayValue(summary.envNames),
    variables: mergePolicyEnvironmentVariables(actionVariables, policy.environmentVariables)
  };
}

function environmentVariablesForAction(
  action: SlipwaySetEnvironmentAction,
  secrets: Record<string, string>,
  submitMaterials: Record<string, string>
): { variables: Array<{ key: string; value: string }>; missingRequired: Array<{ name: string; source: string }> } {
  const variables: Array<{ key: string; value: string }> = [];
  const missingRequired: Array<{ name: string; source: string }> = [];
  for (const variable of action.variables) {
    const localValue = secrets[variable.name] ?? (variable.secretId ? secrets[variable.secretId] : undefined);
    const value = variable.source === "literal"
      ? variable.value
      : variable.source === "switchboard" || variable.source === "localAction"
        ? submitMaterials[variable.name] ?? localValue
        : localValue;
    if (value === undefined) {
      if (variable.required) missingRequired.push({ name: variable.name, source: variable.source });
      continue;
    }
    variables.push({ key: variable.name, value });
  }
  return { variables, missingRequired };
}

async function buildEncryptedEnvironmentHandoffWithSdk(input: SlipwayEnvironmentHandoffBuildInput): Promise<SlipwayEncryptedEnvironmentHandoff> {
  const sdk = await import("@acurast/sdk/chain");
  const acurast = new sdk.AcurastService(input.rpcUrl);
  try {
    const jobId = [input.action.acurastJobRef.origin, input.action.acurastJobRef.sequence] as [unknown, number];
    const assignments = await waitForEnvironmentAssignments(acurast, {
      jobId,
      expectedProcessors: input.action.expectedProcessors,
      timeoutMs: input.timeoutMs,
      pollMs: input.pollMs
    });
    const jobEnvironmentService = new sdk.JobEnvironmentService({ acurastService: acurast });
    const encryptedAssignments: SlipwayEncryptedEnvironmentHandoff["assignments"] = [];
    for (const assignment of assignments) {
      const processorEncryptionKey = sdk.getProcessorEncryptionKey(assignment as never);
      if (!processorEncryptionKey) continue;
      const sharedKey = await jobEnvironmentService.generateSharedKey(processorEncryptionKey.publicKey, processorEncryptionKey.curve);
      const publicKey = jobEnvironmentService.getPublicKey(processorEncryptionKey.curve);
      if (!publicKey) continue;
      encryptedAssignments.push({
        processor: assignment.processor,
        publicKey,
        variables: input.variables.map((variable) => ({
          key: variable.key,
          encryptedValue: jobEnvironmentService.encrypt(variable.value, sharedKey)
        }))
      });
    }
    if (encryptedAssignments.length === 0) {
      throw new Error(`No assignment encryption keys are ready for job ${input.action.jobId}`);
    }
    return {
      domain: "proof.slipway.acurast-environment-handoff.v1",
      actionId: input.action.actionId,
      applicationId: input.action.applicationId,
      policyDigest: input.action.policyDigest,
      childSessionId: input.action.childSessionId,
      jobId: input.action.jobId,
      deploymentId: input.action.deploymentId,
      acurastJobRef: input.action.acurastJobRef,
      envNames: input.variables.map((variable) => variable.key).sort(),
      assignments: encryptedAssignments
    };
  } finally {
    await acurast.disconnect();
  }
}

async function waitForEnvironmentAssignments(
  acurast: {
    assignedProcessors(jobIds: [unknown, number][]): Promise<Map<string, [[unknown, number], string[]]>>;
    jobAssignments(keys: [string, [unknown, number]][]): Promise<Array<{ processor: string; assignment: { pubKeys: Array<Record<string, unknown>> } }>>;
  },
  input: {
    jobId: [unknown, number];
    expectedProcessors: readonly string[];
    timeoutMs: number;
    pollMs: number;
  }
): Promise<Array<{ processor: string; assignment: { pubKeys: Array<Record<string, unknown>> } }>> {
  const deadline = Date.now() + input.timeoutMs;
  const expected = new Set(input.expectedProcessors);
  let lastReady = 0;
  for (;;) {
    const assigned = await acurast.assignedProcessors([input.jobId]);
    const keys = [...assigned.values()].flatMap(([jobId, processors]) =>
      processors
        .filter((processor) => expected.size === 0 || expected.has(processor))
        .map((processor) => [processor, jobId] as [string, [unknown, number]])
    );
    const assignments = keys.length > 0 ? await acurast.jobAssignments(keys) : [];
    const ready = assignments.filter((assignment) => assignment.assignment.pubKeys.some((key) =>
      typeof key.SECP256r1Encryption === "string" ||
      typeof key.SECP256r1 === "string" ||
      typeof key.secp256r1Encryption === "string" ||
      typeof key.secp256r1 === "string" ||
      typeof key.encryption === "string"
    ));
    lastReady = ready.length;
    if (ready.length > 0 && (expected.size === 0 || [...expected].every((processor) => ready.some((assignment) => assignment.processor === processor)))) {
      return ready;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Acurast assignment encryption keys for job ${JSON.stringify(input.jobId)} (${lastReady}/${expected.size || "any"} ready).`);
    }
    await defaultSleep(Math.max(100, Math.min(input.pollMs, deadline - Date.now())));
  }
}

function assertEnvironmentHandoffHasNoPlaintext(
  handoff: SlipwayEncryptedEnvironmentHandoff,
  variables: readonly { key: string; value: string }[],
  actionId: string
): void {
  const serialized = JSON.stringify(handoff);
  for (const variable of variables) {
    if (variable.value.length === 0 || PUBLIC_LOCKBOX_BOOTSTRAP_ENVIRONMENT_VARIABLES.has(variable.key)) continue;
    const encodedValue = JSON.stringify(variable.value);
    if (serialized.includes(encodedValue) || (variable.value.length >= 8 && serialized.includes(variable.value))) {
      throw new Error(`Refusing to submit encrypted handoff for ${actionId}: plaintext value for ${variable.key} is present in payload`);
    }
  }
}

const PUBLIC_LOCKBOX_BOOTSTRAP_ENVIRONMENT_VARIABLES = new Set([
  "PROOF_LOCKBOX_URL",
  "PROOF_LOCKBOX_APPLICATION_ID",
  "PROOF_LOCKBOX_GRANT_ID",
  "PROOF_LOCKBOX_POLICY_DIGEST",
  "PROOF_LOCKBOX_DEPLOYMENT_ID",
  "PROOF_LOCKBOX_SECRET_IDS",
  "PROOF_LOCKBOX_REQUESTED_SECRET_IDS",
  "PROOF_LOCKBOX_FILE_BASE_DIR"
]);

function auditEnvironmentVariables(variables: readonly { key: string; value: string }[], actionId: string): void {
  const violations: string[] = [];
  if (variables.length > 10) violations.push(`count ${variables.length} > max 10`);
  for (const variable of variables) {
    const keyBytes = Buffer.byteLength(variable.key, "utf8");
    if (keyBytes > 32) violations.push(`key ${variable.key} is ${keyBytes} bytes > max 32`);
    const valueBytes = Buffer.byteLength(variable.value, "utf8");
    if (valueBytes > 996) violations.push(`value for ${variable.key} is ${valueBytes} bytes > plaintext max 996`);
  }
  if (violations.length > 0) {
    throw new Error([
      `Refusing to submit setEnvironments for ${actionId}: payload exceeds Acurast runtime caps.`,
      ...violations.map((violation) => `  - ${violation}`)
    ].join("\n"));
  }
}

async function readSlipwaySession(sessionFile: string): Promise<SlipwaySessionFile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(sessionFile, "utf8")) as Partial<SlipwaySessionFile>;
    if (parsed.version !== 1 || typeof parsed.slipwayUrl !== "string" || typeof parsed.sessionToken !== "string") {
      throw new Error(`Liskov session file ${sessionFile} is not a version 1 session file`);
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
    throw new Error("Liskov URL must use http or https");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/u, "");
}

function signerControlPlaneUrl(slipwayUrl: string): string {
  return websocketUrl(new URL("/api/custody/signer", slipwayUrl));
}

function signerWebsocketUrl(slipwayUrl: string, websocketPath: string | undefined, pairingToken: string): string {
  const path = stringValue(websocketPath) ?? "/api/custody/signer";
  const url = new URL(path, slipwayUrl);
  if (!url.searchParams.has("pairingToken")) url.searchParams.set("pairingToken", pairingToken);
  return websocketUrl(url);
}

function websocketUrl(url: URL): string {
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error("Liskov URL must use http or https");
  return url.toString();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function resolveVerificationUrl(value: string, slipwayUrl: string): string {
  const url = new URL(value, slipwayUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Liskov verification URL must use http or https");
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
      ? "Browser opened for Liskov CLI authorization."
      : "Open this URL to authorize Liskov CLI login:",
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

function applicationDeletePath(applicationRef: string, owner: string | undefined): string {
  const pathValue = `/api/applications/${encodeURIComponent(applicationRef)}`;
  if (!owner || !owner.trim()) return pathValue;
  const query = new URLSearchParams({ owner: owner.trim() });
  return `${pathValue}?${query.toString()}`;
}

function applicationStatusPath(applicationRef: string, owner: string | undefined): string {
  const pathValue = `/api/applications/${encodeURIComponent(applicationRef)}/status`;
  if (!owner || !owner.trim()) return pathValue;
  const query = new URLSearchParams({ owner: owner.trim() });
  return `${pathValue}?${query.toString()}`;
}

function applicationRepositoryPath(applicationRef: string, owner: string | undefined): string {
  const pathValue = `/api/applications/${encodeURIComponent(applicationRef)}/repository`;
  if (!owner || !owner.trim()) return pathValue;
  const query = new URLSearchParams({ owner: owner.trim() });
  return `${pathValue}?${query.toString()}`;
}

function parseRepositorySlug(value: string): string {
  const repository = value.trim();
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new Error("repository must be owner/repo");
  }
  return repository;
}

function applicationRenamePath(applicationRef: string, owner: string | undefined): string {
  const pathValue = `/api/applications/${encodeURIComponent(applicationRef)}/rename`;
  if (!owner || !owner.trim()) return pathValue;
  const query = new URLSearchParams({ owner: owner.trim() });
  return `${pathValue}?${query.toString()}`;
}

function normalizeNetworkFlag(value: SlipwayAcurastNetworkFlag | undefined): "mainnet" | "canary" {
  if (value === undefined || value === "mainnet") return "mainnet";
  if (value === "testnet" || value === "canary") return "canary";
  throw new Error(`Unsupported Acurast network: ${String(value)}`);
}

function defaultAcurastRpcUrl(network: "mainnet" | "canary"): string {
  return network === "mainnet"
    ? "wss://archive.mainnet.acurast.com"
    : "wss://canarynet-ws-1.acurast-h-server-2.papers.tech";
}

function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    values[key] = parseDotenvValue(line.slice(eq + 1).trim());
  }
  return values;
}

function parseDotenvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    return value.startsWith("\"") ? inner.replace(/\\n/gu, "\n").replace(/\\"/gu, "\"").replace(/\\\\/gu, "\\") : inner;
  }
  const comment = /(^|[^\\])#/u.exec(value);
  return (comment?.index === undefined ? value : value.slice(0, comment.index + comment[1]!.length)).trim().replace(/\\#/gu, "#");
}

function envVariablesValue(value: unknown): SlipwayEnvironmentVariableAction[] {
  return arrayValue(value).flatMap((item) => {
    const record = objectRecord(item);
    const name = stringValue(record.name) ?? stringValue(record.key);
    const source = stringValue(record.source);
    if (!name) return [];
    const normalizedSource = source === "literal" || source === "secret" || source === "switchboard" || source === "localAction" || source === "local"
      ? source
      : "local";
    return [{
      name,
      required: booleanValue(record.required) ?? true,
      source: normalizedSource,
      value: typeof record.value === "string" ? record.value : undefined,
      secretId: stringValue(record.secretId),
      bundleId: stringValue(record.bundleId)
    }];
  });
}

function mergePolicyEnvironmentVariables(
  actionVariables: readonly SlipwayEnvironmentVariableAction[],
  policyVariables: readonly SlipwayEnvironmentVariableAction[]
): SlipwayEnvironmentVariableAction[] {
  const policyByName = new Map(policyVariables.map((variable) => [variable.name, variable]));
  return actionVariables.map((variable) => {
    const policyVariable = policyByName.get(variable.name);
    if (!policyVariable) return variable;
    return {
      ...variable,
      required: variable.required || policyVariable.required,
      value: variable.value ?? (variable.source === "literal" ? policyVariable.value : undefined),
      secretId: variable.secretId ?? policyVariable.secretId,
      bundleId: variable.bundleId ?? policyVariable.bundleId
    };
  });
}

function acurastJobRefValue(value: unknown): { origin: unknown; sequence: number; canonicalJobId: string } | undefined {
  const record = objectRecord(value);
  const sequence = numberValue(record.sequence);
  const origin = record.origin;
  if (origin === undefined || sequence === undefined || !Number.isSafeInteger(sequence) || sequence < 0) return undefined;
  return {
    origin,
    sequence,
    canonicalJobId: stringValue(record.canonicalJobId) ?? JSON.stringify([origin, sequence])
  };
}

function withoutUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefinedDeep);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = withoutUndefinedDeep(item);
  }
  return result;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatApplicationStatus(body: SlipwayApplicationStatusResponse, fallbackApplicationId: string): string {
  const app = body.application;
  const applicationId = formatApplicationLabel(app, fallbackApplicationId);
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
  const deleted = typeof app?.deletedAtMs === "number" ? `; deleted ${new Date(app.deletedAtMs).toISOString()}` : "";
  const signer = formatSelfCustodySigner(body.selfCustodySigner);
  return `${applicationId}: ${status}${replicaSummary ? ` (${replicaSummary})` : ""}${policy}${repository}${deleted}${signer ? `; ${signer}` : ""}`;
}

function formatApplicationDeploymentStatus(body: SlipwayGenericResponse, fallbackApplicationId: string): string {
  const record = objectRecord(body);
  const deployment = objectRecord(record.deployment);
  const state = stringValue(deployment.stateLabel) ?? stringValue(deployment.state) ?? "unknown";
  const selected = stringValue(record.selectedDeploymentId);
  const count = arrayValue(record.deployments).length;
  const suffix = selected ? ` (${selected})` : count > 0 ? ` (${count} generation${count === 1 ? "" : "s"})` : "";
  const lines = [`Deployment state for ${fallbackApplicationId}: ${state}${suffix}.`];
  const summary = stringValue(deployment.summary);
  if (summary) lines.push(summary);
  const signer = formatSelfCustodySigner(record.selfCustodySigner);
  if (signer) lines.push(signer);
  return lines.join("\n");
}

function formatApplicationSecrets(body: SlipwayApplicationSecretsResponse, fallbackApplicationId: string): string {
  const secrets = objectRecord(objectRecord(body as Record<string, unknown>).secrets);
  const counts = objectRecord(secrets.counts);
  const declarations = arrayValue(secrets.declarations);
  const required = numberValue(counts.required) ?? declarations.length;
  const asCount = (value: unknown): string => {
    const n = numberValue(value);
    return n === undefined ? "—" : String(n);
  };
  const lines = [
    `Secrets for ${fallbackApplicationId}: ${required} required, ${asCount(counts.present)} present, ${asCount(counts.missing)} missing.`
  ];
  if (declarations.length === 0) {
    lines.push("  No secret declarations in the active policy.");
  } else {
    for (const item of declarations) {
      const decl = objectRecord(item);
      const name = stringValue(decl.name) ?? stringValue(decl.secretId) ?? "secret";
      const details: string[] = [];
      const secretId = stringValue(decl.secretId);
      if (secretId && secretId !== name) details.push(`secretId ${secretId}`);
      const bundleId = stringValue(decl.bundleId);
      if (bundleId) details.push(`bundle ${bundleId}`);
      const target = stringValue(decl.target);
      if (target) details.push(target);
      if (booleanValue(decl.required)) details.push("required");
      lines.push(`  ${name}${details.length > 0 ? `  (${details.join(", ")})` : ""}`);
    }
  }
  const resolution = objectRecord(secrets.resolution);
  if (booleanValue(resolution.available) !== true) {
    const reason = stringValue(resolution.reason);
    lines.push(`Present/missing not yet resolved${reason ? ` (${reason})` : ""}.`);
  }
  return lines.join("\n");
}

function formatApplicationActivity(body: SlipwayGenericResponse, fallbackApplicationId: string, count: number): string {
  const events = arrayValue(objectRecord(body).events);
  const lines = [`${count} activity event(s) for ${fallbackApplicationId}.`];
  for (const item of events) {
    const event = objectRecord(item);
    lines.push(formatActivityEventLine(event));
  }
  return lines.join("\n");
}

function formatActivityEventLine(event: Record<string, unknown>): string {
  const payload = objectRecord(event.payload);
  const kind = stringValue(event.kind) ?? "event";
  const summary = stringValue(event.summary) ?? activitySummaryFromKind(kind, payload) ?? kind;
  const createdAtMs = numberValue(event.createdAtMs);
  const when = createdAtMs === undefined ? "" : `${new Date(createdAtMs).toISOString()} `;
  const details = [
    stringValue(payload.requestId) ? `request ${stringValue(payload.requestId)}` : undefined,
    stringValue(payload.signerAddress) ? `signer ${compactSignerAddress(stringValue(payload.signerAddress) as string)}` : undefined,
    stringValue(payload.txHash) ? `tx ${stringValue(payload.txHash)}` : undefined,
    stringValue(payload.callHash) ? `call ${stringValue(payload.callHash)}` : undefined
  ].filter((item): item is string => item !== undefined);
  return `- ${when}${summary}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

function activitySummaryFromKind(kind: string, payload: Record<string, unknown>): string | undefined {
  const operation = stringValue(payload.operation) ?? "signature";
  if (kind === "liskov.sign_requested") return `Signature requested — ${operation}.`;
  if (kind === "liskov.sign_submitted") return `Self-custody signer submitted ${operation}.`;
  if (kind === "liskov.sign_rejected") {
    const reason = stringValue(payload.reason);
    return reason
      ? `Self-custody signer rejected ${operation} — ${reason}.`
      : `Self-custody signer rejected ${operation}.`;
  }
  return undefined;
}

function formatSelfCustodySigner(value: unknown): string | undefined {
  const signer = objectRecord(value);
  const status = stringValue(signer.status);
  const address = stringValue(signer.address);
  if ((!status || status === "not_configured") && !address) return undefined;
  const pending = numberValue(signer.pendingRequestCount);
  const message = stringValue(signer.message);
  const label = signerStatusLabel(status);
  const addressPart = address ? ` ${compactSignerAddress(address)}` : "";
  const pendingPart = pending && pending > 0 ? `, ${pending} pending` : "";
  const messagePart = message ? `: ${message}` : "";
  return `signer ${label}${addressPart}${pendingPart}${messagePart}`;
}

function signerStatusLabel(status: string | undefined): string {
  switch (status) {
    case "online":
      return "online";
    case "waiting_for_signer":
      return "waiting for signer";
    case "runtime_mismatch":
      return "runtime mismatch";
    case "failed_offline":
      return "failed offline";
    case "offline":
      return "offline";
    default:
      return status?.replace(/_/gu, " ") ?? "unknown";
  }
}

function compactSignerAddress(address: string): string {
  const trimmed = address.trim();
  return trimmed.length > 18 ? `${trimmed.slice(0, 8)}…${trimmed.slice(-7)}` : trimmed;
}

function formatApplicationList(body: SlipwayApplicationListResponse): string {
  const applications = body.applications ?? [];
  const count = typeof body.count === "number" ? body.count : applications.length;
  if (applications.length === 0) return "No Liskov Applications found.";
  const lines = [`${count} Liskov Application(s):`];
  for (const application of applications) {
    const primary = application.applicationName ?? application.applicationUid ?? application.applicationId ?? "unknown";
    const applicationId = formatApplicationLabel(application);
    const policyVersionId = application.activePolicy?.policyVersionId ?? application.activePolicyVersionId;
    const status = application.status ?? application.activePolicy?.status ?? "unknown";
    const details = [
      typeof application.replicas === "number" ? `${application.replicas} replica(s)` : undefined,
      application.artifact?.status ? `artifact ${application.artifact.status}` : undefined,
      policyVersionId ? `policy ${policyVersionId}` : undefined,
      application.source?.repository ? `repo ${application.source.repository}` : undefined,
      application.ownerAddress ? `owner ${application.ownerAddress}` : undefined,
      application.applicationUid && application.applicationUid !== primary ? `uid ${application.applicationUid}` : undefined,
      application.duplicateLegacyId ? "duplicate legacy id" : undefined,
      typeof application.deletedAtMs === "number" ? `deleted ${new Date(application.deletedAtMs).toISOString()}` : undefined
    ].filter((item): item is string => item !== undefined);
    lines.push(`- ${applicationId}: ${status}${details.length > 0 ? ` (${details.join(", ")})` : ""}`);
  }
  return lines.join("\n");
}

function formatApplicationBackfillIdentities(body: SlipwayApplicationBackfillIdentitiesResponse): string {
  const changedCount = typeof body.changedCount === "number" ? body.changedCount : body.changes?.length ?? 0;
  const scanned = typeof body.scanned === "number" ? body.scanned : "unknown";
  const prefix = body.dryRun === true ? "Dry run" : "Backfilled";
  const lines = [`${prefix}: ${changedCount} Application identity change(s) across ${scanned} scanned Application(s).`];
  for (const change of body.changes ?? []) {
    const reasons = Array.isArray(change.reasons) && change.reasons.length > 0 ? ` [${change.reasons.join(", ")}]` : "";
    const label = formatApplicationLabel({
      applicationName: change.applicationName,
      applicationUid: change.applicationUid,
      applicationId: change.applicationId
    }, change.applicationId);
    lines.push(`- ${label}${reasons}`);
  }
  return lines.join("\n");
}

function formatApplicationDelete(body: SlipwayApplicationDeleteResponse): string {
  const target = formatApplicationLabel(body.application);
  const blockers = body.blockers ?? [];
  const header = body.dryRun === true
    ? `Dry run: ${target} would be tombstoned.`
    : body.deleted === true
      ? `Deleted ${target}.`
      : `${target} is already deleted.`;
  const lines = [header];
  if (blockers.length > 0) {
    lines.push(`Blockers: ${blockers.map(formatDeleteBlocker).join("; ")}`);
    if (body.dryRun === true && body.force !== true) {
      lines.push("Use --force --yes to tombstone despite these blockers.");
    }
  }
  return lines.join("\n");
}

function formatApplicationStatusTransition(body: SlipwayApplicationStatusTransitionResponse): string {
  const target = formatApplicationLabel(body.application);
  const status = body.status === "active" ? "active" : "paused";
  const verb = status === "active" ? "resumed" : "paused";
  const already = status === "active" ? "already active" : "already paused";
  if (status === "active" && body.replacementHold && body.overrideRequired === true) {
    return `Dry run: ${target} resume is blocked by the replacement dossier. ${formatReplacementHoldSummary(body.replacementHold)} Use --override-replacement-hold --reason TEXT --yes after explicit operator review.`;
  }
  if (body.dryRun === true) {
    return body.changed === false
      ? `Dry run: ${target} is ${already}.`
      : `Dry run: ${target} would be ${verb}.`;
  }
  return body.changed === false
    ? `${target} is ${already}.`
    : `${verb[0]!.toUpperCase()}${verb.slice(1)} ${target}.`;
}

function formatApplicationSetRepository(applicationRef: string, body: SlipwayApplicationSetRepositoryResponse): string {
  const to = body.to?.repository ?? "(unknown)";
  const from = body.from?.repository ?? "(unknown)";
  if (body.changed === false) {
    return body.dryRun === true
      ? `Dry run: ${applicationRef} repository is already ${to}.`
      : `${applicationRef} repository is already ${to}.`;
  }
  if (body.dryRun === true) {
    return `Dry run: ${applicationRef} repository would move ${from} → ${to}.`;
  }
  const version = body.policy?.policyVersionId;
  const suffix = version ? ` (policy ${version})` : "";
  return [
    `Moved ${applicationRef} repository to ${to}${suffix}.`,
    "Remember to update and commit the repository's .liskov policy file so re-imports stay consistent."
  ].join("\n");
}

function formatApplicationRename(applicationRef: string, body: SlipwayApplicationRenameResponse): string {
  const toName = body.to?.displayName ?? "(unknown)";
  const fromName = body.from?.displayName ?? "(unknown)";
  const slug = body.to?.applicationName ?? undefined;
  const policyPath = body.to?.expectedPolicyPath ?? (slug ? `.liskov/${slug}.policy.json` : undefined);
  if (body.changed === false) {
    return body.dryRun === true
      ? `Dry run: ${applicationRef} is already named "${toName}".`
      : `${applicationRef} is already named "${toName}".`;
  }
  if (body.dryRun === true) {
    const lines = [`Dry run: ${applicationRef} would be renamed "${fromName}" → "${toName}"${slug ? ` (slug ${slug})` : ""}.`];
    if (policyPath) lines.push(`Then rename the repo policy file to ${policyPath}, update its source.path, and re-import.`);
    return lines.join("\n");
  }
  const version = body.policy?.policyVersionId;
  const lines = [`Renamed ${applicationRef} to "${toName}"${slug ? ` (slug ${slug})` : ""}${version ? ` (policy ${version})` : ""}.`];
  if (policyPath) lines.push(`Now rename the repo policy file to ${policyPath}, update its source.path, commit, and re-import.`);
  return lines.join("\n");
}

function formatApplicationDevtoolsViewKey(body: unknown, input: SlipwayApplicationDevtoolsViewKeyInput): string {
  const record = objectRecord(body);
  const deploymentId = stringValue(record.deploymentId) ?? input.deploymentId;
  const devtoolsUrl = stringValue(record.devtoolsUrl) ?? "unavailable";
  const expiresAt = stringValue(record.expiresAt) ?? "unknown";
  const jobId = stringValue(record.jobId);
  return [
    `Acurast DevTools view key for ${input.applicationRef} deployment ${deploymentId}.`,
    `URL: ${devtoolsUrl}`,
    `Expires: ${expiresAt}`,
    jobId ? `Job: ${jobId}` : undefined
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatReplacementHoldBlocked(applicationRef: string, body: SlipwayApplicationStatusTransitionResponse): string {
  const target = formatApplicationLabel(body.application, applicationRef);
  const hold = body.replacementHold;
  const lines = [`Error (application_resume_blocked_by_replacement_hold): ${target} resume is blocked by the replacement dossier.`];
  if (hold) lines.push(formatReplacementHoldSummary(hold));
  lines.push("Default action is blocked; use --override-replacement-hold --reason TEXT --yes only after explicit operator review.");
  return lines.join(" ");
}

function formatReplacementHoldSummary(hold: PublicSlipwayReplacementHold): string {
  const details = [
    hold.dossierClassification ? `classification ${hold.dossierClassification}` : undefined,
    hold.replacementRisk ? `replacement risk ${hold.replacementRisk}` : undefined,
    hold.recommendation ? `recommendation ${hold.recommendation}` : undefined,
    hold.executionId ? `execution ${hold.executionId}` : undefined,
    hold.deploymentId ? `deployment ${hold.deploymentId}` : undefined,
    hold.policyDigest ? `policy ${hold.policyDigest}` : undefined
  ].filter((item): item is string => item !== undefined);
  return `Hold: ${details.length > 0 ? details.join(", ") : "replacement spend requires review"}.`;
}

function formatApplicationAmbiguity(applicationRef: string, candidates: PublicSlipwayApplicationRefCandidate[]): string {
  const lines = [
    `Error (SLIPWAY_APPLICATION_AMBIGUOUS): Application ref ${applicationRef} matched multiple readable Applications.`,
    "Candidates:"
  ];
  for (const candidate of candidates) {
    const label = formatApplicationLabel(candidate);
    const details = [
      candidate.ownerAddress ? `owner ${candidate.ownerAddress}` : undefined,
      candidate.repository ? `repo ${candidate.repository}` : undefined,
      candidate.status ? `status ${candidate.status}` : undefined
    ].filter((item): item is string => item !== undefined);
    lines.push(`- ${label}${details.length > 0 ? ` (${details.join(", ")})` : ""}`);
  }
  lines.push("Use an Application uid/name, or pass --owner OWNER with the legacy id.");
  return lines.join("\n");
}

function formatDeleteBlocker(blocker: SlipwayApplicationDeleteBlocker): string {
  const label = blocker.code ?? "unknown";
  const count = typeof blocker.count === "number" ? ` (${blocker.count})` : "";
  return `${label}${count}`;
}

function formatApplicationLabel(
  application: Pick<PublicSlipwayApplicationSummary, "applicationUid" | "applicationName" | "applicationId"> | undefined,
  fallbackApplicationId = "unknown"
): string {
  // Label by the user-facing slug (or uid); never surface the internal
  // applicationId codename (it would re-leak after a rename).
  return application?.applicationName ?? application?.applicationUid ?? application?.applicationId ?? fallbackApplicationId;
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
