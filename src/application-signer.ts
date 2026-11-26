import {
  arrayValue,
  authenticatedSlipwayJsonRequest,
  authenticatedSlipwayRequest,
  isoFromEpochMs,
  liskovAuthorityRefusal,
  numberValue,
  objectRecord,
  sessionUnauthorizedHuman,
  stringValue,
  writeConfirmationRequired,
  writeStructuredOrHuman,
  type SlipwayApplicationSignerInput,
  type SlipwayCliOptions,
  type SlipwayCustodyPairInput
} from "./session.js";

interface SlipwayCustodyPairingTokenResponse {
  ok?: boolean;
  pairingToken?: string;
  organizationId?: string;
  applicationId?: string;
  expiresAtMs?: number;
  websocketPath?: string;
  protocolVersion?: number;
  boundAddress?: string | null;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

interface SignerMutationRefusal {
  error?: string;
  reasonCode?: string;
  capability?: string;
  requestIds?: string[];
}

export interface SlipwayApplicationSignerUnpairInput extends SlipwayApplicationSignerInput {
  yes?: boolean;
}

const APPLICATION_SIGNER_PAIR_FAILED = "LISKOV_APPLICATION_SIGNER_PAIR_FAILED";
const APPLICATION_SIGNER_UNPAIR_FAILED = "LISKOV_APPLICATION_SIGNER_UNPAIR_FAILED";
const CUSTODY_PAIR_FAILED = "SLIPWAY_CUSTODY_PAIR_FAILED";
const PLAN_REQUIRED = "self_custody_plan_required";
const SIGN_REQUEST_OPEN = "self_custody_sign_request_open";
const SESSION_NOT_FOUND = "No Liskov CLI session is stored locally.";

export function applicationSignerPath(applicationRef: string): string {
  return `/api/applications/${encodeURIComponent(applicationRef)}/custody/signer`;
}

export function applicationSignerReadback(body: SlipwayApplicationSignerResponse | undefined): Record<string, unknown> | undefined {
  const readback = body?.signerReadback;
  return readback != null && typeof readback === "object" && !Array.isArray(readback) ? readback : undefined;
}

export function runSlipwayApplicationSignerPair(input: SlipwayApplicationSignerInput, options: SlipwayCliOptions = {}): Promise<number> {
  return issueSignerPairingToken(input, options, APPLICATION_SIGNER_PAIR_FAILED);
}

export function runSlipwayCustodyPair(input: SlipwayCustodyPairInput, options: SlipwayCliOptions = {}): Promise<number> {
  return issueSignerPairingToken(input, options, CUSTODY_PAIR_FAILED);
}

async function issueSignerPairingToken(
  input: SlipwayApplicationSignerInput,
  options: SlipwayCliOptions,
  errorCode: typeof APPLICATION_SIGNER_PAIR_FAILED | typeof CUSTODY_PAIR_FAILED
): Promise<number> {
  const request = await authenticatedSlipwayJsonRequest<SlipwayCustodyPairingTokenResponse>({
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    method: "POST",
    path: `${applicationSignerPath(input.applicationRef)}/pairing-token`,
    body: {},
    requestErrorCode: errorCode,
    notFoundMessage: SESSION_NOT_FOUND,
    fetchFailedMessage: "could not issue Liskov self-custody signer pairing token",
    protectSessionToken: true,
    wordsOwnRefusals: errorCode === APPLICATION_SIGNER_PAIR_FAILED
  }, options);
  if (!request.ok) return request.exitCode;

  const { body, slipwayUrl, sessionFile, response } = request;
  const pairingToken = stringValue(body?.pairingToken);
  if (!response.ok || body?.ok !== true || pairingToken === undefined) {
    if (errorCode === APPLICATION_SIGNER_PAIR_FAILED) {
      return writeSignerMutationFailure(input, options, errorCode, response.status, body);
    }
    const error = response.status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : errorCode;
    writeStructuredOrHuman(options, input.json, {
      ok: false,
      error,
      status: response.status,
      reason: body?.reason ?? body?.error,
      slipwayUrl,
      sessionFile
    }, `Error (${error}): Liskov could not issue a self-custody signer pairing token.`);
    return 1;
  }

  const controlPlaneUrl = signerControlPlaneUrl(slipwayUrl);
  const websocketUrl = signerWebsocketUrl(slipwayUrl, body.websocketPath, pairingToken);
  const signerCommand = `liskov-self-custody-signer --control-plane-url ${shellQuote(controlPlaneUrl)} --pairing-token ${shellQuote(pairingToken)}`;
  const lines = [
    `Issued self-custody signer pairing token for ${stringValue(body.applicationId) ?? input.applicationRef}.`,
    `Control plane: ${controlPlaneUrl}`,
    `Expires at: ${isoFromEpochMs(body.expiresAtMs) ?? "unknown"}`,
    `Run signer: ${signerCommand}`
  ];
  const boundAddress = stringValue(body.boundAddress);
  if (errorCode === APPLICATION_SIGNER_PAIR_FAILED && boundAddress !== undefined) {
    lines.push(`This replaces the paired signer ${boundAddress}. Jobs it registered still settle through it: keep it available, or run it again, until they finish.`);
  }
  writeStructuredOrHuman(options, input.json, { ...body, controlPlaneUrl, websocketUrl, signerCommand }, lines.join("\n"));
  return 0;
}

export async function runSlipwayApplicationSignerUnpair(input: SlipwayApplicationSignerUnpairInput, options: SlipwayCliOptions = {}): Promise<number> {
  if (!input.yes) {
    return writeConfirmationRequired(options, input.json, "LISKOV_APPLICATION_SIGNER_UNPAIR_CONFIRMATION_REQUIRED",
      "Removing a self-custody signer");
  }

  const request = {
    config: input.config,
    slipwayUrl: input.slipwayUrl,
    json: input.json,
    path: applicationSignerPath(input.applicationRef),
    requestErrorCode: APPLICATION_SIGNER_UNPAIR_FAILED,
    notFoundMessage: SESSION_NOT_FOUND,
    protectSessionToken: true,
    wordsOwnRefusals: true
  };
  const read = await authenticatedSlipwayRequest<SlipwayApplicationSignerResponse>({
    ...request,
    fetchFailedMessage: "could not read the application's self-custody signer"
  }, options);
  if (!read.ok) return read.exitCode;
  if (!read.response.ok) {
    return writeSignerMutationFailure(input, options, APPLICATION_SIGNER_UNPAIR_FAILED, read.response.status, read.body);
  }
  const readback = applicationSignerReadback(read.body);
  const boundAddress = readback?.boundSignerAddress;
  if (read.body?.ok !== true || readback === undefined
    || (boundAddress != null && typeof boundAddress !== "string")) {
    return writeSignerMutationFailure(input, options, APPLICATION_SIGNER_UNPAIR_FAILED, read.response.status,
      { error: "signer_readback_missing" });
  }

  // Both DELETE outcomes are 204. The address comes from the preceding read.
  const removed = await authenticatedSlipwayJsonRequest<SignerMutationRefusal>({
    ...request,
    method: "DELETE",
    body: undefined,
    fetchFailedMessage: "could not remove the application's self-custody signer"
  }, options);
  if (!removed.ok) return removed.exitCode;
  const { status } = removed.response;
  if (status !== 204) {
    return writeSignerMutationFailure(input, options, APPLICATION_SIGNER_UNPAIR_FAILED, status, removed.body);
  }

  const applicationRef = input.applicationRef;
  const removedAddress = boundAddress ?? null;
  writeStructuredOrHuman(options, input.json, { ok: true, applicationRef, removedAddress, status },
    removedAddress === null
      ? `No self-custody signer was paired to ${applicationRef}; nothing changed.`
      : `Removed the self-custody signer ${removedAddress} from ${applicationRef}.`);
  return 0;
}

function writeSignerMutationFailure(
  input: SlipwayApplicationSignerInput,
  options: SlipwayCliOptions,
  errorCode: string,
  status: number,
  body: SignerMutationRefusal | undefined
): number {
  const { applicationRef } = input;
  const authority = liskovAuthorityRefusal(status, body, applicationRef);
  const error = status === 401 ? "SLIPWAY_SESSION_UNAUTHORIZED" : authority?.error ?? errorCode;
  const reason = stringValue(body?.error);
  const requestIds = status === 409 && reason === SIGN_REQUEST_OPEN && Array.isArray(body?.requestIds)
    ? body.requestIds.filter((id) => typeof id === "string")
    : undefined;
  let message = reason ?? "Liskov returned an unexpected signer response.";
  if (status === 403 && reason === PLAN_REQUIRED) {
    message = `This organisation's plan does not include self-custody signing (${PLAN_REQUIRED}).`;
  } else if (requestIds !== undefined && requestIds.length > 0) {
    message = `${applicationRef} has open sign requests: ${requestIds.join(", ")}. Run unpair again when they finish.`;
  }
  const recovery = status === 401 ? sessionUnauthorizedHuman(error, "") : authority?.human;
  const human = recovery === undefined
    ? `Error (${error}): ${message}`
    : recovery + (reason === undefined ? "" : ` (${reason})`);
  writeStructuredOrHuman(options, input.json, {
    ok: false, error, status, reason, applicationRef, requestIds,
    reasonCode: stringValue(body?.reasonCode),
    capability: stringValue(body?.capability)
  }, human);
  return 1;
}

/**
 * `application_custody_signer_v1` (`liskov-rs` `application_custody_signer.rs`):
 * `executedFunding` reports observed funding or the server's reason it is unavailable.
 */
export interface SlipwayApplicationSignerResponse {
  ok?: boolean;
  schema?: string;
  applicationId?: string;
  activePolicyDigest?: string | null;
  generatedAtMs?: number;
  signerReadback?: Record<string, unknown>;
  executedFunding?: { available?: boolean; unavailableReason?: string; [key: string]: unknown };
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

/**
 * Only served fields. Liveness is the served `online`, never `connected` or a
 * heartbeat age. Every served count prints, including zero.
 */
export function formatApplicationSigner(requestedApplicationRef: string, body: SlipwayApplicationSignerResponse): string {
  const readback = objectRecord(body.signerReadback);
  const signers = arrayValue(readback.signers).map(objectRecord);
  const replacedSigners = arrayValue(readback.replacedSigners).map(objectRecord);
  const requests = arrayValue(readback.openRequests).map(objectRecord);
  const counts = objectRecord(readback.counts);
  const lag = objectRecord(readback.dispatchLag);
  const boundAddress = readback.boundSignerAddress;
  const truncated = "(list truncated; counts below are complete)";
  const lastSuccess = numberValue(lag.lastSuccessAgeMs) === undefined ? "-" : `${ms(lag.lastSuccessAgeMs)} ago`;
  return [
    `Self-custody signer for ${stringValue(body.applicationId) ?? requestedApplicationRef}`,
    `Policy: ${stringValue(body.activePolicyDigest) ?? "none"}`,
    `Standing: ${applicationSignerStanding(signers, counts, lag, readback.stallAfterMs)}`,
    typeof boundAddress === "string" ? `Bound address: ${boundAddress}` : undefined,
    ...(signers.length === 0
      ? ["No signer is paired to this application."]
      : ["Signers:", ...signers.map(formatSignerRow)]),
    readback.signersTruncated === true ? truncated : undefined,
    ...(replacedSigners.length === 0
      ? []
      : ["Replaced signers (connected to settle jobs they registered):", ...replacedSigners.map(formatSignerRow)]),
    formatSignerVersionPolicy(readback.signerVersionPolicy),
    ...(requests.length === 0
      ? ["No open sign requests."]
      : ["Open requests:", ...requests.map((request) => [
          stringValue(request.operationId) ?? "-",
          stringValue(request.status) ?? "-",
          stringValue(request.signerAddress) ?? "-",
          `sent ${request.sent === true ? "yes" : "no"}`,
          `attempt ${value(request.attemptSeq)}`,
          `deadline ${isoFromEpochMs(request.deadlineMs) ?? "-"}`
        ].join("\t"))]),
    readback.openRequestsTruncated === true ? truncated : undefined,
    `Counts: bound ${value(counts.boundSigners)}, online ${value(counts.onlineSigners)}, open ${value(counts.openRequests)}, pending ${value(counts.pending)}, claimed ${value(counts.claimed)}, completed ${value(counts.completed)}, signed ${value(counts.signed)}, refused ${value(counts.refused)}, expired ${value(counts.expired)}, ambiguous ${value(counts.ambiguous)}`,
    `Dispatch lag: oldest unclaimed ${ms(lag.oldestUnclaimedAgeMs)}, oldest claimed ${ms(lag.oldestClaimedAgeMs)}, last success ${lastSuccess}`,
    `Last signature: ${isoFromEpochMs(readback.lastSuccessAtMs) ?? "none"}`,
    ...formatObservedFunding(objectRecord(body.executedFunding))
  ].filter((line) => line !== undefined).join("\n");
}

function value(served: unknown): string {
  return String(numberValue(served) ?? "-");
}

function ms(served: unknown): string {
  const age = numberValue(served);
  return age === undefined ? "-" : `${age} ms`;
}

function formatSignerRow(signer: Record<string, unknown>): string {
  const version = typeof signer.signerVersion === "string" ? signer.signerVersion : "-";
  const standing = signer.versionStanding;
  const advisory = standing === "update_recommended" || standing === "update_required" || standing === "unknown"
    ? ` (${standing.replaceAll("_", " ")})`
    : "";
  return [
    stringValue(signer.signerAddress) ?? "-",
    signer.online === true ? "online" : "offline",
    signer.connected === true ? "connected" : "disconnected",
    `heartbeat ${ms(signer.heartbeatAgeMs)}`,
    `protocol ${value(signer.protocolVersion)}`,
    `version ${version}${advisory}`
  ].join("\t");
}

function formatSignerVersionPolicy(served: unknown): string | undefined {
  const { recommendedMinimum, requiredFromMs } = objectRecord(served);
  if (typeof recommendedMinimum !== "string") return undefined;

  const requiredFrom = isoFromEpochMs(requiredFromMs);
  return `Signer version: minimum ${recommendedMinimum}${requiredFrom === undefined ? "" : `, required from ${requiredFrom}`}`;
}

function formatObservedFunding(funding: Record<string, unknown>): string[] {
  if (funding.available !== true) {
    return [`Observed funding: not reported (${stringValue(funding.unavailableReason) ?? "-"}).`];
  }

  const source = stringValue(funding.source) ?? "-";
  const unit = stringValue(funding.unit) ?? "-";
  const oldest = numberValue(funding.oldestUnresolvedHoldAgeMs);
  const deregistrationHolds = numberValue(funding.deregistrationHolds);
  const lines = [
    `Observed funding (${source}, ${unit}):`,
    `  Admitted ${value(funding.admitted)}, open reserves ${value(funding.openReserves)}, settled ${value(funding.settled)}`,
    `  Settled amount: ${formatSettledAmount(funding.settledPlanck, unit)}`,
    `  Closed, amount unknown: ${value(funding.closedAmountUnknown)}${formatReasons(funding.closedAmountUnknownByReason)}`,
    `  Unresolved holds: ${value(funding.unresolvedHolds)}${oldest === undefined ? "" : `, oldest ${oldest} ms`}`
  ];
  if (deregistrationHolds !== undefined) {
    lines.push(`  Deregistration holds: ${deregistrationHolds}${formatReasons(funding.deregistrationHoldsByReason)}`);
  }
  const retiredSignerHolds = arrayValue(funding.retiredSignerHolds).map(objectRecord);
  if (retiredSignerHolds.length > 0) {
    lines.push("  Retired signers to reconnect:");
    for (const hold of retiredSignerHolds) {
      const address = stringValue(hold.signerAddress) ?? "address not provable";
      const count = numberValue(hold.holds);
      lines.push(`    ${address}  ${count ?? "-"} ${count === 1 ? "launch" : "launches"}`);
    }
  }
  return lines;
}

function formatReasons(served: unknown): string {
  const reasons = Object.entries(objectRecord(served)).map(([reason, count]) => `${reason} ${value(count)}`);
  return reasons.length === 0 ? "" : ` (${reasons.join(", ")})`;
}

function formatSettledAmount(served: unknown, unit: string): string {
  if (served === null) return "not provable (a settled job has no settlement Liskov can prove)";
  const planck = stringValue(served);
  if (planck === undefined) return "-";
  if (unit !== "acu_planck") return `${planck} ${unit}`;
  if (!/^[0-9]+$/u.test(planck)) return "-";

  const acuDecimals = 12;
  const planckPerAcu = 10n ** BigInt(acuDecimals);
  const amount = BigInt(planck);
  const whole = amount / planckPerAcu;
  const fraction = (amount % planckPerAcu).toString().padStart(acuDecimals, "0").replace(/0+$/u, "");
  const acu = fraction === "" ? whole.toString() : `${whole}.${fraction}`;
  return `${acu} ACU (${planck} planck)`;
}

/** The first standing that applies, in the order the Console agreed (`driw`). */
function applicationSignerStanding(
  signers: Record<string, unknown>[],
  counts: Record<string, unknown>,
  lag: Record<string, unknown>,
  stallAfterMs: unknown
): string {
  if (signers.length === 0) return "unpaired";
  const offline = signers.find((signer) => signer.online !== true);
  if (offline) {
    return offline.connected === true
      ? `offline (connected, heartbeat ${numberValue(offline.heartbeatAgeMs) ?? "-"} ms ago; online after ${numberValue(stallAfterMs) ?? "-"} ms of silence is not assumed)`
      : "offline (disconnected)";
  }
  const oldProtocol = signers.find((signer) => {
    const protocol = numberValue(signer.protocolVersion);
    return protocol !== undefined && protocol < 2;
  });
  if (oldProtocol) return `signer protocol ${numberValue(oldProtocol.protocolVersion)} is below 2`;
  const ambiguous = numberValue(counts.ambiguous) ?? 0;
  if (ambiguous > 0) return `${ambiguous} sent request(s) with no legible outcome`;
  const pending = numberValue(counts.pending) ?? 0;
  if (pending > 0) return `${pending} request(s) waiting ${numberValue(lag.oldestUnclaimedAgeMs) ?? "-"} ms for a signer`;
  return "online";
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
