import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { isRegisteredSourcePublicationPair, type PolicyContractEvaluation } from "../src/application-policy.js";

const require = createRequire(import.meta.url);
const bundleDirectory = path.resolve("src/policy-client-bundle");
const { loadPolicyContract } = require(path.join(bundleDirectory, "policy-client.cjs")) as {
  loadPolicyContract(directory: string): { evaluate(request: Record<string, unknown>): PolicyContractEvaluation };
};
const contract = loadPolicyContract(bundleDirectory);
const corpus = JSON.parse(readFileSync(path.join(bundleDirectory, "policy-client-conformance.json"), "utf8")) as {
  valid: Array<{ name: string; request: Record<string, unknown>; expected: Record<string, unknown> }>;
  invalid: Array<{ name: string; request: Record<string, unknown>; expectedCode: string; expectedPointer: string }>;
};

test("vendored policy contract matches the complete shared corpus", () => {
  for (const sample of corpus.valid) {
    const result = contract.evaluate(sample.request);
    assert.equal(result.disposition, "supported", sample.name);
    assert.equal(result.valid, true, sample.name);
    for (const [field, expected] of Object.entries(sample.expected)) {
      assert.deepEqual(result[field as keyof PolicyContractEvaluation], expected, `${sample.name} ${field}`);
    }
  }
  for (const sample of corpus.invalid) {
    const result = contract.evaluate(sample.request) as { valid: boolean; errors: Array<{ code: string; pointer: string }> };
    assert.equal(result.valid, false, sample.name);
    assert.equal(result.errors[0]?.code, sample.expectedCode, sample.name);
    assert.equal(result.errors[0]?.pointer || "/", sample.expectedPointer, sample.name);
  }
});

test("vendored artifacts match the complete merged producer bundle", () => {
  // BKLG-20260926-6f4f, liskov-rs PR #1826 (ADR-0071):
  // 13f039d41b8febf36db37844a7a61cc405fcec79. Pin the manifest itself so
  // a coherent but different bundle cannot silently replace the owner's bytes.
  const manifestBytes = readFileSync(path.join(bundleDirectory, "policy-client-bundle.json"));
  const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(digest(manifestBytes), "sha256:f9f4734f99b2b0c660dc4f7a3bf07cd338e7639a8d1543ebf5a55645797c587e");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    artifact: { file: string; sha256: string; uncompressedSha256: string };
    adapter: { file: string; sha256: string };
    types: { file: string; sha256: string };
    conformance: { file: string; sha256: string };
    publicationPairs: Array<{ schema: string; schemaVersion: number; releaseMode: string }>;
  };
  for (const entry of [manifest.artifact, manifest.adapter, manifest.types, manifest.conformance]) {
    assert.equal(digest(readFileSync(path.join(bundleDirectory, entry.file))), entry.sha256, entry.file);
  }
  assert.equal(
    digest(gunzipSync(readFileSync(path.join(bundleDirectory, manifest.artifact.file)))),
    manifest.artifact.uncompressedSha256
  );
  assert.deepEqual(manifest.publicationPairs, [{
    schema: "proof.liskov.application-manifest", schemaVersion: 5, releaseMode: "source"
  }]);
});

test("V7 provider-gated materialization accepts the owner's matching Access observation", () => {
  const sample = corpus.valid.find((entry) => entry.name === "v7/materialize/cloudflare-provider-gated");
  assert.ok(sample, "producer bundle must include matching Access evidence");
  assert.equal(sample.request.operation, "materialize");
  const result = contract.evaluate(sample.request);
  assert.equal(result.operation, "materialize");
  assert.equal(result.disposition, "supported");
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.effective);
  assert.deepEqual(result.effective, sample.expected.effective);
  assert.equal(result.policyDigest, sample.expected.policyDigest);
  assert.equal(isRegisteredSourcePublicationPair(result), false);
});

for (const mismatch of ["access-absent", "access-hostname", "access-path"]) {
  test(`V7 provider-gated materialization refuses the owner's ${mismatch} observation`, () => {
    const sample = corpus.invalid.find((entry) =>
      entry.name === `v7/materialize/cloudflare-provider-gated/${mismatch}`);
    assert.ok(sample, `producer bundle must include ${mismatch} evidence`);
    assert.equal(sample.request.operation, "materialize");
    const result = contract.evaluate(sample.request);
    assert.equal(result.operation, "materialize");
    assert.equal(result.valid, false);
    assert.equal(result.errors[0]?.code, sample.expectedCode);
    assert.equal(result.errors[0]?.pointer, sample.expectedPointer);
    assert.equal(result.effective, undefined);
    assert.equal(result.policyDigest, undefined);
    assert.equal(isRegisteredSourcePublicationPair(result), false);
  });
}
