import { arrayValue, isoFromEpochMs, numberValue, objectRecord, stringValue } from "./session.js";

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
  return [
    stringValue(signer.signerAddress) ?? "-",
    signer.online === true ? "online" : "offline",
    signer.connected === true ? "connected" : "disconnected",
    `heartbeat ${ms(signer.heartbeatAgeMs)}`,
    `protocol ${value(signer.protocolVersion)}`
  ].join("\t");
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
