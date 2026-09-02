import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateApplicationManifest,
  isRegisteredSourcePublicationPair,
  setPolicyContractForTesting,
  validateApplicationManifest
} from "../src/application-policy.js";

function retainedJavascript(): Record<string, unknown> {
  return {
    schema: "proof.liskov.application-manifest",
    schemaVersion: 5,
    applicationId: "benchmark-js",
    metadata: {
      description: "Benchmark a fixed workload in the native JavaScript runtime.",
      labels: ["liskov", "example", "javascript"]
    },
    release: { mode: "source" },
    runtime: {
      kind: "javascript",
      engine: "nodejs",
      entrypoint: { file: "bundle.js" }
    },
    execution: { mode: "once" },
    deployment: {
      schedule: { duration: "10m" },
      spend: { unit: "service_credit_micros", perJob: "50000" }
    },
    state: { mode: "off" },
    observability: { logs: { enabled: true } }
  };
}

function retainedManagedSsh(): Record<string, unknown> {
  return {
    schema: "proof.liskov.application-manifest",
    schemaVersion: 5,
    applicationId: "cargo-ssh",
    metadata: {
      description: "Open an interactive shell into a processor over authenticated Runtime SSH.",
      labels: ["liskov", "example", "cargo", "access", "ssh"]
    },
    release: { mode: "source" },
    runtime: {
      kind: "native_image",
      image: { name: "debian-trixie", version: "0.1" },
      entrypoint: { executable: "/bin/sh", args: ["/app/start.sh"] }
    },
    execution: { mode: "continuous" },
    deployment: {
      schedule: { duration: "1h" },
      spend: {
        unit: "service_credit_micros",
        perJob: "600000",
        rate: { amount: "15000000", window: "1d" }
      }
    },
    access: { ssh: { provider: { kind: "liskov_managed" } } },
    configuration: {
      secrets: [{
        secretId: "cargo-ssh-password",
        required: true,
        destination: { kind: "environment", name: "SSH_PASSWORD" }
      }]
    },
    state: { mode: "off" },
    observability: { logs: { enabled: true } }
  };
}

describe("retained V5 application-manifest validation", () => {
  it("accepts retained javascript once and native_image managed-ssh goldens", () => {
    assert.deepEqual(validateApplicationManifest(retainedJavascript()), []);
    assert.deepEqual(validateApplicationManifest(retainedManagedSsh()), []);
  });

  it("keeps the explicit V4 path for schemaVersion 4", () => {
    const v4 = {
      schema: "proof.liskov.application-manifest",
      schemaVersion: 4,
      applicationId: "uptime-prober",
      release: {
        mode: "build",
        artifact: { kind: "ipfs_bundle", encryption: { mode: "aes256_gcm" } },
        builder: {
          kind: "github",
          repository: "proof-computer/uptime-prober",
          allowedRefs: ["refs/heads/main"],
          workflowRef: "proof-computer/uptime-prober/.github/workflows/release.yml@refs/heads/main",
          manifestPath: ".liskov/application-manifest.json"
        }
      },
      deployment: {
        parallelism: 1,
        schedule: { durationMs: 1_800_000 },
        lifecycle: {
          renewal: { mode: "after_scheduled_end" },
          update: { timing: "immediate", existingJobs: { mode: "run_until_scheduled_end" } },
          recovery: { runtimeFailure: { mode: "wait_until_scheduled_end" } }
        }
      }
    };
    assert.deepEqual(validateApplicationManifest(v4), []);
  });

  it("refuses deferred ingress, cohort, hooks, self-custody spend, alternate SSH, and state beyond off", () => {
    const ingress = retainedJavascript();
    ingress.ingress = { http: { mode: "required", port: 8080 } };
    assert.ok(validateApplicationManifest(ingress).some((error) =>
      error.pointer === "/ingress"));

    const cohort = retainedJavascript();
    cohort.cohort = { id: "workers" };
    assert.ok(validateApplicationManifest(cohort).some((error) => error.pointer === "/cohort"));

    const hooks = retainedJavascript();
    hooks.hooks = { onLaunch: [] };
    assert.ok(validateApplicationManifest(hooks).some((error) => error.pointer === "/hooks"));

    const acu = retainedJavascript();
    (acu.deployment as Record<string, Record<string, unknown>>).spend.unit = "acu";
    assert.ok(validateApplicationManifest(acu).some((error) =>
      error.pointer === "/deployment/spend/unit"));

    const tailscale = retainedManagedSsh();
    (tailscale.access as Record<string, Record<string, Record<string, unknown>>>).ssh.provider.kind = "tailscale";
    assert.ok(validateApplicationManifest(tailscale).some((error) =>
      error.pointer === "/access/ssh/provider/kind"));

    const stateOn = retainedJavascript();
    (stateOn.state as Record<string, unknown>).mode = "volumes";
    assert.ok(validateApplicationManifest(stateOn).some((error) =>
      error.pointer === "/state/mode"));
  });

  it("degrades on a future schemaVersion without interpreting nested fields", () => {
    const future = retainedJavascript();
    future.schemaVersion = 6;
    future.ingress = { http: { mode: "required" } };
    const diagnostics = validateApplicationManifest(future);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.code, "unknown_policy_schema");
    assert.equal(diagnostics[0]?.pointer, "/schema");
    assert.match(diagnostics[0]?.message ?? "", /no registered handler/u);
  });

  it("admits a synthetic later pair through registry injection without a version branch", () => {
    const future = { ...retainedJavascript(), schemaVersion: 6, futureContractMarker: "proof" };
    setPolicyContractForTesting({
      manifest: {
        publicationPairs: [{
          schema: "proof.liskov.application-manifest",
          schemaVersion: 6,
          releaseMode: "source"
        }]
      },
      evaluate: () => ({
        schema: "proof.liskov.policy-client-result.v1",
        operation: "validate",
        disposition: "supported",
        valid: true,
        pair: { schema: "proof.liskov.application-manifest", schemaVersion: 6 },
        document: future,
        errors: [],
        capabilityDiagnostics: [],
        deprecationDiagnostics: [],
        authoredDigest: "a".repeat(64),
        releaseIntentDigest: "b".repeat(64)
      })
    });
    try {
      const result = evaluateApplicationManifest(future);
      assert.equal(result.valid, true);
      assert.equal(isRegisteredSourcePublicationPair(result), true);
    } finally {
      setPolicyContractForTesting(undefined);
    }
  });
});
