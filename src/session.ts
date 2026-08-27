import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  isExecutionHistoryResponse,
  formatExecutionHistory,
  type LiskovExecutionHistoryResponse
} from "./execution-history.js";
import {
  isOrganizationBillingResponse,
  isOrganizationListResponse,
  isOrganizationServiceCreditsResponse,
  isOrganizationTransactionsResponse,
  isOrganizationUseResponse,
  organizationBillingPath,
  organizationListPath,
  organizationServiceCreditsPath,
  organizationTransactionsPath,
  organizationUsePath,
  type LiskovOrganizationSummary,
  type LiskovOrganizationUseResponse
} from "./organization-client.js";
import {
  formatOrganizationBilling,
  formatOrganizationList,
  formatOrganizationServiceCredits,
  formatOrganizationTransactions,
  formatOrganizationUse
} from "./organization-output.js";
import {
  canonicalOrganizationId,
  organizationRequestHeaders,
  organizationSelector,
  OrganizationSelectorError
} from "./organization-context.js";
import { validateApplicationManifestV4 } from "./application-policy.js";
import { validateApplicationManifestV5 } from "./application-policy-v5.js";
import {
  formatPolicyExplanation,
  formatStatusExplanation,
  parsePolicyExplanation,
  policyExplanationPath
} from "./policy-explanation.js";
import {
  APPLICATION_LOGS_HEADER,
  eventGlobMatcher,
  formatApplicationLogLine,
  formatApplicationLogs,
  isLiskovApplicationLogsResponse,
  type LiskovApplicationLogLine,
  type LiskovApplicationLogsResponse
} from "./application-logs.js";
import {
  formatLaunchEligibility,
  readLaunchEligibility,
  type LaunchEligibilityRead
} from "./launch-eligibility.js";

export const DEFAULT_SLIPWAY_URL = "https://liskov.proof.computer";
const DEFAULT_RUNTIME_IMAGE_WORKFLOW_OUTPUT = ".github/workflows/liskov-runtime-image.yml";
const DEFAULT_RUNTIME_IMAGE_WORKFLOW_NAME = "Liskov Runtime Image Upload";
const DEFAULT_RUNTIME_IMAGE_OIDC_AUDIENCE = "liskov-runtime-image-upload";
// Long-poll hold requested per CLI login poll; the server caps waitMs at 20_000.
const CLI_LOGIN_POLL_WAIT_MS = 20_000;
const DEFAULT_RUNTIME_IMAGE_ACTIONS_REF =
  "proof-computer/liskov-github-actions/.github/workflows/runtime-image.yml@v1";

export interface SlipwayCliOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  organization?: string;
  environmentHandoffBuilder?: (input: SlipwayEnvironmentHandoffBuildInput) => Promise<SlipwayEncryptedEnvironmentHandoff>;
  openBrowser?: (url: string) => boolean | Promise<boolean>;
  sleepMs?: (ms: number) => Promise<void>;
  followContinue?: () => boolean;
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
  liskovUrl?: string;
  slipwayUrl?: string;
  sessionToken?: string;
  config?: string;
  json?: boolean;
  noBrowser?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Wall-clock timings for one browser-confirmed `proof liskov login`, measured
 * through the injected `SlipwayCliOptions.nowMs` seam so tests stay
 * deterministic. Present only on the `authorized` success payload.
 */
