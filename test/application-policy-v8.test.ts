import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { evaluateApplicationManifest, isRegisteredPublicationPair, type PolicyContractEvaluation } from "../src/application-policy.js";
import { runSlipwayApplicationPolicyPublish } from "../src/session.js";

const json = (name: string) => JSON.parse(readFileSync(`test/fixtures/payload-v8/${name}.json`, "utf8"));
const require = createRequire(import.meta.url);
const directory = path.resolve("src/policy-client-bundle");
const contract = require(path.join(directory, "policy-client.cjs")).loadPolicyContract(directory) as {
  evaluate(request: Record<string, unknown>): PolicyContractEvaluation;
};

for (const name of ["payload-replace", "payload-supervised-stop", "payload-supervised-rollback"]) {
  test(`V8 ${name} validates and materializes through the exact owner bundle`, () => {
    const manifest = json(name);
    const golden = json("materialization-digest-goldens").applications.find((v: { name: string }) => v.name === name);
    const validated = evaluateApplicationManifest(manifest);
    assert.equal(validated.valid, true);
    assert.deepEqual(validated.document, manifest);
    assert.equal(validated.authoredDigest, golden.authoredDigest);
    assert.equal(validated.releaseIntentDigest, golden.releaseIntentDigest);
    assert.equal(isRegisteredPublicationPair(validated), false);
    const effective = golden.effective;
    const runtime = effective.runtime;
    const materialization = {
      applicationUid: effective.applicationUid,
      evidence: {
        artifact: effective.artifact, provenance: effective.release,
        payloadRuntime: {
          imageDigest: runtime.imageDigest, helperDigest: runtime.helperDigest,
          bootstrapDigest: runtime.bootstrapDigest, bootstrapCid: runtime.bootstrapCid
        }
      }
    };
    const result = contract.evaluate({ schema: "proof.liskov.policy-client-request.v1", operation: "materialize", encoding: "json", document: JSON.stringify(manifest), materialization });
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.deepEqual(result.effective, golden.effective);
    assert.equal(result.policyDigest, golden.effectiveDigest);
    const wrong = structuredClone(materialization);
    wrong.evidence.artifact = { kind: "ipfs_bundle", digest: effective.artifact.digest, cid: "ipfs://fixture" };
    const mismatch = contract.evaluate({ schema: "proof.liskov.policy-client-request.v1", operation: "materialize", encoding: "json", document: JSON.stringify(manifest), materialization: wrong });
    assert.equal(mismatch.valid, false);
    assert.equal(mismatch.effective, undefined);
  });
}

test("the complete V8 negative corpus remains strict, with unknown capability and opaque future version refusals", () => {
  for (const sample of json("invalid-cases")) {
    const manifest = json("payload-supervised-rollback");
    const parts = sample.pointer.slice(1).split("/");
    let parent = manifest;
    for (const part of parts.slice(0, -1)) parent = parent[part];
    parent[parts.at(-1)!] = sample.value;
    const result = evaluateApplicationManifest(manifest);
    assert.equal(result.valid, false, sample.name);
    assert.ok(result.errors.length > 0, sample.name);
  }
  const manifest = json("payload-replace");
  manifest.runtime.kind = "unknown_runtime";
  assert.equal(evaluateApplicationManifest(manifest).valid, false);
  manifest.schemaVersion = 999;
  assert.equal(evaluateApplicationManifest(manifest).disposition, "unknown_opaque");
});

test("V8 source and pinned publication remain dark and make no request", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "v8-publication-"));
  try {
    for (const name of ["payload-supervised-stop", "payload-supervised-rollback"]) {
      const file = path.join(directory, "manifest.json");
      const manifest = json(name);
      writeFileSync(file, JSON.stringify(manifest));
      let output = "";
      let calls = 0;
      const code = await runSlipwayApplicationPolicyPublish({
        applicationRef: manifest.applicationId, file, artifactDigest: `sha256:${"a".repeat(64)}`,
        expectedPointerVersion: 0, dryRun: true, json: true,
        ...(manifest.release.mode === "source" ? { bindingRevision: 1, revocationEpoch: 0, sourceRef: "refs/heads/main", sourceCommit: "b".repeat(40), workflowIdentity: ".github/workflows/liskov.yml@refs/heads/main" } : {})
      }, { stdout: (line) => { output += line; }, fetchImpl: async () => { calls++; throw new Error("no network"); } });
      assert.equal(code, 1);
      assert.equal(calls, 0);
      assert.ok(JSON.parse(output).diagnostics.some((d: { code: string }) => d.code === "v8_production_registration_not_activated"));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
