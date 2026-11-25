import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatExecutionPage } from "../src/execution-page.js";
import { formatJobProvenance } from "../src/job-provenance.js";

const { response: { executions } } = JSON.parse(readFileSync(new URL("./fixtures/job-provenance.json", import.meta.url), "utf8"));
const [complete, renewal, pending, revoked, attestationUnknown, keysPending, locationUnknown] =
  executions.attempts.map((attempt: { effects: { provenance: Record<string, unknown> }[] }) => attempt.effects[0].provenance);
const processor = "5CjMEeAZvXKhcyxzUdGzr63Jc72fZWSsx4xonauP4aP7Gi5Q";
const custody = "the key is held by Acurast's processor app, not hardware-attested.";

function lines(record: unknown): string[] {
  const output = formatJobProvenance(record);
  assert.doesNotMatch(output.join("\n"), /hardware-backed|unique|new key/i);
  return output;
}

describe("job provenance", () => {
  it("prints the wire facts in order with full keys and usable chain coordinates", () => {
    assert.deepEqual(lines(complete), [
      "Job provenance: 155065 (origin 5HC1mDQWVtxaDYysSNrmTTj2SNuP1YKjwWerLbUS8VA6ZTdN)",
      `  processorId: ${processor}`,
      "  jobPublicKeys:",
      `    ed25519: ${"aa".repeat(32)}`,
      "    secp256r1Encryption: 02cc",
      "  acknowledgement:",
      "    block: 299",
      `    blockHash: 0x${"0".repeat(61)}12b`,
      "    blockTimestampMs: 1970-01-01T00:00:10.000Z",
      "    extrinsicIndex: 2",
      `    extrinsicHash: 0x${"c".repeat(64)}`,
      "    eventIndex: 1",
      "    observedAtMs: 16000",
      "  attestation:",
      "    Liskov placement verdict at the acknowledgement: excluded",
      "    expiresAtMs: 1970-01-01T00:01:40.000Z",
      "    asOfMs: 1970-01-01T00:00:10.000Z",
      "    readAt:",
      "      block: 200",
      `      blockHash: 0x${"d".repeat(64)}`,
      "    window: in_window",
      "    coreCompatible: true",
      "    revocation: not_revoked",
      "    acurastMatch: admits",
      "    notBeforeMs: 0",
      "    notAfterMs: 100000",
      "  status: complete",
      "  registration:",
      `    blockHash: 0x${"b".repeat(64)}`,
      "    extrinsicIndex: 0",
      `    extrinsicHash: 0x${"a".repeat(64)}`,
      "    status: recorded",
      "  deregistration:",
      `    blockHash: 0x${"f".repeat(64)}`,
      "    extrinsicIndex: 7",
      `    extrinsicHash: 0x${"1".repeat(64)}`,
      "    status: recorded",
      "  predecessor: none",
      "  successor: occurrenceGeneration 2, jobId 155066",
      "  deployment on Acurast Hub: https://hub.acurast.com/explorer/deployment/155065",
      `  processor on Acurast Hub: https://hub.acurast.com/explorer/address/${processor}`,
      `  acknowledgement on Acurast Hub: https://hub.acurast.com/explorer/extrinsic/0x${"c".repeat(64)}`,
      `  registration on Acurast Hub: https://hub.acurast.com/explorer/extrinsic/0x${"a".repeat(64)}`,
      `  deregistration on Acurast Hub: https://hub.acurast.com/explorer/extrinsic/0x${"1".repeat(64)}`,
      `  signed by the key that attested processor ${processor} published for this job on chain; ${custody}`
    ]);
    assert.ok(lines(renewal).includes("  predecessor: occurrenceGeneration 1, jobId 155065"));
  });

  it("renders pending change coordinates or finalized facts and qualifies the custody sentence", () => {
    const pendingLines = lines(pending);
    assert.ok(pendingLines.includes("    readAt: not read from an inventory snapshot"));
    const index = pendingLines.indexOf("    pendingChange:");
    assert.notEqual(index, -1);
    assert.deepEqual(pendingLines.slice(index + 1, index + 3), ["      block: 100", "      eventIndex: 0"]);
    assert.doesNotMatch(pendingLines.join("\n"), /^    (?:window|coreCompatible|revocation|acurastMatch|notBeforeMs|notAfterMs):/m);
    const revokedLines = lines(revoked);
    assert.ok(revokedLines.includes("    revocation: revoked"));
    assert.ok(!revokedLines.includes("    pendingChange:"));
    for (const output of [pendingLines, revokedLines]) {
      assert.equal(output.at(-1), `  signed by the key that processor ${processor} published for this job on chain; ${custody}`);
      assert.doesNotMatch(output.find((line) => line.includes("placement verdict")) ?? "", /attested/);
    }
  });

  it("prints each partial status and only the reported chain coordinates", () => {
    const unknown = lines(locationUnknown);
    assert.equal(unknown[0], "Job provenance: legacy-unparseable-job");
    assert.ok(unknown.includes("  status: location_unknown — Liskov could not parse this job's identity, so it cannot locate the job's acknowledgement"));
    assert.doesNotMatch(unknown.join("\n"), /^  (?:acknowledgement:|acknowledgement on Acurast Hub:|deployment on Acurast Hub:)/m);
    assert.ok(unknown.includes("    status: block_not_recorded"));
    assert.ok(unknown.includes("    status: not_recorded"));
    assert.ok(unknown.includes("    extrinsicIndex: null"));

    const keys = lines(keysPending);
    assert.ok(keys.includes("  status: keys_pending — no acknowledgement is recorded yet"));
    assert.ok(keys.includes("  processor not known yet"));
    assert.equal(keys.at(-1), `  ${custody}`);
    assert.doesNotMatch(keys.join("\n"), /^  (?:processor on Acurast Hub:|deregistration on Acurast Hub:)/m);

    const attestation = lines(attestationUnknown);
    assert.ok(attestation.includes("  acknowledgement:"));
    assert.ok(attestation.includes("  status: attestation_unknown — Liskov held no attestation for the processor at the acknowledgement"));
    assert.ok(!attestation.includes("  attestation:"));
    assert.ok(lines({ ...keysPending, status: "new_status" }).includes("  status: new_status"));
  });

  it("shows the shared key on both jobs and explains reuse once per page", () => {
    assert.notEqual(complete.jobId, renewal.jobId);
    assert.equal(complete.jobPublicKeys.ed25519, renewal.jobPublicKeys.ed25519);
    const output = formatExecutionPage(executions);
    assert.equal(output.filter((line) => line === `    ed25519: ${complete.jobPublicKeys.ed25519}`).length, 2);
    assert.equal(output.filter((line) => line === "A job key belongs to an application release on a processor: consecutive jobs of the same release on the same processor publish the same key.").length, 1);
    assert.doesNotMatch(output.join("\n"), /hardware-backed|unique|new key/i);

    const withoutKeys = { ...complete };
    delete withoutKeys.jobPublicKeys;
    assert.notDeepEqual(lines(withoutKeys), lines(complete));
  });

  it("skips other effects and renders an opaque cursor only as a more-jobs notice", () => {
    const page = {
      nextCursor: "opaque",
      attempts: [{ effects: [{ effectKind: "custody_settlement", provenance: complete }] }]
    };
    assert.deepEqual(formatExecutionPage(page), [
      "more jobs exist than this page shows; read them with --json and the executions view"
    ]);
    assert.deepEqual(formatExecutionPage({ ...page, refusal: { code: "execution_page_unreadable" } }), []);
  });
});