export interface SlipwayLoginTimings {
  /** `POST /api/cli-login/pending` round trip, including reading its JSON body. */
  pendingMs: number;
  /** Time spent opening the verification URL in a browser; `0` when `--no-browser`. */
  browserOpenMs: number;
  /** From just before the first poll request until the `authorized` poll response arrived. */
  waitForAuthorizationMs: number;
  /** Number of `POST /api/cli-login/{id}/poll` round trips, including the authorizing one. */
  pollCount: number;
  /** Poll round-trip distribution (fetch + JSON read), nearest-rank p50 and max; both `0` with no polls. */
  pollRoundTripMs: { p50: number; max: number };
  /** From function entry until just before the success payload was written. */
  totalMs: number;
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

export interface SlipwayApplicationPolicyExplainInput {
  applicationId: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationPolicyPublishInput {
  applicationRef: string;
  file: string;
  artifactDigest: string;
  bindingRevision: number;
  revocationEpoch: number;
  sourceRef: string;
  sourceCommit: string;
  workflowIdentity: string;
  expectedPointerVersion: number;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationListInput {
  deleted?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayOrganizationListInput {
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayOrganizationUseInput {
  organizationId?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayOrganizationBillingInput {
  organizationId?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayOrganizationServiceCreditsInput {
  organizationId?: string;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayOrganizationTransactionsInput {
  organizationId?: string;
  limit?: number;
  beforeMs?: number;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationDeleteInput {
  applicationRef: string;
  owner?: string;
  reason?: string;
  acknowledgeLiveResources?: boolean;
  force?: boolean;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationRetirementInput {
  applicationRef: string;
  reason?: string;
  yes?: boolean;
  slipwayUrl?: string;
  config?: string;
  json?: boolean;
}

export interface SlipwayApplicationRetirementCancelInput {
  applicationRef: string;
  reason?: string;
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

export interface SlipwayApplicationCreateInput {
  applicationId: string;
  displayName?: string;
  repository?: string;
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
  artifactVersion?: string;
  dryRun?: boolean;
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

export interface SlipwayApplicationLogsInput {
  applicationRef: string;
  limit?: number;
  deploymentId?: string;
  jobId?: string;
  origin?: "all" | "customer" | "runtime-ssh" | "runtime_ssh";
  follow?: boolean;
  fromStart?: boolean;
  event?: string;
  ndjson?: boolean;
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

export interface SlipwayAdminDeploySubmitRecoveryInput {
  operationId: string;
  expectOrganization: string;
  expectApplication: string;
  expectApplicationUid: string;
  expectDeployment: string;
  expectLocalJob: string;
  expectExecution: string;
  expectProposal: string;
  expectReserve: string;
  expectOperationStatus: string;
  expectLocalJobStatus: string;
  expectReserveStatus: string;
  finalizedBlockNumber: number;
  finalizedBlockHash: string;
  extrinsicIndex: number;
  transactionHash: string;
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
  manifestPath: string;
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

export interface SlipwayApplicationImportInput {
  file?: string;
  github?: string;
  serverFetch?: boolean;
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
  previewPaused?: boolean;
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
  limit?: number;
  offset?: number;
  statuses?: readonly string[];
  reasons?: readonly string[];
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
  requireEnvironmentBootstrap?: boolean;
  requireOneGeneration?: boolean;
  requireZeroRetries?: boolean;
  minimumEnvironmentRunwayMs?: number;
  minimumRuntimeDurationMs?: number;
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
  | { kind: "github_test"; githubUserId?: string; login?: string; repositories?: readonly string[] }
  | { kind: "github_app"; githubUserId?: string; login?: string; avatarUrl?: string; repositories?: readonly string[]; installations?: readonly unknown[] }
  | { kind?: string; [key: string]: unknown };

interface SlipwayApiSessionResponse {
  ok?: boolean;
  session?: PublicSlipwaySession;
  organization?: LiskovOrganizationSummary;
  organizations?: LiskovOrganizationSummary[];
  organizationContext?: {
    source: "request" | "session";
    effective: LiskovOrganizationSummary;
    sessionDefault: LiskovOrganizationSummary | null;
  };
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
  waitedMs?: number;
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
  organizationId?: string;
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

interface SlipwayApplicationDeleteImpact {
  activeDeploymentCount?: number;
  liveJobCount?: number;
  pendingOperationCount?: number;
  hasLiveOrPendingResources?: boolean;
  stopsFuturePlanning?: boolean;
  existingResourcesContinue?: boolean;
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
  changed?: boolean;
  application?: PublicSlipwayApplicationSummary;
  impact?: SlipwayApplicationDeleteImpact;
  error?: string;
  reason?: string;
  candidates?: PublicSlipwayApplicationRefCandidate[];
  [key: string]: unknown;
}

interface SlipwayApplicationRetirementResponse extends SlipwayGenericResponse {
  domain?: string;
  lifecycleState?: string;
  creationAvailability?: {
    domain?: string;
    available?: boolean;
    reason?: "rollout_disabled" | "canary_uid_not_allowed" | "kill_switch_enabled" | string;
  };
  capabilities?: {
    create?: boolean;
    cancel?: boolean;
  };
  preview?: Record<string, unknown>;
  previousRetirement?: Record<string, unknown>;
  retirement?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
  legacyCleanup?: Record<string, unknown>;
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
}

interface SlipwayApplicationCreateResponse {
  ok?: boolean;
  application?: PublicSlipwayApplicationSummary;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SlipwayApplicationRenameResponse {
  ok?: boolean;
  dryRun?: boolean;
  changed?: boolean;
  from?: SlipwayApplicationRenameRefs;
  to?: SlipwayApplicationRenameRefs;
  application?: PublicSlipwayApplicationSummary;
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

async function loginWithMintedSessionToken(input: {
  sessionToken: string;
  slipwayUrl: string;
  sessionFile: string;
  json?: boolean;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  options: SlipwayCliOptions;
}): Promise<number> {
  const nowMs = input.options.nowMs ?? Date.now;
  let response: Response;
  try {
    response = await input.fetchImpl(new URL("/api/session", input.slipwayUrl), {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.sessionToken}`
      }
    });
  } catch (error) {
    writeStructuredOrHuman(input.options, input.json, {
      ok: false,
      error: "SLIPWAY_CLI_LOGIN_CREATE_FAILED",
      message: errorMessage(error),
      slipwayUrl: input.slipwayUrl,
      sessionFile: input.sessionFile
    }, `Error (SLIPWAY_CLI_LOGIN_CREATE_FAILED): could not reach Liskov at ${input.slipwayUrl}.`);
    return 1;
  }
  const body = await readJsonResponse<SlipwayApiSessionResponse>(response);
  if (!response.ok || body?.ok !== true || body.session === undefined) {
    writeStructuredOrHuman(input.options, input.json, {
      ok: false,
      error: "SLIPWAY_SESSION_UNAUTHORIZED",
      status: response.status,
      reason: body?.reason ?? body?.error,
      slipwayUrl: input.slipwayUrl,
      sessionFile: input.sessionFile
    }, "Error (SLIPWAY_SESSION_UNAUTHORIZED): Liskov rejected the session token.");
    return 1;
  }
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: input.slipwayUrl,
    sessionToken: input.sessionToken,
    savedAtMs: nowMs(),
    session: body.session
  }, { config: input.sessionFile, env: input.env, nowMs });
  writeStructuredOrHuman(input.options, input.json, {
    ok: true,
    status: "authorized",
    slipwayUrl: input.slipwayUrl,
    sessionFile: input.sessionFile,
    session: body.session
  }, `Logged in to ${input.slipwayUrl} as ${formatSessionIdentity(body.session)}.`);
  return 0;
}

export async function runSlipwayLogin(input: SlipwayLoginInput, options: SlipwayCliOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const slipwayUrl = normalizeBaseUrl(
    input.liskovUrl ?? input.slipwayUrl ?? env.LISKOV_URL ?? DEFAULT_SLIPWAY_URL
  );
  const sessionFile = resolveSlipwaySessionFile({ config: input.config, env });
  const fetchImpl = options.fetchImpl ?? fetch;
  const mintedToken = input.sessionToken ?? env.LISKOV_SESSION_TOKEN;
  if (mintedToken && mintedToken.length > 0) {
    return loginWithMintedSessionToken({
      sessionToken: mintedToken,
      slipwayUrl,
      sessionFile,
      json: input.json,
      env,
      fetchImpl,
      options
    });
  }
  const nowMs = options.nowMs ?? Date.now;
  const enteredAtMs = nowMs();
  const sessionToken = randomHex(32);
  const pendingSecret = randomHex(32);
  let response: Response;
  const pendingStartedAtMs = nowMs();
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
  const pendingMs = nowMs() - pendingStartedAtMs;
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
  let browserOpened = false;
  let browserOpenMs = 0;
  if (input.noBrowser !== true) {
    const browserOpenStartedAtMs = nowMs();
    browserOpened = await openVerificationUrl(verificationUri, options);
    browserOpenMs = nowMs() - browserOpenStartedAtMs;
  }
  emitLoginInstruction(options, {
    json: input.json,
    browserOpened,
    verificationUri,
    userCode
  });

  const startedAtMs = nowMs();
  const expiresAtMs = typeof cliLogin?.expiresAtMs === "number" ? cliLogin.expiresAtMs : startedAtMs + 10 * 60_000;
  const timeoutAtMs = input.timeoutMs === undefined ? expiresAtMs : Math.min(expiresAtMs, startedAtMs + Math.max(1, input.timeoutMs));
  const pollIntervalMs = Math.max(100, input.pollIntervalMs ?? cliLogin?.pollIntervalMs ?? 2_000);
  const sleep = options.sleepMs ?? defaultSleep;
  const pollRoundTripSamplesMs: number[] = [];
  let firstPollStartedAtMs = startedAtMs;

  while (nowMs() <= timeoutAtMs) {
    let pollResponse: Response;
    const pollStartedAtMs = nowMs();
    if (pollRoundTripSamplesMs.length === 0) firstPollStartedAtMs = pollStartedAtMs;
    try {
      pollResponse = await fetchImpl(new URL(`/api/cli-login/${encodeURIComponent(pendingLoginId)}/poll`, slipwayUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({ pendingSecret, waitMs: CLI_LOGIN_POLL_WAIT_MS })
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
    const pollEndedAtMs = nowMs();
    pollRoundTripSamplesMs.push(pollEndedAtMs - pollStartedAtMs);
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
      const waitForAuthorizationMs = pollEndedAtMs - firstPollStartedAtMs;
      await saveSlipwaySession({
        version: 1,
        slipwayUrl,
        sessionToken,
        savedAtMs: nowMs(),
        session: polled.session
      }, { config: sessionFile, env, nowMs });
      const sortedPollRoundTripsMs = [...pollRoundTripSamplesMs].sort((a, b) => a - b);
      const timings: SlipwayLoginTimings = {
        pendingMs,
        browserOpenMs,
        waitForAuthorizationMs,
        pollCount: pollRoundTripSamplesMs.length,
        pollRoundTripMs: {
          p50: percentile(sortedPollRoundTripsMs, 50),
          max: sortedPollRoundTripsMs.length === 0 ? 0 : sortedPollRoundTripsMs[sortedPollRoundTripsMs.length - 1]
        },
        totalMs: nowMs() - enteredAtMs
      };
      writeStructuredOrHuman(options, input.json, {
        ok: true,
        status: "authorized",
        slipwayUrl,
        sessionFile,
        browserOpened,
        session: polled.session,
        timings
      }, `Logged in to ${slipwayUrl} as ${formatSessionIdentity(polled.session)}.`);
      emitLoginTimings(options, { json: input.json, timings });
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

    // A long-polling server already held this request for waitedMs; re-poll at once.
    // Old servers omit waitedMs, and a server that answered without waiting reports 0:
    // both keep the interval sleep.
    const serverHeldRequest = typeof polled.waitedMs === "number" && polled.waitedMs > 0;
    if (!serverHeldRequest) await sleep(pollIntervalMs);
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
  let requestOrganization: string | undefined;
  try {
    requestOrganization = organizationSelector(options.organization);
  } catch (error) {
    return writeOrganizationSelectorError(options, input.json, error);
  }
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
  let headers: Record<string, string>;
  try {
    headers = organizationRequestHeaders(saved.sessionToken, requestOrganization);
  } catch (error) {
    return writeOrganizationSelectorError(options, input.json, error);
  }
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/session", slipwayUrl), {
      method: "GET",
      headers
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
    if (writeOrganizationServerFailure(options, input.json, body)) return 1;
    const error = response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : body?.error === "invalid_organization_selector" || body?.error === "not_a_member"
        ? body.error
        : "SLIPWAY_SESSION_READ_FAILED";
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
    session: body.session,
    organization: body.organization,
    organizations: body.organizations,
    organizationContext: body.organizationContext
  }, [
    `Logged in to ${slipwayUrl} as ${formatSessionIdentity(body.session)}.`,
    (body.organizationContext?.effective ?? body.organization)
      ? `Effective organization: ${formatOrganizationIdentity((body.organizationContext?.effective ?? body.organization)!)}.`
      : undefined,
    body.organizationContext
      ? body.organizationContext.sessionDefault
        ? `Persistent organization: ${formatOrganizationIdentity(body.organizationContext.sessionDefault)}.`
        : "Persistent organization: unavailable (the stored selection is not an active membership)."
      : body.organization
        ? `Persistent organization: ${formatOrganizationIdentity(body.organization)}.`
        : undefined
  ].filter((line): line is string => line !== undefined).join(" "));
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

  const explanationRequest = await authenticatedSlipwayRequest<unknown>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: policyExplanationPath(input.applicationId),
    requestErrorCode: "SLIPWAY_APPLICATION_POLICY_EXPLAIN_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application policy explanation",
    optional: true
  }, options);
  const attached = attachPolicyExplanation(body, explanationRequest);

  writeStructuredOrHuman(
    options,
    input.json,
    attached.body,
    [formatApplicationStatus(body, input.applicationId), attached.human].filter(Boolean).join("\n")
  );
  return 0;
}

export async function runSlipwayApplicationPolicyExplain(
  input: SlipwayApplicationPolicyExplainInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const request = await authenticatedSlipwayRequest<unknown>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: policyExplanationPath(input.applicationId),
    requestErrorCode: "SLIPWAY_APPLICATION_POLICY_EXPLAIN_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application policy explanation"
  }, options);
  if (!request.ok) return request.exitCode;

  const parsed = parsePolicyExplanation(request.body);
  if (!parsed.ok) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: parsed.error,
      message: parsed.message,
      applicationId: input.applicationId,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${parsed.error}): ${parsed.message}`);
    return 1;
  }

  writeStructuredOrHuman(options, input.json, {
    ok: true,
    schema: parsed.explanation.schema,
    applicationId: input.applicationId,
    explanation: parsed.explanation,
    nextActions: parsed.nextActions
  }, formatPolicyExplanation(parsed.explanation, parsed.nextActions));
  return 0;
}

export async function runSlipwayApplicationList(input: SlipwayApplicationListInput, options: SlipwayCliOptions = {}): Promise<number> {
  const request = await authenticatedSlipwayRequest<SlipwayApplicationListResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: input.deleted === true ? "/api/applications?includeDeleted=true" : "/api/applications",
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

  const output = input.deleted === true
    ? {
        ...body,
        count: body.applications.filter((application) => application.status === "deleted" || typeof application.deletedAtMs === "number").length,
        applications: body.applications.filter((application) => application.status === "deleted" || typeof application.deletedAtMs === "number")
      }
    : body;
  writeStructuredOrHuman(
    options,
    input.json,
    output,
    formatApplicationList(output)
  );
  return 0;
}

export async function runSlipwayOrganizationList(
  input: SlipwayOrganizationListInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  return runSlipwayOrganizationRead(input, {
    path: organizationListPath(),
    organizationSelector: null,
    errorCode: "SLIPWAY_ORGANIZATION_LIST_FAILED",
    fetchFailedMessage: "could not list Liskov organizations",
    validate: isOrganizationListResponse,
    format: formatOrganizationList
  }, options);
}

export async function runSlipwayOrganizationUse(
  input: SlipwayOrganizationUseInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const errorCode = "SLIPWAY_ORGANIZATION_USE_FAILED";
  const organization = await resolveExplicitOrganization(input, options, errorCode);
  if (!organization.ok) return organization.exitCode;
  const request = await authenticatedSlipwayJsonRequest<LiskovOrganizationUseResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: organizationUsePath(),
    body: { organizationId: organization.organizationId },
    organizationSelector: null,
    requestErrorCode: errorCode,
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not select the active Liskov organization"
  }, options);
  if (!request.ok) return request.exitCode;
  if (!request.response.ok || request.body?.ok === false) {
    return writeCommandResponse({
      body: request.body,
      response: request.response,
      errorCode,
      json: input.json,
      human: () => "Liskov organization selection failed.",
      options
    });
  }
  if (!isOrganizationUseResponse(request.body)) {
    return writeMalformedReadResponse(errorCode, request.response, input.json, options);
  }
  return writeCommandResponse({
    body: request.body,
    response: request.response,
    errorCode,
    json: input.json,
    human: () => formatOrganizationUse(request.body!),
    options
  });
}

export async function runSlipwayOrganizationBilling(
  input: SlipwayOrganizationBillingInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const organization = await resolveExplicitOrganization(input, options, "SLIPWAY_ORGANIZATION_BILLING_FAILED");
  if (!organization.ok) return organization.exitCode;
  return runSlipwayOrganizationRead(input, {
    path: organizationBillingPath(organization.organizationId),
    organizationSelector: null,
    errorCode: "SLIPWAY_ORGANIZATION_BILLING_FAILED",
    fetchFailedMessage: "could not read Liskov organization billing",
    validate: isOrganizationBillingResponse,
    format: formatOrganizationBilling
  }, options);
}

export async function runSlipwayOrganizationServiceCredits(
  input: SlipwayOrganizationServiceCreditsInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const organization = await resolveExplicitOrganization(input, options, "SLIPWAY_ORGANIZATION_SERVICE_CREDITS_FAILED");
  if (!organization.ok) return organization.exitCode;
  return runSlipwayOrganizationRead(input, {
    path: organizationServiceCreditsPath(organization.organizationId),
    organizationSelector: null,
    errorCode: "SLIPWAY_ORGANIZATION_SERVICE_CREDITS_FAILED",
    fetchFailedMessage: "could not read Liskov organization Service Credits",
    validate: isOrganizationServiceCreditsResponse,
    format: formatOrganizationServiceCredits
  }, options);
}

export async function runSlipwayOrganizationTransactions(
  input: SlipwayOrganizationTransactionsInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const organization = await resolveExplicitOrganization(input, options, "SLIPWAY_ORGANIZATION_TRANSACTIONS_FAILED");
  if (!organization.ok) return organization.exitCode;
  return runSlipwayOrganizationRead(input, {
    path: organizationTransactionsPath(organization.organizationId, {
      limit: input.limit,
      beforeMs: input.beforeMs
    }),
    organizationSelector: null,
    errorCode: "SLIPWAY_ORGANIZATION_TRANSACTIONS_FAILED",
    fetchFailedMessage: "could not list Liskov organization billing transactions",
    validate: isOrganizationTransactionsResponse,
    format: (body) => formatOrganizationTransactions(organization.organizationId, body)
  }, options);
}

async function resolveExplicitOrganization(
  input: { organizationId?: string; config?: string; slipwayUrl?: string; json?: boolean },
  options: SlipwayCliOptions,
  errorCode: string
): Promise<{ ok: true; organizationId: string } | { ok: false; exitCode: number }> {
  let selector: string;
  try {
    selector = organizationSelector(input.organizationId ?? options.organization, { required: true })!;
  } catch (error) {
    return { ok: false, exitCode: writeOrganizationSelectorError(options, input.json, error) };
  }
  const request = await authenticatedSlipwayRequest<unknown>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: organizationListPath(),
    organizationSelector: null,
    requestErrorCode: errorCode,
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not resolve the Liskov organization selector"
  }, options);
  if (!request.ok) return request;
  if (!request.response.ok) {
    return {
      ok: false,
      exitCode: writeCommandResponse({
        body: request.body as { ok?: boolean; error?: string; reason?: string } | undefined,
        response: request.response,
        errorCode,
        json: input.json,
        human: () => "Liskov organization resolution failed.",
        options
      })
    };
  }
  if (!isOrganizationListResponse(request.body)) {
    return {
      ok: false,
      exitCode: writeMalformedReadResponse(errorCode, request.response, input.json, options)
    };
  }
  const organizationId = canonicalOrganizationId(selector, request.body.organizations);
  if (organizationId === undefined) {
    writeStructuredOrHuman(
      options,
      input.json,
      { ok: false, error: "not_a_member", selector },
      `Error (not_a_member): no active organization membership exactly matches ${selector}.`
    );
    return { ok: false, exitCode: 1 };
  }
  return { ok: true, organizationId };
}

async function runSlipwayOrganizationRead<
  T extends { ok?: boolean; error?: string; reason?: string; [key: string]: unknown }
>(
  input: { config?: string; slipwayUrl?: string; json?: boolean },
  command: {
    path: string;
    organizationSelector?: string | null;
    errorCode: string;
    fetchFailedMessage: string;
    validate: (value: unknown) => value is T;
    format: (body: T) => string;
  },
  options: SlipwayCliOptions
): Promise<number> {
  const request = await authenticatedSlipwayRequest<T>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: command.path,
    organizationSelector: command.organizationSelector,
    requestErrorCode: command.errorCode,
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: command.fetchFailedMessage
  }, options);
  if (!request.ok) return request.exitCode;
  if (!request.response.ok || request.body?.ok === false) {
    return writeCommandResponse({
      body: request.body,
      response: request.response,
      errorCode: command.errorCode,
      json: input.json,
      human: () => "Liskov organization read failed.",
      options
    });
  }
  if (!command.validate(request.body)) {
    return writeMalformedReadResponse(
      command.errorCode,
      request.response,
      input.json,
      options
    );
  }
  return writeCommandResponse({
    body: request.body,
    response: request.response,
    errorCode: command.errorCode,
    json: input.json,
    human: () => command.format(request.body!),
    options
  });
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
  const reason = input.reason?.trim();
  if (input.yes === true && !reason) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_DELETE_REASON_REQUIRED",
      applicationRef: input.applicationRef
    }, "Error (SLIPWAY_APPLICATION_DELETE_REASON_REQUIRED): confirmed deletion requires a non-empty --reason.");
    return 1;
  }
  const request = input.yes === true
    ? await authenticatedSlipwayJsonRequest<SlipwayApplicationDeleteResponse>({
        config: input.config,
        slipwayUrl: input.slipwayUrl,
        json: input.json,
        method: "DELETE",
        path: applicationDeletePath(input.applicationRef, input.owner),
        body: {
          confirm: true,
          acknowledgeLiveResources: input.acknowledgeLiveResources === true,
          force: input.force === true ? true : undefined,
          reason
        },
        requestErrorCode: "SLIPWAY_APPLICATION_DELETE_FAILED",
        notFoundMessage: "No Liskov CLI session is stored locally.",
        fetchFailedMessage: "could not delete Liskov Application"
      }, options)
    : await authenticatedSlipwayRequest<SlipwayApplicationDeleteResponse>({
        config: input.config,
        slipwayUrl: input.slipwayUrl,
        json: input.json,
        path: applicationDeletionPreviewPath(input.applicationRef, input.owner),
        requestErrorCode: "SLIPWAY_APPLICATION_DELETE_FAILED",
        notFoundMessage: "No Liskov CLI session is stored locally.",
        fetchFailedMessage: "could not preview Liskov Application deletion"
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

export async function runSlipwayApplicationRetirement(
  input: SlipwayApplicationRetirementInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const reason = input.reason?.trim();
  if (reason && reason.length > 500) {
    return writeRetirementInputError(
      options,
      input.json,
      "SLIPWAY_APPLICATION_RETIREMENT_REASON_TOO_LONG",
      "Retirement reason must contain at most 500 characters."
    );
  }
  const path = applicationRetirementPath(input.applicationRef);
  const readRequest = await authenticatedSlipwayRequest<SlipwayApplicationRetirementResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path,
    requestErrorCode: "SLIPWAY_APPLICATION_RETIREMENT_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read Liskov Application retirement"
  }, options);
  if (!readRequest.ok) return readRequest.exitCode;
  if (input.yes !== true) {
    return writeRetirementResponse(
      readRequest.body,
      readRequest.response,
      input.json,
      options,
      "SLIPWAY_APPLICATION_RETIREMENT_FAILED"
    );
  }
  if (!readRequest.body || !readRequest.response.ok || readRequest.body.ok === false) {
    return writeRetirementResponse(
      readRequest.body,
      readRequest.response,
      input.json,
      options,
      "SLIPWAY_APPLICATION_RETIREMENT_FAILED"
    );
  }
  const readRetirement = objectRecord(readRequest.body.retirement);
  const activeReplay = readRetirement.status === "active";
  const receiptReplay = Object.keys(objectRecord(readRequest.body.receipt)).length > 0;
  const creationAvailable = readRequest.body.creationAvailability?.available === true;
  const canCreate = readRequest.body.capabilities?.create === true;
  if (!activeReplay && !receiptReplay && (!creationAvailable || !canCreate)) {
    writeStructuredOrHuman(
      options,
      input.json,
      readRequest.body,
      formatApplicationRetirement(readRequest.body)
    );
    return 1;
  }
  const request = await authenticatedSlipwayJsonRequest<SlipwayApplicationRetirementResponse>({
        config: input.config,
        slipwayUrl: input.slipwayUrl,
        json: input.json,
        method: "POST",
        path,
        body: reason ? { reason } : {},
        requestErrorCode: "SLIPWAY_APPLICATION_RETIREMENT_FAILED",
        notFoundMessage: "No Liskov CLI session is stored locally.",
        fetchFailedMessage: "could not start Liskov Application retirement"
      }, options);
  if (!request.ok) return request.exitCode;
  return writeRetirementResponse(
    request.body,
    request.response,
    input.json,
    options,
    "SLIPWAY_APPLICATION_RETIREMENT_FAILED"
  );
}

export async function runSlipwayApplicationRetirementCancel(
  input: SlipwayApplicationRetirementCancelInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  if (input.yes !== true) {
    return writeConfirmationRequired(
      options,
      input.json,
      "SLIPWAY_APPLICATION_RETIREMENT_CANCEL_CONFIRMATION_REQUIRED",
      "Cancelling application retirement"
    );
  }
  const reason = input.reason?.trim();
  if (reason && reason.length > 500) {
    return writeRetirementInputError(
      options,
      input.json,
      "SLIPWAY_APPLICATION_RETIREMENT_CANCEL_REASON_TOO_LONG",
      "Cancellation reason must contain at most 500 characters."
    );
  }
  const request =
    await authenticatedSlipwayJsonRequest<SlipwayApplicationRetirementResponse>({
      config: input.config,
      slipwayUrl: input.slipwayUrl,
      json: input.json,
      method: "POST",
      path: `${applicationRetirementPath(input.applicationRef)}/cancel`,
      body: reason ? { reason } : {},
      requestErrorCode: "SLIPWAY_APPLICATION_RETIREMENT_CANCEL_FAILED",
      notFoundMessage: "No Liskov CLI session is stored locally.",
      fetchFailedMessage: "could not cancel Liskov Application retirement"
    }, options);
  if (!request.ok) return request.exitCode;
  return writeRetirementResponse(
    request.body,
    request.response,
    input.json,
    options,
    "SLIPWAY_APPLICATION_RETIREMENT_CANCEL_FAILED"
  );
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

export async function runSlipwayApplicationCreate(input: SlipwayApplicationCreateInput, options: SlipwayCliOptions = {}): Promise<number> {
  const applicationId = (input.applicationId ?? "").trim();
  if (!applicationId) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_CREATE_INVALID",
      message: "applicationId must not be empty"
    }, "Error (SLIPWAY_APPLICATION_CREATE_INVALID): a non-empty application id is required.");
    return 1;
  }
  const body: Record<string, unknown> = { applicationId };
  const displayName = input.displayName?.trim();
  if (displayName) body.displayName = displayName;
  const repository = input.repository?.trim();
  if (repository) body.repository = repository;
  const request = await authenticatedSlipwayJsonRequest<SlipwayApplicationCreateResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: "/api/applications",
    body,
    requestErrorCode: "SLIPWAY_APPLICATION_CREATE_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not create Liskov Application"
  }, options);
  if (!request.ok) return request.exitCode;

  const responseBody = request.body;
  if (responseBody?.ok !== true) {
    const error = request.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : "SLIPWAY_APPLICATION_CREATE_FAILED";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: request.response.status,
      reason: responseBody?.reason ?? responseBody?.error,
      applicationId,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Liskov could not create Application ${applicationId}${responseBody?.reason ? `: ${responseBody.reason}` : "."}`);
    return 1;
  }

  writeStructuredOrHuman(options, input.json, responseBody, formatApplicationCreate(responseBody));
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
  if (input.dryRun && (input.paused || reason)) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_PUBLISH_DRY_RUN_STATUS_CONFLICT",
      applicationRef: input.applicationRef
    }, "Error (SLIPWAY_APPLICATION_PUBLISH_DRY_RUN_STATUS_CONFLICT): --dry-run cannot be combined with --paused or --reason.");
    return 1;
  }
  if (!input.yes && !input.dryRun) {
    return writeConfirmationRequired(options, input.json, "SLIPWAY_APPLICATION_PUBLISH_CONFIRMATION_REQUIRED", "Application publish");
  }

  const preflightBody = input.artifactVersion
    ? { artifactVersionId: input.artifactVersion }
    : {};
  const preflight = await authenticatedSlipwayJsonRequest<SlipwayGenericResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/publish/preflight`,
    body: preflightBody,
    requestErrorCode: "SLIPWAY_APPLICATION_PUBLISH_PREFLIGHT_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not preflight Liskov Application publication"
  }, options);
  if (!preflight.ok) return preflight.exitCode;
  if (preflight.body?.ok !== true) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_PUBLISH_PREFLIGHT_FAILED",
      status: preflight.response.status,
      reason: preflight.body?.reason ?? preflight.body?.error,
      applicationRef: input.applicationRef
    }, `Error (SLIPWAY_APPLICATION_PUBLISH_PREFLIGHT_FAILED): Liskov could not preflight publication for ${input.applicationRef}.`);
    return 1;
  }
  if (input.dryRun) {
    writeStructuredOrHuman(
      options,
      input.json,
      preflight.body,
      `Publication preflight for ${input.applicationRef}: ${preflight.body.publicationReady === true ? "ready" : "blocked"}.`
    );
    return preflight.body.publicationReady === true ? 0 : 1;
  }
  if (preflight.body.publicationReady !== true || typeof preflight.body.authoredDigest !== "string") {
    writeStructuredOrHuman(options, input.json, {
      ...preflight.body,
      ok: false,
      error: "SLIPWAY_APPLICATION_PUBLISH_NOT_READY",
      applicationRef: input.applicationRef
    }, `Error (SLIPWAY_APPLICATION_PUBLISH_NOT_READY): publication preflight for ${input.applicationRef} is blocked.`);
    return 1;
  }
  const publishBody: Record<string, unknown> = {
    expectedAuthoredDigest: preflight.body.authoredDigest
  };
  if (input.artifactVersion) publishBody.artifactVersionId = input.artifactVersion;
  if (input.paused) {
    publishBody.postPublishStatus = "paused";
    publishBody.reason = reason;
  }
  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/publish`,
    body: publishBody,
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

export async function runSlipwayApplicationPolicyPublish(
  input: SlipwayApplicationPolicyPublishInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  if (!input.yes) {
    return writeConfirmationRequired(
      options,
      input.json,
      "SLIPWAY_APPLICATION_POLICY_PUBLISH_CONFIRMATION_REQUIRED",
      "Registered V5 policy publication"
    );
  }

  const invalidInput = registeredPolicyPublicationInputError(input);
  if (invalidInput) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_POLICY_PUBLISH_INVALID",
      message: invalidInput,
      applicationRef: input.applicationRef
    }, `Error (SLIPWAY_APPLICATION_POLICY_PUBLISH_INVALID): ${invalidInput}`);
    return 1;
  }

  let document: unknown;
  try {
    document = JSON.parse(await readFile(input.file, "utf8")) as unknown;
  } catch (error) {
    const message = errorMessage(error);
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_POLICY_PUBLISH_FILE_INVALID",
      message,
      applicationRef: input.applicationRef,
      file: input.file
    }, `Error (SLIPWAY_APPLICATION_POLICY_PUBLISH_FILE_INVALID): could not read ${input.file}: ${message}`);
    return 1;
  }

  const diagnostics = validateApplicationManifestV5(document);
  const documentRoot = objectRecord(document);
  if (documentRoot.applicationId !== input.applicationRef) {
    diagnostics.push({
      code: "invalid_manifest",
      message: `applicationId must match the exact publication target ${input.applicationRef}`,
      pointer: "/applicationId"
    });
  }
  const release = objectRecord(documentRoot.release);
  if (release.mode !== "source") {
    diagnostics.push({
      code: "unsupported_policy_feature",
      message: "this command publishes source releases; release.mode must be source",
      pointer: "/release/mode"
    });
  }
  if (diagnostics.length > 0) {
    const first = diagnostics[0]!;
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_POLICY_PUBLISH_MANIFEST_INVALID",
      applicationRef: input.applicationRef,
      file: input.file,
      diagnostics
    }, `Error (SLIPWAY_APPLICATION_POLICY_PUBLISH_MANIFEST_INVALID): ${first.code} ${first.pointer || "/"}: ${first.message}`);
    return 1;
  }

  return runSlipwayJsonCommand({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/policy-versions`,
    body: {
      document,
      release: {
        mode: "source",
        artifactDigest: input.artifactDigest,
        build: {
          bindingRevision: input.bindingRevision,
          revocationEpoch: input.revocationEpoch,
          sourceRef: input.sourceRef,
          sourceCommit: input.sourceCommit,
          workflowIdentity: input.workflowIdentity,
          artifactDigests: [input.artifactDigest]
        }
      },
      expectedActivePointerVersion: input.expectedPointerVersion
    },
    errorCode: "SLIPWAY_APPLICATION_POLICY_PUBLISH_FAILED",
    fetchFailedMessage: "could not publish registered V5 policy",
    human: (body) => {
      const policy = objectRecord(objectRecord(body).policyVersion);
      const version = stringValue(policy.policyVersionId) ?? "registered V5 policy";
      const pointer = numberValue(policy.activePointerVersion);
      const generation = numberValue(policy.handlerGeneration);
      return `Published ${version} for ${input.applicationRef}${pointer === undefined ? "" : ` at pointer ${pointer}`}${generation === undefined ? "" : ` under handler generation ${generation}`}.`;
    }
  }, options);
}

