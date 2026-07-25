import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  migrateApplicationPolicyV3,
  validateApplicationPolicyV4
} from "../src/application-policy.js";

function policy(): Record<string, unknown> {
  return {
    schema: "proof.liskov.application-policy",
    schemaVersion: 4,
    applicationId: "uptime-prober",
    runtime: {
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
          existingJobs: {
            mode: "cooperative_cease",
            trigger: "successor_runtime_ready"
          }
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

describe("local application-policy v4 tools", () => {
  it("validates the first-public contract and rejects unknown fields with pointers", () => {
    assert.deepEqual(validateApplicationPolicyV4(policy()), []);
    const unknown = policy();
    ((unknown.deployment as Record<string, unknown>).lifecycle as Record<string, unknown>).surprise = true;
    assert.ok(validateApplicationPolicyV4(unknown).some((error) =>
      error.code === "unknown_field" && error.pointer === "/deployment/lifecycle/surprise"));
  });

  it("preserves explicit recovery zeroes and reports typed-but-disabled capabilities", () => {
    const input = policy();
    const lifecycle = (input.deployment as Record<string, unknown>).lifecycle as Record<string, unknown>;
    const recovery = lifecycle.recovery as Record<string, unknown>;
    recovery.launch = { maxRetries: 0 };
    recovery.runtimeFailure = {
      mode: "replace_after_failure",
      contactLossAfterMs: 300_000,
      restartGraceMs: 0,
      maxSameJobRestarts: 0,
      maxFreshRegistrationReplacements: 0
    };
    const errors = validateApplicationPolicyV4(input);
    assert.equal(errors.filter((error) => error.code === "invalid_policy").length, 0);
    assert.ok(errors.some((error) => error.code === "unsupported_policy_feature"));
  });

  it("enforces union-arm fields and primitive types as strictly as the server contract", () => {
    const input = policy();
    const deployment = input.deployment as Record<string, unknown>;
    const lifecycle = deployment.lifecycle as Record<string, unknown>;
    lifecycle.renewal = {
      mode: "after_scheduled_end",
      leadTime: { mode: "fixed", durationMs: 60_000 }
    };
    const runtime = input.runtime as Record<string, unknown>;
    runtime.requiredModules = ["ok", 42];
    const errors = validateApplicationPolicyV4(input);
    assert.ok(errors.some((error) =>
      error.code === "unknown_field"
      && error.pointer === "/deployment/lifecycle/renewal/leadTime"));
    assert.ok(errors.some((error) =>
      error.code === "invalid_policy"
      && error.pointer === "/runtime/requiredModules"));
  });

  it("migrates v3 deterministically, warns, and round-trips through strict validation", () => {
    const input = {
      domain: "proof.slipway.application-policy.v3",
      applicationId: "uptime-prober",
      runtime: {
        durationMs: 1_800_000,
        desiredCount: 1,
        replacementRunwayMs: 900_000
      },
      artifact: { mode: "manual-cid", cid: "bafy-test" },
      artifactAutomation: {
        github: {
          autoPublish: true,
          repository: "proof-computer/uptime-prober",
          allowedRefs: ["refs/heads/main"]
        }
      },
      source: { path: ".liskov/policy.json" },
      acurast: {
        managerId: "9470",
        processorSelection: {
          mode: "open-market",
          excludeManagers: ["untrusted-manager"],
          allowUnknownManager: true,
          requireScheduleClear: true,
          requireConsumerAccess: true,
          maxHeartbeatAgeSeconds: 60,
          candidateLimit: 16,
          scanLimit: 32
        },
        recovery: { maxAutoRetries: 0, maxRuntimeReplaces: 0 }
      }
    };
    const first = migrateApplicationPolicyV3(input);
    const second = migrateApplicationPolicyV3(input);
    assert.deepEqual(first, second);
    assert.equal(
      ((first.policy.deployment as Record<string, unknown>).lifecycle as Record<string, unknown>).renewal
        && (((first.policy.deployment as Record<string, unknown>).lifecycle as Record<string, unknown>).renewal as Record<string, unknown>).mode,
      "after_scheduled_end"
    );
    assert.ok(first.warnings.some((warning) => warning.code === "legacy_replacement_runway_ignored"));
    assert.ok(first.warnings.some((warning) => warning.code === "automatic_publication_removed"));
    assert.ok(first.warnings.some((warning) => warning.code === "open_market_manager_binding_ignored"));
    assert.equal(
      ((first.policy.build as Record<string, unknown>).github as Record<string, unknown>).repository,
      "proof-computer/uptime-prober"
    );
    assert.deepEqual(
      ((first.policy.deployment as Record<string, unknown>).placement as Record<string, unknown>).processorSelection,
      {
        mode: "open_market",
        excludeManagers: ["untrusted-manager"],
        allowUnknownManager: true,
        requireScheduleClear: true,
        requireConsumerAccess: true,
        maxHeartbeatAgeSeconds: 60,
        candidateLimit: 16,
        scanLimit: 32
      }
    );
    assert.equal(validateApplicationPolicyV4(first.policy).length, 0);
  });
});
