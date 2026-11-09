import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import type { PolicyContractEvaluation } from "../src/application-policy.js";

interface Document {
  applicationId: string;
  deployment: { booking?: unknown; [key: string]: unknown };
  release: Record<string, unknown>;
  [key: string]: unknown;
}
interface Sample {
  name: string;
  request: { document: string; encoding: "json" | "yaml"; [key: string]: unknown };
  expected?: Record<string, unknown>;
  expectedCode?: string;
  expectedPointer?: string;
}

// Run after install/build, as in AGENTS.md. Exercise the shipped files from
// an actual tarball, with installed dependencies resolved from this checkout.
test("the npm tarball loads the pinned booking contract and keeps publication gated", async () => {
  mkdirSync(".tmp", { recursive: true });
  const scratch = mkdtempSync(path.resolve(".tmp/booking-package-"));
  try {
    const [packed] = JSON.parse(execFileSync("npm", [
      "pack", "--json", "--ignore-scripts", "--pack-destination", scratch,
      "--cache", path.join(scratch, "cache")
    ], { encoding: "utf8" })) as Array<{ filename: string }>;
    execFileSync("tar", ["-xzf", path.join(scratch, packed!.filename), "-C", scratch]);
    const directory = path.join(scratch, "package/dist/policy-client-bundle");
    const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
    const digest = (file: string) => `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
    const source = json(path.join(directory, "source.json")) as {
      commit: string; files: Record<string, { source: string; sha256: string }>;
    };
    assert.equal(source.commit, "8d31d0e3c18d2e48426c63f1af5a4c5fd737d2d0");
    for (const [file, entry] of Object.entries(source.files)) {
      const packaged = file.startsWith("test/") ? file : path.join(directory, file);
      assert.equal(digest(packaged), entry.sha256, file);
      if (!file.startsWith("test/")) {
        assert.deepEqual(readFileSync(packaged), readFileSync(path.join("src/policy-client-bundle", file)), file);
      }
    }
    assert.equal(digest(path.join(directory, "policy-client-bundle.json")),
      "sha256:9b01e404387b061d188576db27c3d540a5bc9ca53c74a1e6c303bfc725a5f03d");
    const require = createRequire(import.meta.url);
    const contract = require(path.join(directory, "policy-client.cjs")).loadPolicyContract(directory) as {
      evaluate(request: Record<string, unknown>): PolicyContractEvaluation;
    };
    const cli = await import(pathToFileURL(path.join(scratch, "package/dist/application-policy.js")).href) as typeof import("../src/application-policy.js");
    const { runSlipwayApplicationPolicyPublish } = await import(
      pathToFileURL(path.join(scratch, "package/dist/session.js")).href
    ) as typeof import("../src/session.js");
    const corpus = json(path.join(directory, "policy-client-conformance.json")) as {
      valid: Sample[]; invalid: Sample[]; unknown: Sample;
    };
    const sample = (name: string) => {
      const found = corpus.valid.find((entry) => entry.name === name);
      assert.ok(found, name);
      return found;
    };
    const evaluate = (document: Document, operation = "validate", materialization?: unknown) => contract.evaluate({
      schema: "proof.liskov.policy-client-request.v1", operation,
      encoding: "json", document: JSON.stringify(document), materialization
    });
    const document = (name: string) => structuredClone(contract.evaluate(sample(name).request).document) as Document;
    const fragments = json("test/fixtures/booking-v6/booking-fragments.json") as {
      corpusFixture: string; cases: Array<{ name: string; booking: unknown }>;
    };
    const goldens = json("test/fixtures/booking-v6/materialization-digest-goldens.json") as {
      booking: Record<string, { effective: Document; authoredDigest: string; releaseIntentDigest: string; effectiveDigest: string }>;
    };
    let networkCalls = 0;
    const publish = async (draft: Document, expectedCode: string, expectedPointer: string, pinned = false) => {
      const file = path.join(scratch, "manifest.json");
      writeFileSync(file, JSON.stringify(draft));
      let output = "";
      const code = await runSlipwayApplicationPolicyPublish({
        applicationRef: draft.applicationId, file, artifactDigest: `sha256:${"a".repeat(64)}`,
        expectedPointerVersion: 0, json: true, yes: true,
        ...(pinned ? {} : {
          bindingRevision: 1, revocationEpoch: 0, sourceRef: "refs/heads/main",
          sourceCommit: "b".repeat(40), workflowIdentity: ".github/workflows/liskov.yml@refs/heads/main"
        })
      }, {
        fetchImpl: async () => { networkCalls++; throw new Error("offline publication must make no request"); },
        stdout: (text) => { output += text; }
      });
      assert.equal(code, 1);
      const result = JSON.parse(output);
      assert.equal(result.error, "SLIPWAY_APPLICATION_POLICY_PUBLISH_MANIFEST_INVALID");
      assert.ok(result.diagnostics.some((error: { code: string; pointer: string }) =>
        error.code === expectedCode && error.pointer === expectedPointer), output);
    };

    for (const entry of fragments.cases) {
      const draft = document(`v6/${fragments.corpusFixture}`);
      draft.deployment.booking = entry.booking;
      const result = cli.evaluateApplicationManifest(draft);
      const golden = goldens.booking[entry.name]!;
      assert.equal(result.valid, true, entry.name);
      assert.equal(result.authoredDigest, golden.authoredDigest, entry.name);
      assert.equal(result.releaseIntentDigest, golden.releaseIntentDigest, entry.name);
      const effective = golden.effective;
      const materialized = evaluate(draft, "materialize", {
        applicationUid: effective.applicationUid,
        evidence: { artifact: effective.artifact, provenance: effective.release }
      });
      assert.equal(materialized.valid, true, JSON.stringify(materialized.errors));
      assert.deepEqual(materialized.effective, effective, entry.name);
      assert.equal(materialized.policyDigest, golden.effectiveDigest, entry.name);
      assert.equal(cli.isRegisteredPublicationPair(result), false);
      assert.equal(cli.isRegisteredSourcePublicationPair(result), false);
      await publish(draft, "invalid_manifest", "/schema");
      const pinned = structuredClone(draft);
      pinned.release = { mode: "pinned", artifact: { digest: `sha256:${"a".repeat(64)}` } };
      await publish(pinned, "invalid_manifest", "/schema", true);
    }

    // The owner's native and JS support cut, without a second booking parser.
    for (const name of ["v6/cargo-ssh", "v6/telegram-bot"]) {
      for (const horizon of ["1h", "23h"]) {
        const draft = document(name);
        draft.deployment.booking = { mode: "ahead_of_time", horizon };
        assert.equal(cli.evaluateApplicationManifest(draft).valid, true, `${name} ${horizon}`);
      }
    }
    const refusals = corpus.invalid.filter((entry) => entry.name.startsWith("v6/invalid/booking-"));
    assert.equal(refusals.length, 10);
    for (const entry of refusals) {
      const result = contract.evaluate(entry.request);
      assert.equal(result.valid, false, entry.name);
      assert.equal(result.errors[0]?.code, entry.expectedCode, entry.name);
      assert.equal(result.errors[0]?.pointer, entry.expectedPointer, entry.name);
      const draft = result.document as Document;
      const materialized = evaluate(draft, "materialize", sample("v6/materialize/telegram-bot").request.materialization);
      assert.equal(materialized.valid, false, entry.name);
      assert.equal(materialized.errors[0]?.code, entry.expectedCode, entry.name);
      assert.equal(materialized.errors[0]?.pointer, entry.expectedPointer, entry.name);
      await publish(draft, entry.expectedCode!, entry.expectedPointer!);
    }
    const booking = document("v6/telegram-bot");
    booking.deployment.booking = { mode: "just_in_time" };
    for (const schemaVersion of [4, 5, 7, 8]) {
      const result = cli.evaluateApplicationManifest({ ...booking, schemaVersion });
      assert.equal(result.valid, false, `booking in V${schemaVersion}`);
    }
    const unknown = contract.evaluate(corpus.unknown.request);
    assert.equal(unknown.disposition, "unknown_opaque");
    assert.equal(cli.isRegisteredPublicationPair(unknown), false);
    await publish(JSON.parse(corpus.unknown.request.document), "unknown_policy_schema", "/schema");

    // Absence keeps every retained validate/materialize byte and digest.
    for (const entry of corpus.valid.filter((entry) => /^v[56]\//u.test(entry.name))) {
      const result = contract.evaluate(entry.request);
      assert.equal(result.valid, true, entry.name);
      for (const [field, expected] of Object.entries(entry.expected!)) {
        assert.deepEqual(result[field as keyof PolicyContractEvaluation], expected, `${entry.name} ${field}`);
      }
      assert.equal(cli.isRegisteredPublicationPair(result), result.pair?.schemaVersion === 5);
    }
    assert.equal(networkCalls, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