function registeredPolicyPublicationInputError(input: SlipwayApplicationPolicyPublishInput): string | undefined {
  if (!input.file.trim()) return "--file must not be empty.";
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.artifactDigest)) {
    return "--artifact-digest must be sha256: followed by 64 lowercase hexadecimal characters.";
  }
  if (!Number.isSafeInteger(input.bindingRevision) || input.bindingRevision < 0) {
    return "--binding-revision must be a non-negative safe integer.";
  }
  if (!Number.isSafeInteger(input.revocationEpoch) || input.revocationEpoch < 0) {
    return "--revocation-epoch must be a non-negative safe integer.";
  }
  if (!input.sourceRef.trim()) return "--source-ref must not be empty.";
  if (!/^[0-9a-f]{40}$/u.test(input.sourceCommit)) {
    return "--source-commit must be a 40-character lowercase hexadecimal Git commit.";
  }
  if (!input.workflowIdentity.trim()) return "--workflow-identity must not be empty.";
  if (!Number.isSafeInteger(input.expectedPointerVersion) || input.expectedPointerVersion < 0) {
    return "--expected-pointer-version must be a non-negative safe integer.";
  }
  return undefined;
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

const APPLICATION_LOGS_POLL_INTERVAL_MS = 2_000;
const APPLICATION_LOGS_MAX_CONSECUTIVE_FAILURES = 30;

