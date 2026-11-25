import { asObject } from "./policy-explanation.js";

export const JOB_KEY_REUSE =
  "A job key belongs to an application release on a processor: consecutive jobs of the same release on the same processor publish the same key.";

const HUB_EXPLORER = "https://hub.acurast.com/explorer";
const STATUS_REASONS = new Map([
  ["location_unknown", "Liskov could not parse this job's identity, so it cannot locate the job's acknowledgement"],
  ["keys_pending", "no acknowledgement is recorded yet"],
  ["attestation_unknown", "Liskov held no attestation for the processor at the acknowledgement"]
]);
const ATTESTATION_FIELDS = ["window", "coreCompatible", "revocation", "acurastMatch", "notBeforeMs", "notAfterMs"];
const EXTRINSIC_FIELDS = ["blockHash", "extrinsicIndex", "extrinsicHash"];
const KEY_CUSTODY = "the key is held by Acurast's processor app, not hardware-attested";

export function formatJobProvenance(value: unknown): string[] {
  const record = asObject(value);
  if (!record || typeof record.jobId !== "string" || typeof record.status !== "string") return [];

  const job = acurastJob(record.jobId);
  const processor = typeof record.processorId === "string" ? record.processorId : null;
  const lines = [
    `Job provenance: ${job ? `${job.sequence} (origin ${job.origin})` : record.jobId}`,
    processor === null ? "  processor not known yet" : `  processorId: ${processor}`
  ];

  const keys = asObject(record.jobPublicKeys);
  if (keys && Object.keys(keys).length > 0) {
    lines.push("  jobPublicKeys:");
    for (const [name, key] of Object.entries(keys)) {
      if (typeof key === "string") lines.push(`    ${name}: ${key}`);
    }
  }

  const acknowledgement = asObject(record.acknowledgement);
  if (acknowledgement) {
    lines.push("  acknowledgement:");
    lines.push(...formatFields(
      { ...acknowledgement, blockTimestampMs: isoTime(acknowledgement.blockTimestampMs) },
      ["block", "blockHash", "blockTimestampMs", "extrinsicIndex", "extrinsicHash", "eventIndex", "observedAtMs"],
      "    "
    ));
  }

  const attestation = record.status === "complete" ? asObject(record.attestation) : undefined;
  if (attestation) lines.push(...formatAttestation(attestation));
  const reason = STATUS_REASONS.get(record.status);
  lines.push(`  status: ${record.status}${reason === undefined ? "" : ` — ${reason}`}`);

  const registration = asObject(record.registration);
  const deregistration = asObject(record.deregistration);
  if (registration) lines.push("  registration:", ...formatFields(registration, [...EXTRINSIC_FIELDS, "status"], "    "));
  if (deregistration) lines.push("  deregistration:", ...formatFields(deregistration, [...EXTRINSIC_FIELDS, "status"], "    "));
  lines.push(formatNeighbour("predecessor", record.predecessor), formatNeighbour("successor", record.successor));

  appendHubLink(lines, "deployment", "deployment", job?.sequence);
  appendHubLink(lines, "processor", "address", processor);
  appendHubLink(lines, "acknowledgement", "extrinsic", acknowledgement?.extrinsicHash);
  appendHubLink(lines, "registration", "extrinsic", registration?.extrinsicHash);
  appendHubLink(lines, "deregistration", "extrinsic", deregistration?.extrinsicHash);

  const attested = attestation?.window === "in_window" && attestation.revocation === "not_revoked"
    && asObject(attestation.pendingChange) === undefined;
  const publication = processor === null
    ? ""
    : `signed by the key that ${attested ? "attested " : ""}processor ${processor} published for this job on chain; `;
  lines.push(`  ${publication}${KEY_CUSTODY}.`);
  return lines;
}

function formatAttestation(attestation: Record<string, unknown>): string[] {
  const lines = [
    "  attestation:",
    `    Liskov placement verdict at the acknowledgement: ${fieldText(attestation.verdict)}`,
    `    expiresAtMs: ${isoTime(attestation.expiresAtMs)}`,
    `    asOfMs: ${isoTime(attestation.asOfMs)}`
  ];
  const readAt = asObject(attestation.readAt);
  if (readAt) {
    lines.push("    readAt:", ...formatFields(readAt, ["block", "blockHash"], "      "));
  } else {
    lines.push("    readAt: not read from an inventory snapshot");
  }

  const pendingChange = asObject(attestation.pendingChange);
  if (pendingChange) {
    lines.push("    pendingChange:", ...formatFields(pendingChange, ["block", "eventIndex"], "      "));
  } else {
    lines.push(...formatFields(attestation, ATTESTATION_FIELDS, "    "));
  }
  return lines;
}

function formatNeighbour(label: string, value: unknown): string {
  const neighbour = asObject(value);
  if (!neighbour) return `  ${label}: none`;
  const jobId = typeof neighbour.jobId === "string" ? neighbour.jobId : null;
  const job = jobId === null ? undefined : acurastJob(jobId);
  return `  ${label}: occurrenceGeneration ${fieldText(neighbour.occurrenceGeneration)}, jobId ${fieldText(job?.sequence ?? jobId)}`;
}

function acurastJob(jobId: string): { origin: string; sequence: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jobId);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const origin = asObject(parsed[0])?.Acurast;
  const sequence: unknown = parsed[1];
  if (typeof origin !== "string" || origin.length === 0 || typeof sequence !== "string" || !/^\d+$/u.test(sequence)) {
    return undefined;
  }
  return { origin, sequence };
}

function formatFields(record: Record<string, unknown>, fields: readonly string[], indent: string): string[] {
  return fields.map((name) => `${indent}${name}: ${fieldText(record[name])}`);
}

function fieldText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "not reported";
}

function isoTime(value: unknown): string {
  if (typeof value !== "number") return fieldText(value);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fieldText(value);
}

function appendHubLink(lines: string[], label: string, path: string, value: unknown): void {
  if (typeof value === "string" && value.length > 0) {
    lines.push(`  ${label} on Acurast Hub: ${HUB_EXPLORER}/${path}/${encodeURIComponent(value)}`);
  }
}
