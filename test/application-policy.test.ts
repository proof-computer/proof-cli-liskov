import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authoredDigest,
  releaseIntentDigest,
  validateApplicationManifestV4
} from "../src/application-policy.js";

function manifest(): Record<string, unknown> {
  return {
    schema: "proof.liskov.application-manifest",
    schemaVersion: 4,
    applicationId: "uptime-prober",
    metadata: { description: "Human-authored evidence" },
    release: {
      mode: "build",
      artifact: {
        kind: "ipfs_bundle",
        encryption: { mode: "aes256_gcm" }
      },
      builder: {
        kind: "github",
        repository: "proof-computer/uptime-prober",
        allowedRefs: ["refs/heads/main"],
        workflowRef: "proof-computer/uptime-prober/.github/workflows/release.yml@refs/heads/main",
        manifestPath: ".liskov/application-manifest.json"
      }
    },
    runtime: {
      requiredModules: ["module-a"],
      bootstrap: {
        trustProfile: "proof.liskov.attested-runtime.v1",
        signedDiagnosticsRequired: true,
        identityBoundSecretsRequired: true
      }
    },
    deployment: {
      parallelism: 1,
      schedule: { durationMs: 1_800_000 },
      lifecycle: {
        renewal: {
          mode: "before_scheduled_end",
          leadTime: { mode: "fixed", durationMs: 300_000 }
        },
        update: {
          timing: "immediate",
          existingJobs: { mode: "run_until_scheduled_end" }
        },
        recovery: {
          launch: { maxRetries: 5 },
          runtimeFailure: { mode: "wait_until_scheduled_end" }
        }
      }
    },
    observability: { runtimeDiagnostics: { signed: true } }
  };
}

describe("local application-manifest v4 tools", () => {
  it("validates build releases and rejects unknown and mixed release fields with pointers", () => {
    assert.deepEqual(validateApplicationManifestV4(manifest()), []);

    const unknown = manifest();
    const release = unknown.release as Record<string, unknown>;
    release.cid = "ipfs://bafyinvalid";
    const errors = validateApplicationManifestV4(unknown);
    assert.ok(errors.some((error) =>
      error.code === "unknown_field" && error.pointer === "/release/cid"));
  });

  it("rejects empty, malformed, unsafe, duplicate, and wrong-kind release evidence", () => {
    const input = manifest();
    const release = input.release as Record<string, unknown>;
    const builder = release.builder as Record<string, unknown>;
    builder.allowedRefs = ["refs/heads/main", "refs/heads/main"];
    builder.manifestPath = "../application-manifest.json";
    release.artifact = {
      kind: "runtime_image",
      encryption: { mode: "none" }
    };

    const errors = validateApplicationManifestV4(input);
    assert.ok(errors.some((error) => error.pointer === "/release/builder/allowedRefs/1"));
    assert.ok(errors.some((error) => error.pointer === "/release/builder/manifestPath"));
    assert.ok(errors.some((error) =>
      error.code === "unknown_field" && error.pointer === "/release/artifact/encryption"));
  });

  it("validates pinned IPFS and runtime-image artifacts strictly", () => {
    const ipfs = manifest();
    ipfs.release = {
      mode: "pinned",
      artifact: {
        kind: "ipfs_bundle",
        cid: "ipfs://bafybeigdyrzt",
        digest: `sha256:${"a".repeat(64)}`,
        encryption: { mode: "none" }
      }
    };
    assert.deepEqual(validateApplicationManifestV4(ipfs), []);

    const runtimeImage = manifest();
    runtimeImage.release = {
      mode: "pinned",
      artifact: {
        kind: "runtime_image",
        imageDigest: `sha256:${"b".repeat(64)}`,
        bootstrapCid: "ipfs://bafybeibootstrap",
        bootstrapDigest: `sha256:${"c".repeat(64)}`
      }
    };
    assert.deepEqual(validateApplicationManifestV4(runtimeImage), []);

    (runtimeImage.release as Record<string, Record<string, unknown>>).artifact.bootstrapDigest = "sha256:not-a-digest";
    assert.ok(validateApplicationManifestV4(runtimeImage).some((error) =>
      error.pointer === "/release/artifact/bootstrapDigest"));
  });

  it("separates authored and release-intent digest domains", () => {
    const original = manifest();
    const metadataEdit = structuredClone(original);
    metadataEdit.metadata = { description: "Changed prose" };
    assert.notEqual(authoredDigest(original), authoredDigest(metadataEdit));
    assert.equal(releaseIntentDigest(original), releaseIntentDigest(metadataEdit));

    const reorderedRefs = structuredClone(original);
    const builder = ((reorderedRefs.release as Record<string, unknown>).builder as Record<string, unknown>);
    builder.allowedRefs = ["refs/tags/v1", "refs/heads/main"];
    const reverse = structuredClone(reorderedRefs);
    (((reverse.release as Record<string, unknown>).builder as Record<string, unknown>).allowedRefs as unknown[]).reverse();
    assert.notEqual(authoredDigest(reorderedRefs), authoredDigest(reverse));
    assert.equal(releaseIntentDigest(reorderedRefs), releaseIntentDigest(reverse));
  });

  it("keeps contract validity separate from target capability diagnostics", () => {
    const input = manifest();
    const lifecycle = ((input.deployment as Record<string, unknown>).lifecycle as Record<string, unknown>);
    (lifecycle.update as Record<string, unknown>).existingJobs = {
      mode: "cooperative_cease",
      trigger: "successor_runtime_ready"
    };
    const diagnostics = validateApplicationManifestV4(input);
    assert.equal(diagnostics.filter((error) =>
      error.code === "invalid_manifest" || error.code === "unknown_field").length, 0);
    assert.ok(diagnostics.some((error) =>
      error.code === "unsupported_policy_feature"
      && error.pointer === "/deployment/lifecycle/update/existingJobs/mode"));
  });
});