export async function runSlipwayApplicationLogs(input: SlipwayApplicationLogsInput, options: SlipwayCliOptions = {}): Promise<number> {
  const inputError = applicationLogsInputError(input);
  if (inputError) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_APPLICATION_LOGS_INPUT_INVALID",
      message: inputError,
      applicationRef: input.applicationRef
    }, `Error (SLIPWAY_APPLICATION_LOGS_INPUT_INVALID): ${inputError}`);
    return 1;
  }

  const streaming = input.follow === true || input.fromStart === true;
  const eventMatches = input.event === undefined ? undefined : eventGlobMatcher(input.event);
  const visibleLogs = (logs: LiskovApplicationLogLine[]): LiskovApplicationLogLine[] =>
    eventMatches === undefined ? logs : logs.filter((line) => typeof line.event === "string" && eventMatches(line.event));

  const requestPage = async (
    page: { order: "asc" | "desc"; cursor?: string } | undefined,
    requestOptions: SlipwayCliOptions
  ) => {
    const query = new URLSearchParams();
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    if (input.deploymentId !== undefined) query.set("deploymentId", input.deploymentId.trim());
    if (input.jobId !== undefined) query.set("jobId", input.jobId.trim());
    if (input.origin !== undefined) {
      query.set("origin", input.origin === "runtime-ssh" || input.origin === "runtime_ssh" ? "runtime_ssh" : input.origin);
    }
    if (page !== undefined) {
      query.set("order", page.order);
      if (page.cursor !== undefined) query.set("cursor", page.cursor);
    }
    const queryString = query.toString();
    return authenticatedSlipwayRequest<LiskovApplicationLogsResponse>({
      config: input.config,
      slipwayUrl: input.slipwayUrl,
      json: input.json,
      path: `/api/applications/${encodeURIComponent(input.applicationRef)}/logs${queryString ? `?${queryString}` : ""}`,
      requestErrorCode: "SLIPWAY_APPLICATION_LOGS_FAILED",
      notFoundMessage: "No Liskov CLI session is stored locally.",
      fetchFailedMessage: "could not read Liskov Application logs",
      redactFetchError: true
    }, requestOptions);
  };
  // authenticatedSlipwayRequest writes only on failure; in ndjson mode divert
  // those failure lines to stderr so stdout stays records-only.
  const firstRequestOptions: SlipwayCliOptions = input.ndjson
    ? { ...options, stdout: (line) => emitError(options, line) }
    : options;
  const writeLogsError = (structured: Record<string, unknown>, human: string): void => {
    if (input.ndjson) emitError(options, human);
    else writeStructuredOrHuman(options, input.json, structured, human);
  };

  const request = await requestPage(
    streaming ? { order: input.fromStart === true ? "asc" : "desc" } : undefined,
    firstRequestOptions
  );
  if (!request.ok) return request.exitCode;

  const body = request.body;
  if (!request.response.ok || !isLiskovApplicationLogsResponse(body)) {
    const error = request.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : request.response.status === 404
        ? "SLIPWAY_APPLICATION_NOT_FOUND"
        : body === undefined || request.response.ok
          ? "SLIPWAY_APPLICATION_LOGS_RESPONSE_INVALID"
          : "SLIPWAY_APPLICATION_LOGS_FAILED";
    writeLogsError({
      ok: false,
      error,
      status: request.response.status,
      applicationRef: input.applicationRef,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (${error}): Liskov could not read logs for Application ${input.applicationRef}.`);
    return 1;
  }

  if (!streaming) {
    if (input.ndjson) {
      if (!body.available) {
        emitError(options, formatApplicationLogs(body, input.applicationRef));
        return 0;
      }
      for (const line of visibleLogs(body.logs)) emit(options, JSON.stringify(line));
      return 0;
    }
    const rendered = body.available && eventMatches !== undefined ? { ...body, logs: visibleLogs(body.logs) } : body;
    writeStructuredOrHuman(options, input.json, body, formatApplicationLogs(rendered, input.applicationRef));
    return 0;
  }

  // Streaming modes never run with --json (excluded before network I/O).
  if (!body.available) {
    const unavailable = formatApplicationLogs(body, input.applicationRef);
    if (input.ndjson) emitError(options, unavailable);
    else emit(options, unavailable);
    return 0;
  }
  if (typeof body.latestCursor !== "string" || typeof body.order !== "string") {
    writeLogsError({
      ok: false,
      error: "SLIPWAY_APPLICATION_LOGS_PAGINATION_UNSUPPORTED",
      applicationRef: input.applicationRef,
      slipwayUrl: request.slipwayUrl,
      sessionFile: request.sessionFile
    }, `Error (SLIPWAY_APPLICATION_LOGS_PAGINATION_UNSUPPORTED): the Liskov service does not support log pagination yet. Retry without --follow/--from-start.`);
    return 1;
  }

  const printRecords = (records: LiskovApplicationLogLine[]): void => {
    for (const line of visibleLogs(records)) {
      emit(options, input.ndjson ? JSON.stringify(line) : formatApplicationLogLine(line));
    }
  };
  const sleep = options.sleepMs ?? defaultSleep;
  const followContinue = options.followContinue ?? (() => true);
  const quietOptions: SlipwayCliOptions = { ...options, stdout: () => {} };
  const pollPage = async (cursor: string): Promise<LiskovApplicationLogsResponse | undefined> => {
    const page = await requestPage({ order: "asc", cursor }, quietOptions);
    if (!page.ok || !page.response.ok || !isLiskovApplicationLogsResponse(page.body)) return undefined;
    return page.body;
  };
  let consecutiveFailures = 0;
  const streamFailureExhausted = (): boolean => {
    consecutiveFailures += 1;
    if (consecutiveFailures >= APPLICATION_LOGS_MAX_CONSECUTIVE_FAILURES) {
      writeLogsError({
        ok: false,
        error: "SLIPWAY_APPLICATION_LOGS_FAILED",
        applicationRef: input.applicationRef,
        consecutiveFailures
      }, `Error (SLIPWAY_APPLICATION_LOGS_FAILED): could not read Liskov Application logs after ${consecutiveFailures} consecutive attempts.`);
      return true;
    }
    emitError(options, `Warning: could not read Liskov Application logs (attempt ${consecutiveFailures} of ${APPLICATION_LOGS_MAX_CONSECUTIVE_FAILURES}); retrying.`);
    return false;
  };

  if (!input.ndjson) emit(options, APPLICATION_LOGS_HEADER);
  let cursor = body.latestCursor;
  if (input.fromStart === true) {
    printRecords(body.logs);
    let next = body.nextCursor ?? null;
    while (next !== null) {
      const page = await pollPage(next);
      if (page === undefined) {
        if (streamFailureExhausted()) return 1;
        await sleep(APPLICATION_LOGS_POLL_INTERVAL_MS);
        continue;
      }
      consecutiveFailures = 0;
      cursor = next;
      printRecords(page.logs);
      next = typeof page.nextCursor === "string" ? page.nextCursor : null;
    }
  } else {
    printRecords([...body.logs].reverse());
  }

  if (input.follow !== true) return 0;

  consecutiveFailures = 0;
  while (followContinue()) {
    await sleep(APPLICATION_LOGS_POLL_INTERVAL_MS);
    const page = await pollPage(cursor);
    if (page === undefined) {
      if (streamFailureExhausted()) return 1;
      continue;
    }
    consecutiveFailures = 0;
    printRecords(page.logs);
    if (typeof page.nextCursor === "string") cursor = page.nextCursor;
  }
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

/**
 * Adopt one exact, independently finalized Acurast deploy receipt without ever
 * invoking the submitter. Confirmation is deliberately a two-request protocol:
 * the server must prove the exact caller-supplied bindings first, and the CLI
 * echoes that proof fingerprint into an otherwise unchanged confirmation.
 */
export async function runSlipwayAdminDeploySubmitRecovery(
  input: SlipwayAdminDeploySubmitRecoveryInput,
  options: SlipwayCliOptions = {}
): Promise<number> {
  const reason = input.reason?.trim();
  const requiredBindings: Array<[name: string, value: string]> = [
    ["operation id", input.operationId],
    ["organization", input.expectOrganization],
    ["application", input.expectApplication],
    ["application UID", input.expectApplicationUid],
    ["deployment", input.expectDeployment],
    ["local job", input.expectLocalJob],
    ["execution", input.expectExecution],
    ["proposal", input.expectProposal],
    ["reserve", input.expectReserve],
    ["operation status", input.expectOperationStatus],
    ["local-job status", input.expectLocalJobStatus],
    ["reserve status", input.expectReserveStatus]
  ];
  const invalidBinding = requiredBindings.find(([, value]) => typeof value !== "string" || value.trim().length === 0);
  const hashPattern = /^0x[0-9a-f]{64}$/u;
  const blockNumberValid = Number.isSafeInteger(input.finalizedBlockNumber) && input.finalizedBlockNumber >= 0;
  const extrinsicIndexValid = Number.isSafeInteger(input.extrinsicIndex) && input.extrinsicIndex >= 0;
  if (!reason || invalidBinding || !blockNumberValid || !extrinsicIndexValid
      || !hashPattern.test(input.finalizedBlockHash) || !hashPattern.test(input.transactionHash)) {
    const error = "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_INPUT_INVALID";
    const invalid = [
      !reason ? "reason" : undefined,
      invalidBinding?.[0],
      !blockNumberValid ? "finalized block number" : undefined,
      !extrinsicIndexValid ? "extrinsic index" : undefined,
      !hashPattern.test(input.finalizedBlockHash) ? "finalized block hash" : undefined,
      !hashPattern.test(input.transactionHash) ? "transaction hash" : undefined
    ].filter((value): value is string => value !== undefined);
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      operationId: input.operationId,
      invalid
    }, `Error (${error}): invalid ${invalid.join(", ")}; provide every exact binding, non-negative safe integer positions, and lowercase 0x-prefixed 32-byte hashes.`);
    return 2;
  }

  const bindings = {
    expectOrganization: input.expectOrganization,
    expectApplication: input.expectApplication,
    expectApplicationUid: input.expectApplicationUid,
    expectDeployment: input.expectDeployment,
    expectLocalJob: input.expectLocalJob,
    expectExecution: input.expectExecution,
    expectProposal: input.expectProposal,
    expectReserve: input.expectReserve,
    expectOperationStatus: input.expectOperationStatus,
    expectLocalJobStatus: input.expectLocalJobStatus,
    expectReserveStatus: input.expectReserveStatus,
    finalizedBlockNumber: input.finalizedBlockNumber,
    finalizedBlockHash: input.finalizedBlockHash,
    extrinsicIndex: input.extrinsicIndex,
    transactionHash: input.transactionHash,
    reason
  } as const;
  const requestInput = {
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST" as const,
    path: `/api/admin/executor-operations/${encodeURIComponent(input.operationId)}/recover-deploy-submit`,
    authToken: resolveAdminToken({ token: input.adminToken, env: options.env ?? process.env }),
    requestErrorCode: "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not recover the finalized Liskov deploy submission",
    redactFetchError: true
  };

  const dryRun = await authenticatedSlipwayJsonRequest<SlipwayGenericResponse>({
    ...requestInput,
    body: { ...bindings, confirm: false }
  }, options);
  if (!dryRun.ok) return dryRun.exitCode;
  if (!dryRun.response.ok || dryRun.body?.ok !== true) {
    return writeDeploySubmitRecoveryFailure({
      body: dryRun.body,
      operationId: input.operationId,
      options,
      json: input.json,
      response: dryRun.response,
      slipwayUrl: dryRun.slipwayUrl,
      sessionFile: dryRun.sessionFile,
      phase: "dry_run"
    });
  }

  const proofFingerprint = typeof dryRun.body.proofFingerprint === "string"
    ? dryRun.body.proofFingerprint
    : "";
  if (dryRun.body.mode !== "dry_run"
      || dryRun.body.operationId !== input.operationId
      || !proofFingerprint.trim()) {
    const error = "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_DRY_RUN_RESPONSE_INVALID";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      operationId: input.operationId,
      phase: "dry_run",
      status: dryRun.response.status
    }, `Error (${error}): the dry run did not return the exact operation id, dry_run mode, and a nonempty proof fingerprint, so confirmation was not sent. Re-read the operation and investigate the server response.`);
    return 1;
  }

  if (input.yes !== true) {
    writeStructuredOrHuman(options, input.json, dryRun.body,
      `Dry run: finalized deploy evidence for executor operation ${input.operationId} is eligible. Pass --yes with the same exact bindings to recover it.`);
    return 0;
  }

  const confirmation = await authenticatedSlipwayJsonRequest<SlipwayGenericResponse>({
    ...requestInput,
    body: {
      ...bindings,
      confirm: true,
      confirmationFingerprint: proofFingerprint
    }
  }, options);
  if (!confirmation.ok) return confirmation.exitCode;
  if (!confirmation.response.ok || confirmation.body?.ok !== true) {
    return writeDeploySubmitRecoveryFailure({
      body: confirmation.body,
      operationId: input.operationId,
      options,
      json: input.json,
      response: confirmation.response,
      slipwayUrl: confirmation.slipwayUrl,
      sessionFile: confirmation.sessionFile,
      phase: "confirm"
    });
  }
  if (confirmation.body.mode !== "confirm"
      || confirmation.body.operationId !== input.operationId
      || confirmation.body.proofFingerprint !== proofFingerprint) {
    const error = "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_CONFIRM_RESPONSE_INVALID";
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      operationId: input.operationId,
      phase: "confirm",
      status: confirmation.response.status
    }, `Error (${error}): the confirmation response did not preserve the exact operation id, confirm mode, and dry-run proof fingerprint. Re-read the operation before taking any further action.`);
    return 1;
  }

  writeStructuredOrHuman(options, input.json, confirmation.body,
    confirmation.body.idempotentReplay === true
      ? `Executor operation ${input.operationId} already carried this exact finalized deploy receipt.`
      : `Recovered finalized deploy receipt for executor operation ${input.operationId}.`);
  return 0;
}

function writeDeploySubmitRecoveryFailure(input: {
  body: SlipwayGenericResponse | undefined;
  operationId: string;
  options: SlipwayCliOptions;
  json: boolean | undefined;
  response: Response;
  slipwayUrl: string;
  sessionFile: string;
  phase: "dry_run" | "confirm";
}): number {
  const blockers = Array.isArray(input.body?.blockers)
    ? input.body.blockers.filter((value): value is string => typeof value === "string")
    : [];
  const error = input.response.status === 401
    ? "SLIPWAY_SESSION_UNAUTHORIZED"
    : input.response.status === 403
      ? "SLIPWAY_PLATFORM_ADMIN_REQUIRED"
      : input.phase === "dry_run"
        ? "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_DRY_RUN_FAILED"
        : "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_CONFIRM_FAILED";
  writeStructuredOrHuman(input.options, input.json, {
    ok: false,
    error,
    status: input.response.status,
    reason: input.body?.reason ?? input.body?.error,
    blockers,
    operationId: input.operationId,
    phase: input.phase,
    slipwayUrl: input.slipwayUrl,
    sessionFile: input.sessionFile
  }, `Error (${error}): ${input.phase === "dry_run" ? "dry-run proof failed" : "confirmation failed"} for executor operation ${input.operationId}${blockers.length ? ` (${blockers.join(", ")})` : ""}. Re-read the operation and finalized chain evidence before retrying.`);
  return 1;
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
  const manifestPath = normalizeRepositoryPath(input.manifestPath);
  if (!manifestPath) {
    return runtimeImageWorkflowFailure(
      options,
      input,
      "SLIPWAY_RUNTIME_IMAGE_MANIFEST_PATH_INVALID",
      "--manifest must be a safe repo-relative path without empty, dot, parent, or backslash segments."
    );
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8")) as unknown;
  } catch (error) {
    return runtimeImageWorkflowFailure(
      options,
      input,
      "SLIPWAY_RUNTIME_IMAGE_MANIFEST_INVALID",
      `Unable to read V4 manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
      { manifestPath }
    );
  }
  const diagnostics = validateApplicationManifestV4(manifest);
  const errors = diagnostics.filter((diagnostic) =>
    diagnostic.code === "invalid_manifest" || diagnostic.code === "unknown_field");
  if (errors.length > 0) {
    return runtimeImageWorkflowFailure(
      options,
      input,
      "SLIPWAY_RUNTIME_IMAGE_MANIFEST_INVALID",
      `${manifestPath} is not a valid V4 application manifest.`,
      { manifestPath, errors }
    );
  }
  const manifestObject = objectRecord(manifest);
  if (manifestObject.applicationId !== input.applicationRef) {
    return runtimeImageWorkflowFailure(
      options,
      input,
      "SLIPWAY_RUNTIME_IMAGE_MANIFEST_APPLICATION_MISMATCH",
      `${manifestPath} declares applicationId ${String(manifestObject.applicationId)}, expected ${input.applicationRef}.`,
      { manifestPath }
    );
  }
  const release = objectRecord(manifestObject.release);
  const artifact = objectRecord(release.artifact);
  const builder = objectRecord(release.builder);
  if (release.mode !== "build" || artifact.kind !== "runtime_image") {
    return runtimeImageWorkflowFailure(
      options,
      input,
      "SLIPWAY_RUNTIME_IMAGE_MANIFEST_RELEASE_INVALID",
      `${manifestPath} must contain a build release with artifact.kind runtime_image.`,
      { manifestPath }
    );
  }
  if (builder.manifestPath !== manifestPath) {
    return runtimeImageWorkflowFailure(
      options,
      input,
      "SLIPWAY_RUNTIME_IMAGE_MANIFEST_PATH_MISMATCH",
      `${manifestPath} declares release.builder.manifestPath ${String(builder.manifestPath)}.`,
      { manifestPath, authoredManifestPath: builder.manifestPath }
    );
  }

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
    manifestPath,
    liskovUrl: normalizeBaseUrl(input.liskovUrl ?? DEFAULT_SLIPWAY_URL),
    oidcAudience: input.oidcAudience ?? DEFAULT_RUNTIME_IMAGE_OIDC_AUDIENCE,
    workflowName: input.workflowName ?? DEFAULT_RUNTIME_IMAGE_WORKFLOW_NAME,
    actionsRef: DEFAULT_RUNTIME_IMAGE_ACTIONS_REF
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, workflow, { encoding: "utf8", mode: 0o644 });

  const value = {
    ok: true,
    applicationRef: input.applicationRef,
    output,
    workflowPath,
    workflowName: input.workflowName ?? DEFAULT_RUNTIME_IMAGE_WORKFLOW_NAME,
    manifestPath,
    actionsRef: DEFAULT_RUNTIME_IMAGE_ACTIONS_REF,
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
    `Wrote manifest-bound Liskov runtime-image workflow to ${output}. The authored builder.workflowRef must authorize caller ${value.policyWorkflowRefHint}.`
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
        source: { kind: "upload", filename: path.basename(filePath) }
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
      body = { source };
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
      body = { document, source };
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
    `Imported ${String(responseBody.count ?? responseBody.applicationCount ?? 0)} application manifest(s).
authoredDigest: ${String(responseBody.authoredDigest ?? "unavailable")}
releaseIntentDigest: ${String(responseBody.releaseIntentDigest ?? "unavailable")}`
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
  const previewQuery = input.previewPaused === true ? "?previewPaused=true" : "";
  const request = await authenticatedSlipwayRequest<SlipwayLiveCustodyCommandResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/preflight${previewQuery}`,
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
      if (stringValue(objectRecord(body).mode) === "paused_preview") {
        const preview = objectRecord(objectRecord(body).pausedPreview);
        const itemCount = numberValue(preview.itemCount) ?? arrayValue(preview.items).length;
        const eligibility = readLaunchEligibility(preview.launchEligibility);
        const status = eligibility.eligible ? stringValue(preview.status) ?? "unknown" : "unavailable";
        const readyCount = eligibility.eligible ? numberValue(preview.readyCount) ?? 0 : 0;
        return `Paused read-only preflight for ${input.applicationRef}: ${status}; ${readyCount}/${itemCount} deploy item(s) ready. Launch eligibility: ${formatLaunchEligibility(eligibility)}. Submission is disabled.`;
      }
      const actionPlan = objectRecord(objectRecord(body).actionPlan);
      const items = arrayValue(actionPlan.items).map(objectRecord);
      const count = numberValue(actionPlan.count) ?? items.length;
      const deployItemCount = items.filter((item) => item.kind === "acurast.deploy").length;
      const eligibility = readLaunchEligibility(objectRecord(body).launchEligibility);
      const selectionInstruction = eligibility.eligible && deployItemCount > 0
        ? " Run preflight with --json, then copy both planItemId and the opaque idempotencyKey from the same custodial.live actionPlan item."
        : "";
      const launchSummary = ` Launch eligibility: ${formatLaunchEligibility(eligibility)}.`;
      const reclaim = objectRecord(objectRecord(body).reclaim);
      const candidateCount = numberValue(reclaim.candidateCount);
      if (candidateCount === undefined) return `${count} live custody plan item(s) for ${input.applicationRef}.${launchSummary}${selectionInstruction}`;
      const reclaimableCount = numberValue(reclaim.reclaimableCount) ?? 0;
      const blockedCount = numberValue(reclaim.blockedCount) ?? 0;
      const failedCount = numberValue(reclaim.failedCount) ?? 0;
      const alreadyReclaimedCount = numberValue(reclaim.alreadyReclaimedCount) ?? 0;
      const alreadyDeregisteredCount = numberValue(reclaim.alreadyDeregisteredCount) ?? 0;
      const skippedByLimitCount = numberValue(reclaim.skippedByLimitCount) ?? 0;
      return `${count} live custody plan item(s) for ${input.applicationRef}.${launchSummary} Reclaim: ${candidateCount} candidate(s), ${reclaimableCount} reclaimable, ${blockedCount} blocked, ${failedCount} failed, ${alreadyReclaimedCount} already reclaimed, ${alreadyDeregisteredCount} already deregistered, ${skippedByLimitCount} skipped by limit.${selectionInstruction}`;
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
  const query = new URLSearchParams();
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.offset !== undefined) query.set("offset", String(input.offset));
  for (const status of input.statuses ?? []) query.append("status", status);
  for (const reason of input.reasons ?? []) query.append("reason", reason);
  const queryString = query.toString();
  const request = await authenticatedSlipwayRequest<LiskovExecutionHistoryResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions${queryString ? `?${queryString}` : ""}`,
    requestErrorCode: "SLIPWAY_CUSTODY_EXECUTION_LIST_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not list Liskov live custody executions"
  }, options);
  if (!request.ok) return request.exitCode;
  if (!request.response.ok || request.body?.ok === false) {
    return writeCommandResponse({
      body: request.body,
      response: request.response,
      errorCode: "SLIPWAY_CUSTODY_EXECUTION_LIST_FAILED",
      json: input.json,
      human: () => "Liskov live custody execution history read failed.",
      options
    });
  }
  if (!isExecutionHistoryResponse(request.body)) {
    return writeMalformedReadResponse(
      "SLIPWAY_CUSTODY_EXECUTION_LIST_FAILED",
      request.response,
      input.json,
      options
    );
  }
  return writeCommandResponse({
    body: request.body,
    response: request.response,
    errorCode: "SLIPWAY_CUSTODY_EXECUTION_LIST_FAILED",
    json: input.json,
    human: () => formatExecutionHistory(input.applicationRef, request.body!),
    options
  });
}

export async function runSlipwayCustodyExecutionSubmit(input: SlipwayCustodyExecutionSubmitInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_EXECUTION_SUBMIT_CONFIRMATION_REQUIRED", "custody execution submit");
  if (!input.yesSpend) return writeConfirmationRequired(options, input.json, "SLIPWAY_CUSTODY_EXECUTION_SUBMIT_SPEND_CONFIRMATION_REQUIRED", "custody execution submit spend", "--yes-spend");
  const preflight = await verifyFreshExecutionSubmitPlanItem(input, options);
  if (!preflight.ok) return preflight.exitCode;
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
    const recoveryCommand = `proof liskov custody execution run-one ${input.applicationRef} --execution-id ${preflight.expectedExecutionId} --expect-kind ${input.expectKind} --expect-policy-digest ${input.expectPolicyDigest} --yes --json`;
    emitError(
      options,
      `Run-one provisional recovery handle: ${preflight.expectedExecutionId}. If the submit response is interrupted, observe it without resubmitting: ${recoveryCommand}`
    );
    return runSlipwayJsonCommand({
      config: input.config,
      slipwayUrl: input.slipwayUrl,
      json: input.json,
      method: "POST",
      path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/executions/run-one`,
      body,
      errorCode: "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_FAILED",
      fetchFailedMessage: "could not run one Liskov live custody execution",
      requestFailureDetails: {
        recoveryExecutionId: preflight.expectedExecutionId,
        recoveryCommand
      },
      human: runOneHuman(input)
    }, options);
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
    human: runOneHuman(input)
  }, options);
}

function runOneHuman(input: SlipwayCustodyExecutionRunOneInput): (responseBody: unknown) => string {
  return (responseBody) => {
    const bodyRecord = objectRecord(responseBody);
    const attempt = objectRecord(bodyRecord.attempt);
    const receipt = objectRecord(attempt.receipt);
    const executionId = stringValue(attempt.executionId) ?? input.executionId ?? input.planItemId ?? "unknown";
    const status = stringValue(attempt.status) ?? "updated";
    const deploymentId = stringValue(receipt.deploymentId);
    const outcome = stringValue(bodyRecord.waiting) ?? (bodyRecord.recovered === true ? "recovered" : stringValue(bodyRecord.mode) ?? (bodyRecord.replayed === true ? "replayed" : "run"));
    const deployment = deploymentId ? ` deployment ${deploymentId}` : "";
    return `Run-one ${executionId}: ${status}${deployment} (${outcome}).`;
  };
}

type FreshRunOnePlanSelection =
  | { ok: true; planItemId: string; idempotencyKey: string; expectedExecutionId: string }
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
  let headers: Record<string, string>;
  try {
    headers = organizationRequestHeaders(saved.sessionToken, options.organization);
  } catch (error) {
    return { ok: false, exitCode: writeOrganizationSelectorError(options, input.json, error) };
  }
  let response: Response;
  let preflight: SlipwayLiveCustodyCommandResponse | undefined;
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL(`/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/preflight`, slipwayUrl),
      {
        method: "GET",
        headers
      }
    );
    preflight = await readJsonResponse<SlipwayLiveCustodyCommandResponse>(response);
  } catch {
    return fail("preflight_read_failed");
  }
  if (!response.ok || preflight?.ok !== true) {
    return fail(stringValue(preflight?.reason) ?? stringValue(preflight?.error) ?? "preflight_request_failed", response.status);
  }

  if (input.expectKind === "acurast.deploy") {
    const eligibility = readLaunchEligibility(preflight.launchEligibility);
    if (!eligibility.known || !eligibility.eligible) {
      return reject("launch_not_eligible", launchEligibilityRejectionDetails("launchEligibility", eligibility));
    }
  }

  const lifecyclePolicy = objectRecord(preflight.lifecyclePolicy);
  if (input.requireEnvironmentBootstrap) {
    const explicitServerEnvironmentReady = lifecyclePolicy.serverEnvironmentRequired === true
      && lifecyclePolicy.setEnvironmentEnabled === true
      && lifecyclePolicy.environmentReady === true;
    const ownedBootstrapReady = lifecyclePolicy.bootstrapDelivery === "acurast-set-environment"
      && lifecyclePolicy.setEnvironmentEnabled === true
      && lifecyclePolicy.serverEnvironmentHandoffEnabled === true
      && lifecyclePolicy.serverEnvironmentHandoffApplicationAllowed === true
      && lifecyclePolicy.environmentReady === true;
    const ready = lifecyclePolicy.activePolicyFound === true
      && (explicitServerEnvironmentReady || ownedBootstrapReady);
    if (!ready) {
      return reject("environment_bootstrap_not_ready", {
        field: "lifecyclePolicy",
        activePolicyFound: lifecyclePolicy.activePolicyFound ?? null,
        serverEnvironmentRequired: lifecyclePolicy.serverEnvironmentRequired ?? null,
        bootstrapDelivery: lifecyclePolicy.bootstrapDelivery ?? null,
        setEnvironmentEnabled: lifecyclePolicy.setEnvironmentEnabled ?? null,
        serverEnvironmentHandoffEnabled: lifecyclePolicy.serverEnvironmentHandoffEnabled ?? null,
        serverEnvironmentHandoffApplicationAllowed:
          lifecyclePolicy.serverEnvironmentHandoffApplicationAllowed ?? null,
        environmentReady: lifecyclePolicy.environmentReady ?? null
      });
    }
  }
  if (input.requireOneGeneration
    && (lifecyclePolicy.oneGenerationFenced !== true || lifecyclePolicy.maxGenerations !== 1)) {
    return reject("one_generation_fence_not_ready", {
      field: "lifecyclePolicy",
      maxGenerations: lifecyclePolicy.maxGenerations ?? null,
      oneGenerationFenced: lifecyclePolicy.oneGenerationFenced ?? null
    });
  }
  if (input.requireZeroRetries
    && (lifecyclePolicy.zeroRecoveryRetriesFenced !== true
      || lifecyclePolicy.maxAutoRetries !== 0
      || lifecyclePolicy.maxRuntimeReplaces !== 0)) {
    return reject("zero_recovery_retries_not_ready", {
      field: "lifecyclePolicy",
      maxAutoRetries: lifecyclePolicy.maxAutoRetries ?? null,
      maxRuntimeReplaces: lifecyclePolicy.maxRuntimeReplaces ?? null,
      zeroRecoveryRetriesFenced: lifecyclePolicy.zeroRecoveryRetriesFenced ?? null
    });
  }
  if (input.minimumEnvironmentRunwayMs !== undefined) {
    const actual = numberValue(lifecyclePolicy.environmentBootstrapRunwayMs);
    if (actual === undefined || actual < input.minimumEnvironmentRunwayMs) {
      return reject("environment_bootstrap_runway_too_short", {
        field: "lifecyclePolicy.environmentBootstrapRunwayMs",
        minimumEnvironmentRunwayMs: input.minimumEnvironmentRunwayMs,
        environmentBootstrapRunwayMs: actual ?? null
      });
    }
  }
  if (input.minimumRuntimeDurationMs !== undefined) {
    const actual = numberValue(lifecyclePolicy.runtimeDurationMs);
    if (actual === undefined || actual < input.minimumRuntimeDurationMs) {
      return reject("runtime_duration_too_short", {
        field: "lifecyclePolicy.runtimeDurationMs",
        minimumRuntimeDurationMs: input.minimumRuntimeDurationMs,
        runtimeDurationMs: actual ?? null
      });
    }
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
  if (selected.kind === "acurast.deploy") {
    const eligibility = readLaunchEligibility(selected.launchEligibility);
    if (!eligibility.known || !eligibility.eligible) {
      return reject("launch_plan_item_not_eligible", launchEligibilityRejectionDetails("actionPlan.items.launchEligibility", eligibility));
    }
  }
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
    idempotencyKey: selected.idempotencyKey as string,
    expectedExecutionId: liveCustodyExecutionId(selected.idempotencyKey as string)
  };
}

type FreshSubmitPlanVerification = { ok: true } | { ok: false; exitCode: number };

async function verifyFreshExecutionSubmitPlanItem(
  input: SlipwayCustodyExecutionSubmitInput,
  options: SlipwayCliOptions
): Promise<FreshSubmitPlanVerification> {
  const reject = (reason: string, details: Record<string, unknown> = {}): FreshSubmitPlanVerification => {
    const message = `Fresh preflight rejected execution submit; re-read \`proof liskov custody preflight ${input.applicationRef} --json\` and copy one exact planItemId/idempotencyKey pair.`;
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: "SLIPWAY_CUSTODY_EXECUTION_SUBMIT_PREFLIGHT_REJECTED",
      reason,
      message,
      ...details
    }, `Error (SLIPWAY_CUSTODY_EXECUTION_SUBMIT_PREFLIGHT_REJECTED): ${message} (${reason})`);
    return { ok: false, exitCode: 1 };
  };
  const request = await authenticatedSlipwayRequest<SlipwayLiveCustodyCommandResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: `/api/applications/${encodeURIComponent(input.applicationRef)}/live-custody/preflight`,
    requestErrorCode: "SLIPWAY_CUSTODY_EXECUTION_SUBMIT_PREFLIGHT_FAILED",
    notFoundMessage: "No Liskov CLI session is stored locally.",
    fetchFailedMessage: "could not read a fresh Liskov live custody preflight"
  }, options);
  if (!request.ok) return request;
  if (!request.response.ok || request.body?.ok !== true) {
    return reject(stringValue(request.body?.reason) ?? stringValue(request.body?.error) ?? "preflight_request_failed", {
      status: request.response.status
    });
  }
  const actionPlan = objectRecord(request.body.actionPlan);
  const items = arrayValue(actionPlan.items).map(objectRecord);
  const exact = items.filter((item) => item.executorMode === "custodial.live"
    && item.planItemId === input.planItemId
    && item.idempotencyKey === input.idempotencyKey);
  if (exact.length !== 1) {
    return reject(exact.length === 0 ? "plan_item_not_found" : "ambiguous_plan_item", { matches: exact.length });
  }
  const selected = exact[0];
  if (!Array.isArray(selected.blockers)) {
    return reject("invalid_live_custody_plan_item", { field: "actionPlan.items.blockers" });
  }
  if (selected.blockers.length > 0) {
    return reject("live_custody_plan_blocked", { blockerCount: selected.blockers.length });
  }
  if (selected.kind === "acurast.deploy") {
    const topLevel = readLaunchEligibility(request.body.launchEligibility);
    if (!topLevel.known || !topLevel.eligible) {
      return reject("launch_not_eligible", launchEligibilityRejectionDetails("launchEligibility", topLevel));
    }
    const itemEligibility = readLaunchEligibility(selected.launchEligibility);
    if (!itemEligibility.known || !itemEligibility.eligible) {
      return reject("launch_plan_item_not_eligible", launchEligibilityRejectionDetails("actionPlan.items.launchEligibility", itemEligibility));
    }
  }
  return { ok: true };
}

function launchEligibilityRejectionDetails(field: string, eligibility: LaunchEligibilityRead): Record<string, unknown> {
  if (!eligibility.known) {
    return {
      field,
      launchEligibilityState: "unavailable",
      launchEligibilityReason: eligibility.reason,
      launchEligibilityCode: eligibility.rawCode ?? null
    };
  }
  return {
    field,
    launchEligibilityState: "ineligible",
    launchEligibilityCode: eligibility.value.code,
    evidenceAuthority: eligibility.value.evidenceAuthority,
    userActionable: eligibility.value.userActionable,
    nextAction: eligibility.value.nextAction ?? null,
    blockerCodes: eligibility.value.blockerCodes
  };
}

function liveCustodyExecutionId(idempotencyKey: string): string {
  return `live-execution:${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
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

function normalizeRepositoryPath(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || path.isAbsolute(candidate) || candidate.includes("\\")) return undefined;
  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }
  return segments.join("/");
}

function runtimeImageWorkflowFailure(
  options: SlipwayCliOptions,
  input: SlipwayApplicationRuntimeImageWorkflowInput,
  error: string,
  message: string,
  details: Record<string, unknown> = {}
): number {
  writeStructuredOrHuman(options, input.json, {
    ok: false,
    error,
    message,
    applicationRef: input.applicationRef,
    ...details
  }, `Error (${error}): ${message}`);
  return 1;
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
  manifestPath: string;
  liskovUrl: string;
  oidcAudience: string;
  workflowName: string;
  actionsRef: string;
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
    `    uses: ${input.actionsRef}`,
    "    with:",
    `      application-id: ${yamlSingleQuoted(input.applicationRef)}`,
    `      manifest-path: ${yamlSingleQuoted(input.manifestPath)}`,
    "      image-url: ${{ inputs.image_url }}",
    "      expected-sha256: ${{ inputs.expected_sha256 }}",
    `      liskov-url: ${yamlSingleQuoted(input.liskovUrl)}`,
    `      audience: ${yamlSingleQuoted(input.oidcAudience)}`
  ].join("\n");
}

async function authenticatedSlipwayRequest<T>(
  input: {
    config?: string;
    slipwayUrl?: string;
    json?: boolean;
    path: string;
    authToken?: string;
    organizationSelector?: string | null;
    requestErrorCode: string;
    notFoundMessage: string;
    fetchFailedMessage: string;
    redactFetchError?: boolean;
    optional?: boolean;
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
  let requestOrganization: string | undefined;
  try {
    requestOrganization = organizationSelector(
      input.authToken === undefined
        ? input.organizationSelector === undefined ? options.organization : input.organizationSelector ?? undefined
        : undefined
    );
  } catch (error) {
    return { ok: false, exitCode: writeOrganizationSelectorError(options, input.json, error) };
  }
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
  let headers: Record<string, string>;
  try {
    headers = organizationRequestHeaders(
      input.authToken ?? saved.sessionToken,
      requestOrganization
    );
  } catch (error) {
    return { ok: false, exitCode: writeOrganizationSelectorError(options, input.json, error) };
  }
  let response: Response;
  try {
    response = await fetchImpl(new URL(input.path, slipwayUrl), {
      method: "GET",
      headers
    });
  } catch (error) {
    if (input.optional) {
      return {
        ok: true,
        body: undefined,
        response: new Response(null, { status: 599 }),
        slipwayUrl,
        sessionFile
      };
    }
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: input.requestErrorCode,
      message: input.redactFetchError ? "Request failed." : errorMessage(error),
      slipwayUrl,
      sessionFile
    }, `Error (${input.requestErrorCode}): ${input.fetchFailedMessage} at ${slipwayUrl}.`);
    return { ok: false, exitCode: 1 };
  }

  const body = await readJsonResponse<T>(response);
  if (!input.optional && !response.ok && writeOrganizationServerFailure(options, input.json, body)) {
    return { ok: false, exitCode: 1 };
  }
  return {
    ok: true,
    body,
    response,
    slipwayUrl,
    sessionFile
  };
}

function applicationLogsInputError(input: SlipwayApplicationLogsInput): string | undefined {
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500)) {
    return "--limit must be an integer from 1 through 500.";
  }
  if (input.deploymentId !== undefined && input.deploymentId.trim() === "") return "--deployment must not be empty.";
  if (input.jobId !== undefined && input.jobId.trim() === "") return "--job must not be empty.";
  if (input.origin !== undefined && !["all", "customer", "runtime-ssh", "runtime_ssh"].includes(input.origin)) {
    return "--origin must be all, customer, runtime-ssh, or runtime_ssh.";
  }
  if (input.event !== undefined && input.event.trim() === "") return "--event must not be empty.";
  if (input.json) {
    if (input.follow) return "--json cannot be combined with --follow.";
    if (input.fromStart) return "--json cannot be combined with --from-start.";
    if (input.ndjson) return "--json cannot be combined with --ndjson.";
    if (input.event !== undefined) return "--json cannot be combined with --event.";
  }
  return undefined;
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
    organizationSelector?: string | null;
    requestErrorCode: string;
    notFoundMessage: string;
    fetchFailedMessage: string;
    requestFailureDetails?: Record<string, unknown>;
    redactFetchError?: boolean;
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
  let requestOrganization: string | undefined;
  try {
    requestOrganization = organizationSelector(
      input.authToken === undefined
        ? input.organizationSelector === undefined ? options.organization : input.organizationSelector ?? undefined
        : undefined
    );
  } catch (error) {
    return { ok: false, exitCode: writeOrganizationSelectorError(options, input.json, error) };
  }
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
  let headers: Record<string, string>;
  try {
    headers = {
      ...organizationRequestHeaders(
        input.authToken ?? saved.sessionToken,
        requestOrganization
      ),
      "content-type": "application/json"
    };
  } catch (error) {
    return { ok: false, exitCode: writeOrganizationSelectorError(options, input.json, error) };
  }
  let response: Response;
  try {
    response = await fetchImpl(new URL(input.path, slipwayUrl), {
      method: input.method,
      headers,
      body: JSON.stringify(input.body)
    });
  } catch (error) {
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error: input.requestErrorCode,
      message: input.redactFetchError ? "request_failed" : errorMessage(error),
      slipwayUrl,
      sessionFile,
      ...input.requestFailureDetails
    }, `Error (${input.requestErrorCode}): ${input.fetchFailedMessage} at ${slipwayUrl}.`);
    return { ok: false, exitCode: 1 };
  }

  const responseBody = await readJsonResponse<T>(response);
  if (!response.ok && writeOrganizationServerFailure(options, input.json, responseBody)) {
    return { ok: false, exitCode: 1 };
  }
  return {
    ok: true,
    body: responseBody,
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
    requestFailureDetails?: Record<string, unknown>;
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
    fetchFailedMessage: input.fetchFailedMessage,
    requestFailureDetails: input.requestFailureDetails
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
  body: { ok?: boolean; error?: string; reason?: string; [key: string]: unknown } | undefined;
  response: Response;
  errorCode: string;
  json?: boolean;
  human: (body: unknown) => string;
  options: SlipwayCliOptions;
}): number {
  if (!input.response.ok || input.body?.ok === false) {
    const error = input.response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : input.body?.error === "invalid_organization_selector" || input.body?.error === "not_a_member"
        ? input.body.error
        : input.errorCode;
    writeStructuredOrHuman(input.options, input.json, {
      ok: false,
      error,
      status: input.response.status,
      reason: input.body?.reason ?? input.body?.error
    }, `Error (${error}): ${input.body?.reason ?? input.body?.error ?? "Liskov request failed."}`);
    return 1;
  }
  writeStructuredOrHuman(input.options, input.json, input.body, input.human(input.body));
  return 0;
}

function writeOrganizationSelectorError(
  options: SlipwayCliOptions,
  json: boolean | undefined,
  error: unknown
): number {
  if (!(error instanceof OrganizationSelectorError)) throw error;
  writeStructuredOrHuman(
    options,
    json,
    { ok: false, error: error.code, message: error.message },
    `Error (${error.code}): ${error.message}`
  );
  return 1;
}

function writeOrganizationServerFailure(
  options: SlipwayCliOptions,
  json: boolean | undefined,
  body: unknown
): boolean {
  const response = objectRecord(body);
  const error = stringValue(response.error);
  if (error !== "invalid_organization_selector" && error !== "not_a_member") return false;
  writeStructuredOrHuman(
    options,
    json,
    body,
    `Error (${error}): ${stringValue(response.reason) ?? (error === "not_a_member"
      ? "The session does not have an active membership matching that exact organization selector."
      : "The organization selector is invalid.")}`
  );
  return true;
}

function writeMalformedReadResponse(
  error: string,
  response: Response,
  json: boolean | undefined,
  options: SlipwayCliOptions
): number {
  writeStructuredOrHuman(options, json, {
    ok: false,
    error,
    status: response.status,
    reason: "malformed_response"
  }, `Error (${error}): Liskov returned a malformed response.`);
  return 1;
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

function emitLoginTimings(options: SlipwayCliOptions, input: { json?: boolean; timings: SlipwayLoginTimings }): void {
  const line = formatLoginTimings(input.timings);
  // In --json mode stdout must stay exactly one JSON object; the summary goes to stderr.
  if (input.json) emitError(options, line);
  else emit(options, line);
}

function formatLoginTimings(timings: SlipwayLoginTimings): string {
  const polls = `${timings.pollCount} ${timings.pollCount === 1 ? "poll" : "polls"}`;
  return [
    `Timings: pending ${formatDurationMs(timings.pendingMs)}`,
    `browser ${formatDurationMs(timings.browserOpenMs)}`,
    `wait ${formatDurationMs(timings.waitForAuthorizationMs)} (${polls}, p50 ${formatDurationMs(timings.pollRoundTripMs.p50)}, max ${formatDurationMs(timings.pollRoundTripMs.max)})`,
    `total ${formatDurationMs(timings.totalMs)}`
  ].join(" \u00b7 ");
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

function applicationDeletionPreviewPath(applicationRef: string, owner: string | undefined): string {
  const pathValue = `/api/applications/${encodeURIComponent(applicationRef)}/deletion-preview`;
  if (!owner || !owner.trim()) return pathValue;
  const query = new URLSearchParams({ owner: owner.trim() });
  return `${pathValue}?${query.toString()}`;
}

function applicationRetirementPath(applicationRef: string): string {
  return `/api/applications/${encodeURIComponent(applicationRef)}/retirement`;
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

/** Nearest-rank percentile of an ascending-sorted sample; `0` for an empty sample. */
function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const fraction = Math.min(100, Math.max(0, p)) / 100;
  const rank = Math.ceil(fraction * sortedAscending.length);
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
  return sortedAscending[index];
}

/** `120 ms` below one second, otherwise one decimal in seconds (`4.2 s`). */
function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return "n/a";
  if (Math.abs(ms) < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

function attachPolicyExplanation(
  body: SlipwayApplicationStatusResponse,
  explanationRequest:
    | {
        ok: true;
        body: unknown;
        response: Response;
        slipwayUrl: string;
        sessionFile: string;
      }
    | { ok: false; exitCode: number }
): { body: SlipwayApplicationStatusResponse; human: string } {
  if (!explanationRequest.ok) {
    return { body, human: "" };
  }
  const parsed = parsePolicyExplanation(explanationRequest.body);
  if (!parsed.ok) {
    return {
      body: {
        ...body,
        explanationError: {
          error: parsed.error,
          message: parsed.message
        }
      },
      human: `policy explanation: ${parsed.error}: ${parsed.message}`
    };
  }
  return {
    body: {
      ...body,
      explanation: parsed.explanation,
      nextActions: parsed.nextActions
    },
    human: formatStatusExplanation(parsed.nextActions)
  };
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
      application.organizationId ? `org ${application.organizationId}` : undefined,
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
  const impact = body.impact ?? {};
  const header = body.dryRun === true
    ? `Dry run: ${target} would be tombstoned.`
    : body.deleted === true && body.changed === false
      ? `${target} is already tombstoned.`
      : body.deleted === true
        ? `Deleted ${target}.`
        : `${target} was not tombstoned.`;
  const lines = [header];
  lines.push(
    `Impact: ${impact.activeDeploymentCount ?? 0} active/current deployment(s), ${impact.liveJobCount ?? 0} live job(s), ${impact.pendingOperationCount ?? 0} pending/running executor operation(s).`,
    "Legacy DELETE is a deprecated clean-only bridge. It never starts a long-running retirement or bypasses a nonzero or ambiguous gate."
  );
  if (body.dryRun === true && impact.hasLiveOrPendingResources === true) {
    lines.push("This application cannot be deleted through the legacy bridge. Use `proof liskov application retire APP_REF` to inspect or start safe retirement.");
  } else if (body.dryRun === true) {
    lines.push("The current gate is clean. Confirm with --reason TEXT --yes, or use the retirement command.");
  }
  return lines.join("\n");
}

function writeRetirementInputError(
  options: SlipwayCliOptions,
  json: boolean | undefined,
  error: string,
  message: string
): number {
  writeStructuredOrHuman(
    options,
    json,
    { ok: false, error, message },
    `Error (${error}): ${message}`
  );
  return 1;
}

function writeRetirementResponse(
  body: SlipwayApplicationRetirementResponse | undefined,
  response: Response,
  json: boolean | undefined,
  options: SlipwayCliOptions,
  fallbackError: string
): number {
  if (!body) return writeMalformedReadResponse(fallbackError, response, json, options);
  if (json) {
    writeStructuredOrHuman(options, true, body, "");
    return response.ok && body.ok !== false ? 0 : 1;
  }
  if (!response.ok || body.ok === false) {
    const error = response.status === 401
      ? "SLIPWAY_SESSION_UNAUTHORIZED"
      : typeof body.error === "string"
        ? body.error
        : fallbackError;
    const receipt = objectRecord(body.receipt);
    const completion = Object.keys(receipt).length > 0
      ? ` ${formatRetirementReceipt(receipt)}`
      : "";
    emit(options, `Error (${error}): ${body.reason ?? "Liskov retirement request failed."}${completion}`);
    return 1;
  }
  emit(options, formatApplicationRetirement(body));
  return 0;
}

function formatApplicationRetirement(body: SlipwayApplicationRetirementResponse): string {
  const receipt = objectRecord(body.receipt);
  if (Object.keys(receipt).length > 0) {
    const lines = [formatRetirementReceipt(receipt)];
    const legacyCleanup = objectRecord(body.legacyCleanup);
    if (Object.keys(legacyCleanup).length > 0) {
      lines.push(
        booleanValue(legacyCleanup.resourcesTerminalized) === true
          ? "Legacy post-deletion resources are terminalized."
          : `Legacy post-deletion cleanup remains open. ${formatRetirementAssessment(objectRecord(legacyCleanup.assessment))}`
      );
    }
    return lines.join("\n");
  }

  const retirement = objectRecord(body.retirement);
  if (Object.keys(retirement).length > 0) {
    const status = typeof retirement.status === "string" ? retirement.status : "unknown";
    const retirementId = typeof retirement.retirementId === "string"
      ? retirement.retirementId
      : "unknown";
    const phase = typeof retirement.phase === "string"
      ? retirement.phase
      : "unknown";
    const header = status === "active"
      ? `Retirement ${retirementId} is active (${phase}).`
      : `Retirement ${retirementId} is ${status}.`;
    return [header, formatRetirementAssessment(objectRecord(retirement.assessment))]
      .filter(Boolean)
      .join("\n");
  }

  const preview = objectRecord(body.preview);
  if (Object.keys(preview).length > 0) {
    const creationAvailability = objectRecord(body.creationAvailability);
    const capabilities = objectRecord(body.capabilities);
    const action = booleanValue(creationAvailability.available) !== true
      ? `Retirement creation unavailable: ${formatRetirementCreationUnavailableReason(creationAvailability.reason)}`
      : booleanValue(capabilities.create) !== true
        ? "Retirement state is readable, but this session lacks application.delete permission."
        : "Use --yes to pause the application and start a durable retirement intent.";
    return [
      "Retirement preview (read only).",
      formatRetirementAssessment(objectRecord(preview.assessment)),
      action
    ].join("\n");
  }
  return "Liskov returned application retirement state.";
}

function formatRetirementCreationUnavailableReason(reason: unknown): string {
  switch (reason) {
    case "rollout_disabled":
      return "the rollout is disabled; existing state and receipts remain readable.";
    case "canary_uid_not_allowed":
      return "this application UID is not in the exact canary allowlist.";
    case "kill_switch_enabled":
      return "the operator kill switch is enabled; coordinator work is also paused.";
    default:
      return "the server is not accepting new retirement intents.";
  }
}

function formatRetirementReceipt(receipt: Record<string, unknown>): string {
  const kind = typeof receipt.receiptKind === "string" ? receipt.receiptKind : "unknown";
  const digest = typeof receipt.digest === "string" ? receipt.digest : "unavailable";
  const label = kind === "legacy_immediate_tombstone"
    ? "Legacy immediate tombstone receipt"
    : "Safe application retirement receipt";
  return `${label}: ${digest}.`;
}

function formatRetirementAssessment(assessment: Record<string, unknown>): string {
  if (Object.keys(assessment).length === 0) return "";
  const execution = numberValue(assessment.executionBlockerCount) ?? 0;
  const financial = numberValue(assessment.financialBlockerCount) ?? 0;
  const ambiguity = numberValue(assessment.ambiguityBlockerCount) ?? 0;
  const phase = typeof assessment.phase === "string" ? assessment.phase : "unknown";
  const lines = [
    `Phase ${phase}: ${execution} execution, ${financial} financial, ${ambiguity} ambiguity blocker(s).`
  ];
  const scheduleEnd = numberValue(assessment.latestKnownScheduleEndAtMs);
  if (scheduleEnd !== undefined) {
    lines.push(`Latest known schedule end: ${new Date(scheduleEnd).toISOString()} (estimate, not a completion promise).`);
  }
  for (const value of arrayValue(assessment.blockers)) {
    const blocker = objectRecord(value);
    const category = typeof blocker.category === "string" ? blocker.category : "unknown";
    const code = typeof blocker.code === "string" ? blocker.code : "unknown";
    const resourceKind = typeof blocker.resourceKind === "string" ? blocker.resourceKind : "resource";
    const resourceId = typeof blocker.resourceId === "string" ? blocker.resourceId : "unknown";
    const authority = typeof blocker.evidenceAuthority === "string"
      ? blocker.evidenceAuthority
      : "unknown authority";
    const remediation = typeof blocker.remediationClass === "string"
      ? blocker.remediationClass
      : "review";
    lines.push(`- ${category}/${code}: ${resourceKind} ${resourceId}; evidence ${authority}; remediation ${remediation}.`);
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

function formatApplicationCreate(body: SlipwayApplicationCreateResponse): string {
  const application = body.application ?? {};
  const applicationId = stringValue((application as Record<string, unknown>).applicationId) ?? "(unknown)";
  const applicationUid = stringValue((application as Record<string, unknown>).applicationUid) ?? "(unknown)";
  const applicationName = stringValue((application as Record<string, unknown>).applicationName) ?? "(unknown)";
  return [
    `Created Liskov Application ${applicationId} (uid ${applicationUid}, name ${applicationName}) from identity alone.`,
    "No policy exists yet: bind release authority with `application set-repository`/source binding,",
    "then publish a policy version (V5: POST /api/applications/{id}/policy-versions)."
  ].join("\n");
}

function formatApplicationRename(applicationRef: string, body: SlipwayApplicationRenameResponse): string {
  const toName = body.to?.displayName ?? "(unknown)";
  const fromName = body.from?.displayName ?? "(unknown)";
  if (body.changed === false) {
    return body.dryRun === true
      ? `Dry run: ${applicationRef} is already named "${toName}".`
      : `${applicationRef} is already named "${toName}".`;
  }
  if (body.dryRun === true) {
    return `Dry run: ${applicationRef} display name would change "${fromName}" → "${toName}".`;
  }
  return `Changed ${applicationRef} display name to "${toName}".`;
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
  return session.address ?? session.sessionId ?? "unknown";
}

function formatOrganizationIdentity(organization: LiskovOrganizationSummary): string {
  return `${organization.name} (${organization.id}, ${organization.slug}, role ${organization.role})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
