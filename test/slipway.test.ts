import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  runSlipwayApplicationBackfillIdentities,
  runSlipwayApplicationBlackboxConfigure,
  runSlipwayApplicationDelete,
  runSlipwayApplicationDeploymentImport,
  runSlipwayApplicationImport,
  runSlipwayApplicationList,
  runSlipwayApplicationLockboxDispatch,
  runSlipwayApplicationLockboxGrantEnsure,
  runSlipwayApplicationLockboxGrantStatus,
  runSlipwayApplicationLockboxGrantVerify,
  runSlipwayApplicationLockboxSetupPr,
  runSlipwayApplicationPlans,
  runSlipwayApplicationStatus,
  runSlipwayApplicationStatusTransition,
  runSlipwayCustodyAccountEnsure,
  runSlipwayCustodyChildRecover,
  runSlipwayCustodyEnvironmentUpload,
  runSlipwayCustodyExecutionDiagnose,
  runSlipwayCustodyExecutionList,
  runSlipwayCustodyExecutionObserve,
  runSlipwayCustodyExecutionRecover,
  runSlipwayCustodyExecutionSubmit,
  runSlipwayCustodyMachineCatalog,
  runSlipwayCustodyPreflight,
  runSlipwayLogin,
  runSlipwayLogout,
  runSlipwayWhoami,
  saveSlipwaySession
} from "../src/index.js";

describe("proof-cli Slipway runner", () => {
  it("reads a saved session through /api/session without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile, nowMs: () => 123 });
    assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);

    const requests: Array<{ url: string; authorization?: string }> = [];
    const out = writer();
    const code = await runSlipwayWhoami({
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization
        });
        return jsonResponse({
          ok: true,
          session: {
            sessionId: "session-1",
            address: "github:12345",
            identity: {
              kind: "github_app",
              githubUserId: "12345",
              login: "octo-agent",
              repositories: ["proof-computer/example"]
            },
            createdAtMs: 100,
            expiresAtMs: 200
          }
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/session",
      authorization: `Bearer ${token}`
    }]);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as {
      ok: boolean;
      slipwayUrl: string;
      session: { identity: { login: string } };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.slipwayUrl, "https://slipway.test");
    assert.equal(parsed.session.identity.login, "octo-agent");

    const saved = await readFile(sessionFile, "utf8");
    assert.equal(saved.includes(token), true);
    assert.equal(saved.includes("octo-agent"), true);
  });

  it("lists Applications with the stored session bearer without printing it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_list_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; authorization?: string }> = [];
    const out = writer();
    const code = await runSlipwayApplicationList({
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization
        });
        return jsonResponse({
          ok: true,
          count: 2,
          applications: [{
            applicationUid: "app-1111111111111111",
            applicationName: "alpha",
            applicationId: "alpha",
            ownerAddress: "5owner-alpha",
            status: "active",
            replicas: 1,
            source: { repository: "proof-computer/alpha" },
            artifact: { status: "ready" },
            duplicateLegacyId: true
          }, {
            applicationUid: "app-2222222222222222",
            applicationName: "beta",
            applicationId: "beta",
            ownerAddress: "5owner-beta",
            status: "draft",
            replicas: 0,
            source: { repository: "proof-computer/beta" },
            artifact: { status: "missing" },
            deletedAtMs: 123,
            deletedBy: "5owner-beta",
            deleteReason: "test cleanup"
          }]
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications",
      authorization: `Bearer ${token}`
    }]);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as {
      ok: boolean;
      count: number;
      applications: Array<{ applicationUid: string; applicationName: string; applicationId: string; ownerAddress: string; artifact: { status: string }; duplicateLegacyId?: boolean; deletedAtMs?: number; deleteReason?: string }>;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.count, 2);
    assert.equal(parsed.applications[0]?.applicationUid, "app-1111111111111111");
    assert.equal(parsed.applications[0]?.applicationName, "alpha");
    assert.equal(parsed.applications[0]?.applicationId, "alpha");
    assert.equal(parsed.applications[0]?.ownerAddress, "5owner-alpha");
    assert.equal(parsed.applications[0]?.duplicateLegacyId, true);
    assert.equal(parsed.applications[1]?.artifact.status, "missing");
    assert.equal(parsed.applications[1]?.deletedAtMs, 123);
    assert.equal(parsed.applications[1]?.deleteReason, "test cleanup");
  });

  it("dry-runs Application identity backfill with the stored session bearer without printing it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_backfill_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayApplicationBackfillIdentities({
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          ok: true,
          dryRun: true,
          changed: true,
          scanned: 1,
          changedCount: 1,
          changes: [{
            ownerAddress: "5owner",
            applicationId: "alpha",
            applicationUid: "app-1111111111111111",
            applicationName: "alpha",
            reasons: ["missing_applicationUid", "missing_applicationName"]
          }]
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/backfill-identities",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { confirm: false }
    }]);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; dryRun: boolean; changes: Array<{ applicationUid: string; applicationName: string }> };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.changes[0]?.applicationUid, "app-1111111111111111");
    assert.equal(parsed.changes[0]?.applicationName, "alpha");
  });

  it("dry-runs Application delete with the stored session bearer without printing it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_delete_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayApplicationDelete({
      applicationRef: "alpha",
      owner: "5owner",
      reason: "cleanup",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          ok: true,
          dryRun: true,
          deleted: false,
          force: false,
          application: {
            applicationUid: "app-1111111111111111",
            applicationName: "alpha",
            applicationId: "legacy-alpha",
            ownerAddress: "5owner",
            status: "active"
          },
          blockers: [{
            code: "application_active",
            message: "Application status is active"
          }]
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha?owner=5owner",
      method: "DELETE",
      authorization: `Bearer ${token}`,
      body: {
        confirm: false,
        force: false,
        reason: "cleanup"
      }
    }]);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; dryRun: boolean; application: { applicationUid: string; applicationName: string }; blockers: Array<{ code: string }> };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.application.applicationUid, "app-1111111111111111");
    assert.equal(parsed.application.applicationName, "alpha");
    assert.equal(parsed.blockers[0]?.code, "application_active");
  });

  it("renders ambiguous Application delete candidates without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_ambiguous_delete_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayApplicationDelete({
      applicationRef: "shared",
      config: sessionFile
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          ok: false,
          error: "ambiguous_application",
          reason: "Legacy applicationId shared is ambiguous",
          candidates: [{
            applicationUid: "app-1111111111111111",
            applicationName: "shared-a",
            applicationId: "shared",
            ownerAddress: "5owner-a",
            status: "disabled",
            repository: "proof-computer/shared"
          }, {
            applicationUid: "app-2222222222222222",
            applicationName: "shared-b",
            applicationId: "shared",
            ownerAddress: "5owner-b",
            status: "disabled",
            repository: "proof-computer/shared"
          }]
        }, 409);
      },
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/shared",
      method: "DELETE",
      authorization: `Bearer ${token}`,
      body: {
        confirm: false,
        force: false
      }
    }]);
    assert.equal(out.text.includes(token), false);
    assert.match(out.text, /SLIPWAY_APPLICATION_AMBIGUOUS/u);
    assert.match(out.text, /shared-a \(legacy shared\)/u);
    assert.match(out.text, /owner 5owner-a/u);
    assert.match(out.text, /Use an Application uid\/name/u);
  });

  it("pauses and resumes Applications through the status endpoint without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_status_transition_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const options = {
      fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { status?: string; confirm?: boolean; reason?: string };
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body
        });
        return jsonResponse({
          ok: true,
          dryRun: body.confirm !== true,
          changed: true,
          previousStatus: body.status === "paused" ? "active" : "paused",
          status: body.status,
          application: {
            applicationUid: "app-1111111111111111",
            applicationName: "alpha",
            applicationId: "legacy-alpha",
            ownerAddress: "5owner",
            status: body.status,
            pausedBy: body.status === "paused" ? "github:12345" : undefined,
            pauseReason: body.status === "paused" ? body.reason : undefined,
            resumedBy: body.status === "active" ? "github:12345" : undefined,
            resumeReason: body.status === "active" ? body.reason : undefined
          }
        });
      },
      stdout: out.write
    };

    const pauseCode = await runSlipwayApplicationStatusTransition({
      applicationRef: "alpha",
      owner: "5owner",
      status: "paused",
      reason: "funding pending",
      config: sessionFile,
      json: true
    }, options);
    const resumeCode = await runSlipwayApplicationStatusTransition({
      applicationRef: "alpha",
      status: "active",
      reason: "funded",
      yes: true,
      config: sessionFile,
      json: true
    }, options);

    assert.equal(pauseCode, 0);
    assert.equal(resumeCode, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/status?owner=5owner",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {
        status: "paused",
        confirm: false,
        reason: "funding pending"
      }
    }, {
      url: "https://slipway.test/api/applications/alpha/status",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {
        status: "active",
        confirm: true,
        reason: "funded"
      }
    }]);
    assert.equal(out.text.includes(token), false);
    const outputs = out.text.trim().split(/\n(?=\{)/u).map((line) => JSON.parse(line) as { ok: boolean; status: string; dryRun: boolean; application: { pauseReason?: string; resumeReason?: string } });
    assert.equal(outputs[0]?.ok, true);
    assert.equal(outputs[0]?.status, "paused");
    assert.equal(outputs[0]?.dryRun, true);
    assert.equal(outputs[0]?.application.pauseReason, "funding pending");
    assert.equal(outputs[1]?.status, "active");
    assert.equal(outputs[1]?.dryRun, false);
    assert.equal(outputs[1]?.application.resumeReason, "funded");
  });

  it("reads Application status with the stored session bearer without printing it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_status_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; authorization?: string }> = [];
    const out = writer();
    const code = await runSlipwayApplicationStatus({
      applicationId: "alpha",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization
        });
        return jsonResponse({
          ok: true,
          application: {
            applicationId: "alpha",
            status: "active",
            replicas: 2,
            source: { repository: "proof-computer/alpha" }
          },
          activePolicy: { policyVersionId: "alpha-v2", status: "active" },
          desired: { replicas: 2 },
          observed: { activeReplicas: 1, scheduledReplicas: 0, missingReplicas: 1 }
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha",
      authorization: `Bearer ${token}`
    }]);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as {
      ok: boolean;
      application: { applicationId: string; status: string };
      observed: { missingReplicas: number };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.application.applicationId, "alpha");
    assert.equal(parsed.application.status, "active");
    assert.equal(parsed.observed.missingReplicas, 1);
  });

  it("reads Application plans with the stored session bearer without printing it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_plans_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; authorization?: string }> = [];
    const out = writer();
    const code = await runSlipwayApplicationPlans({
      applicationId: "alpha",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization
        });
        return jsonResponse({
          ok: true,
          count: 1,
          plans: [{
            planId: "alpha-r0",
            planKind: "launch_initial_child",
            applicationId: "alpha",
            role: "web",
            replicaIndex: 0,
            policyDigest: "abc123"
          }]
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/plans",
      authorization: `Bearer ${token}`
    }]);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; count: number; plans: Array<{ planKind: string; role: string }> };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.plans[0]?.planKind, "launch_initial_child");
    assert.equal(parsed.plans[0]?.role, "web");
  });

  it("reads Application Lockbox grant status with the stored session bearer without printing it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_lockbox_status_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; authorization?: string }> = [];
    const out = writer();
    const code = await runSlipwayApplicationLockboxGrantStatus({
      applicationId: "alpha",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization
        });
        return jsonResponse({
          ok: true,
          applicationId: "alpha",
          count: 1,
          statuses: [{
            grant: {
              grantId: "lockbox-job-grant:alpha-r0",
              status: "active"
            },
            requests: {
              acceptedCount: 2,
              rejectedCount: 0,
              pendingCount: 1
            }
          }]
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/lockbox/grant-status",
      authorization: `Bearer ${token}`
    }]);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as {
      ok: boolean;
      applicationId: string;
      count: number;
      statuses: Array<{ requests: { acceptedCount: number } }>;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.applicationId, "alpha");
    assert.equal(parsed.count, 1);
    assert.equal(parsed.statuses[0]?.requests.acceptedCount, 2);
  });

  it("runs Application mutation commands through confirmed Slipway API requests", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_application_mutation_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const cases = [
      {
        name: "deployment import",
        run: () => runSlipwayApplicationDeploymentImport({
          applicationRef: "alpha",
          sequence: 77,
          origin: "5origin",
          deploymentId: "deploy-77",
          replicaIndex: 1,
          processor: "processor-1",
          gatewayId: "gateway-1",
          endpointHostname: "alpha.example.test",
          config: sessionFile,
          json: true,
          yes: true
        }, sharedOptions()),
        expected: {
          url: "https://slipway.test/api/applications/alpha/deployments/imports",
          method: "POST",
          body: {
            acurastJobRef: {
              origin: { acurast: "5origin" },
              sequence: 77,
              canonicalJobId: JSON.stringify([{ acurast: "5origin" }, 77])
            },
            deploymentId: "deploy-77",
            replicaIndex: 1,
            processorId: "processor-1",
            gatewayId: "gateway-1",
            endpointHostname: "alpha.example.test"
          }
        }
      },
      {
        name: "lockbox setup PR",
        run: () => runSlipwayApplicationLockboxSetupPr({
          applicationRef: "alpha",
          baseRef: "main",
          config: sessionFile,
          json: true,
          yes: true
        }, sharedOptions()),
        expected: {
          url: "https://slipway.test/api/applications/alpha/lockbox/workflow-pr",
          method: "POST",
          body: { baseRef: "main" }
        }
      },
      {
        name: "lockbox dispatch",
        run: () => runSlipwayApplicationLockboxDispatch({
          applicationRef: "alpha",
          ref: "refs/heads/main",
          config: sessionFile,
          json: true,
          yes: true
        }, sharedOptions()),
        expected: {
          url: "https://slipway.test/api/applications/alpha/lockbox/workflow-dispatch",
          method: "POST",
          body: { ref: "refs/heads/main" }
        }
      },
      {
        name: "lockbox grant ensure",
        run: () => runSlipwayApplicationLockboxGrantEnsure({
          applicationRef: "alpha",
          config: sessionFile,
          json: true,
          yes: true
        }, sharedOptions()),
        expected: {
          url: "https://slipway.test/api/applications/alpha/lockbox/grants",
          method: "POST",
          body: {}
        }
      },
      {
        name: "lockbox grant verify",
        run: () => runSlipwayApplicationLockboxGrantVerify({
          applicationRef: "alpha",
          grantId: "grant-1",
          config: sessionFile,
          json: true,
          yes: true
        }, sharedOptions()),
        expected: {
          url: "https://slipway.test/api/applications/alpha/lockbox/grants/grant-1/verify",
          method: "POST",
          body: {}
        }
      },
      {
        name: "blackbox configure",
        run: () => runSlipwayApplicationBlackboxConfigure({
          applicationRef: "alpha",
          config: sessionFile,
          json: true,
          yes: true
        }, sharedOptions()),
        expected: {
          url: "https://slipway.test/api/applications/alpha/blackbox/configurations",
          method: "POST",
          body: {}
        }
      }
    ];

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    function sharedOptions() {
      return {
        fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
          requests.push({
            url: String(url),
            method: init?.method,
            authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
            body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
          });
          return jsonResponse({ ok: true, child: { childSessionId: "child-1" }, grant: { grantId: "grant-1" }, configuration: { configurationId: "blackbox-1" } });
        },
        stdout: out.write
      };
    }

    for (const item of cases) {
      const code = await item.run();
      assert.equal(code, 0, item.name);
    }

    assert.deepEqual(requests, cases.map((item) => ({
      ...item.expected,
      authorization: `Bearer ${token}`
    })));
    assert.equal(out.text.includes(token), false);
  });

  it("fails mutating Application commands before network I/O without --yes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "slipway_no_yes_token",
      savedAtMs: 0
    }, { config: sessionFile });
    const out = writer();
    const options = {
      fetchImpl: async () => {
        throw new Error("network should not be called");
      },
      stdout: out.write
    };
    const commands = [
      runSlipwayApplicationDeploymentImport({ applicationRef: "alpha", sequence: 1, origin: "5origin", config: sessionFile, json: true }, options),
      runSlipwayApplicationLockboxSetupPr({ applicationRef: "alpha", config: sessionFile, json: true }, options),
      runSlipwayApplicationLockboxDispatch({ applicationRef: "alpha", config: sessionFile, json: true }, options),
      runSlipwayApplicationLockboxGrantEnsure({ applicationRef: "alpha", config: sessionFile, json: true }, options),
      runSlipwayApplicationLockboxGrantVerify({ applicationRef: "alpha", grantId: "grant-1", config: sessionFile, json: true }, options),
      runSlipwayApplicationBlackboxConfigure({ applicationRef: "alpha", config: sessionFile, json: true }, options)
    ];
    const codes = await Promise.all(commands);
    assert.deepEqual(codes, [1, 1, 1, 1, 1, 1]);
    assert.match(out.text, /CONFIRMATION_REQUIRED/u);
  });

  it("runs live custody commands through saved bearer sessions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_custody_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const options = {
      fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        });
        return jsonResponse({
          ok: true,
          account: { accountRef: "live-custody:acurast:test", chain: "acurast", address: "5hot" },
          attempts: [{ executionId: "exec-1", status: "submitted" }],
          attempt: { executionId: "exec-1", status: "observed" },
          child: { childSessionId: "child-1", status: "proposal_expired" },
          actionPlan: { count: 1, items: [{ planItemId: "plan-1" }] },
          classification: "verified_ready",
          classes: [{ class: "phone-v1" }]
        });
      },
      stdout: out.write
    };

    assert.equal(await runSlipwayCustodyAccountEnsure({ applicationRef: "alpha", chain: "acurast", config: sessionFile, json: true, yes: true }, options), 0);
    assert.equal(await runSlipwayCustodyPreflight({ applicationRef: "alpha", config: sessionFile, json: true }, options), 0);
    assert.equal(await runSlipwayCustodyExecutionList({ applicationRef: "alpha", config: sessionFile, json: true }, options), 0);
    assert.equal(await runSlipwayCustodyExecutionObserve({ applicationRef: "alpha", executionId: "exec-1", config: sessionFile, json: true }, options), 0);
    assert.equal(await runSlipwayCustodyExecutionDiagnose({ applicationRef: "alpha", executionId: "exec-1", network: "testnet", config: sessionFile, json: true }, options), 0);
    assert.equal(await runSlipwayCustodyExecutionRecover({ applicationRef: "alpha", executionId: "exec-1", reason: "operator reviewed", config: sessionFile, json: true, yes: true }, options), 0);
    assert.equal(await runSlipwayCustodyChildRecover({ applicationRef: "alpha", childSessionId: "child-1", reason: "operator reviewed", config: sessionFile, json: true, yes: true }, options), 0);
    assert.equal(await runSlipwayCustodyMachineCatalog({ network: "testnet", config: sessionFile, json: true }, options), 0);

    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/live-custody/account",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { chain: "acurast" }
    }, {
      url: "https://slipway.test/api/applications/alpha/live-custody/preflight",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
    }, {
      url: "https://slipway.test/api/applications/alpha/live-custody/executions",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
    }, {
      url: "https://slipway.test/api/applications/alpha/live-custody/executions/exec-1/observe",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {}
    }, {
      url: "https://slipway.test/api/applications/alpha/live-custody/executions/exec-1/diagnosis?network=canary",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
    }, {
      url: "https://slipway.test/api/applications/alpha/live-custody/executions/exec-1/recover",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { yesRecover: true, acknowledgement: "operator-reviewed", reason: "operator reviewed" }
    }, {
      url: "https://slipway.test/api/applications/alpha/live-custody/child-sessions/child-1/recover",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { yesRecover: true, acknowledgement: "operator-reviewed", reason: "operator reviewed" }
    }, {
      url: "https://slipway.test/api/live-custody/machine-catalog?network=canary",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
    }]);
    assert.equal(out.text.includes(token), false);
  });

  it("fails spend and custody mutation commands before network I/O without confirmations", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "slipway_custody_no_yes_token",
      savedAtMs: 0
    }, { config: sessionFile });
    const out = writer();
    const options = {
      fetchImpl: async () => {
        throw new Error("network should not be called");
      },
      stdout: out.write
    };
    assert.equal(await runSlipwayCustodyAccountEnsure({ applicationRef: "alpha", chain: "acurast", config: sessionFile, json: true }, options), 1);
    assert.equal(await runSlipwayCustodyExecutionSubmit({
      applicationRef: "alpha",
      planItemId: "plan-1",
      idempotencyKey: "key-1",
      config: sessionFile,
      json: true,
      yes: true
    }, options), 1);
    assert.equal(await runSlipwayCustodyExecutionRecover({ applicationRef: "alpha", executionId: "exec-1", reason: "review", config: sessionFile, json: true }, options), 1);
    assert.equal(await runSlipwayCustodyChildRecover({ applicationRef: "alpha", childSessionId: "child-1", reason: "review", config: sessionFile, json: true }, options), 1);
    assert.match(out.text, /--yes/u);
    assert.match(out.text, /--yes-spend/u);
  });

  it("builds encrypted environment handoffs without printing local secret values", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const secretsFile = path.join(dir, ".env");
    const token = "slipway_environment_secret_token_do_not_print";
    const secretValue = "local-secret-value-do-not-print";
    await writeFile(secretsFile, `SECRET_VALUE=${secretValue}\n`, "utf8");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const handoff = encryptedHandoff();
    const options = {
      environmentHandoffBuilder: async (input) => {
        assert.equal(input.action.actionId, "set-env-1");
        assert.deepEqual(input.variables, [{ key: "SECRET_VALUE", value: secretValue }]);
        return handoff;
      },
      fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        });
        if (String(url).endsWith("/api/applications/alpha/action-plan")) {
          return jsonResponse({ ok: true, items: [setEnvironmentPlanItem()] });
        }
        if (String(url).endsWith("/api/applications/alpha")) {
          return jsonResponse({
            ok: true,
            application: { applicationId: "alpha", status: "active" },
            activePolicy: {
              policyDigest: "policy-digest-1",
              environment: {
                variables: [{ name: "SECRET_VALUE", source: "secret", required: true }]
              }
            }
          });
        }
        return jsonResponse({ ok: true, handoff: { handoffKey: "handoff-1" } });
      },
      stdout: out.write
    };

    const code = await runSlipwayCustodyEnvironmentUpload({
      applicationRef: "alpha",
      secretsFile,
      config: sessionFile,
      json: true,
      yes: true
    }, options);

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`), [
      "GET /api/applications/alpha/action-plan",
      "GET /api/applications/alpha",
      "POST /api/applications/alpha/live-custody/environment-handoffs"
    ]);
    assert.equal(requests[2]?.authorization, `Bearer ${token}`);
    assert.deepEqual(requests[2]?.body, { environmentHandoff: handoff });
    assert.equal(out.text.includes(token), false);
    assert.equal(out.text.includes(secretValue), false);
  });

  it("submits execution plans with encrypted environment handoffs and spend confirmation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const secretsFile = path.join(dir, ".env");
    const token = "slipway_submit_secret_token_do_not_print";
    const secretValue = "submit-secret-value-do-not-print";
    await writeFile(secretsFile, `SECRET_VALUE=${secretValue}\n`, "utf8");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const handoff = encryptedHandoff();
    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayCustodyExecutionSubmit({
      applicationRef: "alpha",
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      secretsFile,
      config: sessionFile,
      json: true,
      yes: true,
      yesSpend: true
    }, {
      environmentHandoffBuilder: async (input) => {
        assert.equal(input.action.actionId, "set-env-1");
        assert.deepEqual(input.variables, [{ key: "SECRET_VALUE", value: secretValue }]);
        return handoff;
      },
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        });
        if (String(url).endsWith("/api/applications/alpha/action-plan")) {
          return jsonResponse({ ok: true, items: [setEnvironmentPlanItem()] });
        }
        if (String(url).endsWith("/api/applications/alpha")) {
          return jsonResponse({
            ok: true,
            application: { applicationId: "alpha", status: "active" },
            activePolicy: {
              policyDigest: "policy-digest-1",
              environment: {
                variables: [{ name: "SECRET_VALUE", source: "secret", required: true }]
              }
            }
          });
        }
        return jsonResponse({ ok: true, attempt: { executionId: "exec-1", status: "submitted" } });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`), [
      "GET /api/applications/alpha/action-plan",
      "GET /api/applications/alpha",
      "POST /api/applications/alpha/live-custody/executions"
    ]);
    assert.deepEqual(requests[2]?.body, {
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      yesSpend: true,
      acknowledgement: "yes-spend",
      environmentHandoff: handoff
    });
    assert.equal(requests[2]?.authorization, `Bearer ${token}`);
    assert.equal(out.text.includes(token), false);
    assert.equal(out.text.includes(secretValue), false);
  });

  it("imports a GitHub Application policy through server fetch without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_import_github_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayApplicationImport({
      github: "proof-computer/alpha:.slipway/application-policy.json@main",
      serverFetch: true,
      publish: true,
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          ok: true,
          count: 1,
          applicationCount: 1,
          serviceCount: 0,
          source: {
            kind: "github",
            repository: "proof-computer/alpha",
            ref: "main",
            path: ".slipway/application-policy.json",
            commitSha: "a".repeat(40)
          },
          policies: [{ applicationId: "alpha", policyVersionId: "alpha-v1" }]
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://slipway.test/api/applications/imports");
    assert.equal(requests[0]?.authorization, `Bearer ${token}`);
    assert.deepEqual(requests[0]?.body, {
      source: {
        kind: "github",
        repository: "proof-computer/alpha",
        ref: "main",
        path: ".slipway/application-policy.json"
      },
      publish: true
    });
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; applicationCount: number; policies: Array<{ applicationId: string }> };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.applicationCount, 1);
    assert.equal(parsed.policies[0]?.applicationId, "alpha");
  });

  it("imports a local Application policy file without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const policyFile = path.join(dir, "application-policy.json");
    const token = "slipway_import_file_secret_token_do_not_print";
    const document = {
      domain: "proof.slipway.application-policy.v3",
      applicationId: "alpha",
      replicas: 1
    };
    await writeFile(policyFile, `${JSON.stringify(document)}\n`, "utf8");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayApplicationImport({
      file: policyFile,
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          ok: true,
          count: 1,
          applicationCount: 1,
          serviceCount: 0,
          applications: [{ applicationId: "alpha" }]
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.equal(requests[0]?.url, "https://slipway.test/api/applications/imports");
    assert.equal(requests[0]?.authorization, `Bearer ${token}`);
    assert.deepEqual(requests[0]?.body, {
      document,
      source: { kind: "upload", filename: "application-policy.json" },
      publish: false
    });
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; count: number };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.count, 1);
  });

  it("can client-fetch a public GitHub Application policy before import", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_import_client_github_secret_token_do_not_print";
    const document = {
      domain: "proof.slipway.application-policy.v3",
      applicationId: "alpha",
      replicas: 1
    };
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayApplicationImport({
      github: "proof-computer/alpha:.slipway/application-policy.json@main",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        });
        if (String(url) === "https://raw.githubusercontent.com/proof-computer/alpha/main/.slipway/application-policy.json") {
          return jsonResponse(document);
        }
        return jsonResponse({
          ok: true,
          count: 1,
          applicationCount: 1,
          serviceCount: 0
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.equal(requests[0]?.url, "https://raw.githubusercontent.com/proof-computer/alpha/main/.slipway/application-policy.json");
    assert.equal(requests[0]?.authorization, undefined);
    assert.equal(requests[1]?.url, "https://slipway.test/api/applications/imports");
    assert.equal(requests[1]?.authorization, `Bearer ${token}`);
    assert.deepEqual(requests[1]?.body, {
      document,
      source: {
        kind: "github",
        repository: "proof-computer/alpha",
        ref: "main",
        path: ".slipway/application-policy.json"
      },
      publish: false
    });
    assert.equal(out.text.includes(token), false);
  });

  it("removes the local session on logout without echoing token material", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_logout_secret_token";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test/",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const out = writer();
    const code = await runSlipwayLogout({ config: sessionFile, json: true }, { stdout: out.write });
    assert.equal(code, 0);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; loggedOut: boolean; slipwayUrl: string };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.loggedOut, true);
    assert.equal(parsed.slipwayUrl, "https://slipway.test");
    await assert.rejects(() => stat(sessionFile), /ENOENT/u);
  });

  it("logs in through pending CLI login without printing token material", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const stdout = writer();
    const stderr = writer();
    const requests: Array<{ url: string; body?: unknown }> = [];
    const code = await runSlipwayLogin({
      slipwayUrl: "https://slipway.test",
      config: sessionFile,
      noBrowser: true,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        requests.push({ url: String(url), body });
        if (String(url) === "https://slipway.test/api/cli-login/pending") {
          assert.equal(typeof body?.tokenHash, "string");
          assert.equal(typeof body?.pendingSecretHash, "string");
          assert.match(String(body?.tokenHash), /^[a-f0-9]{64}$/u);
          assert.match(String(body?.pendingSecretHash), /^[a-f0-9]{64}$/u);
          return jsonResponse({
            ok: true,
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "pending",
              expiresAtMs: 10_000,
              pollIntervalMs: 100
            },
            verificationUri: "/cli-login.html?pendingLoginId=0123456789abcdef0123456789abcdef&userCode=ABCD-2345",
            verificationUriComplete: "/cli-login.html?pendingLoginId=0123456789abcdef0123456789abcdef&userCode=ABCD-2345"
          });
        }
        if (String(url) === "https://slipway.test/api/cli-login/0123456789abcdef0123456789abcdef/poll") {
          assert.equal(typeof body?.pendingSecret, "string");
          const createBody = requests[0]?.body as Record<string, unknown>;
          assert.equal(sha256(String(body?.pendingSecret)), createBody.pendingSecretHash);
          return jsonResponse({
            ok: true,
            status: "authorized",
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "authorized"
            },
            session: {
              sessionId: "session-1",
              address: "github:12345",
              identity: {
                kind: "github_app",
                githubUserId: "12345",
                login: "octo-agent",
                repositories: ["proof-computer/example"]
              },
              createdAtMs: 100,
              expiresAtMs: 200
            }
          });
        }
        return jsonResponse({ ok: false, error: "unexpected_request" }, 404);
      },
      nowMs: () => 1_000,
      stderr: stderr.write,
      stdout: stdout.write
    });
    assert.equal(code, 0);
    const saved = JSON.parse(await readFile(sessionFile, "utf8")) as { sessionToken: string; session: { identity: { login: string } } };
    const createBody = requests[0]?.body as Record<string, unknown>;
    assert.equal(sha256(saved.sessionToken), createBody.tokenHash);
    assert.equal(saved.session.identity.login, "octo-agent");
    assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);
    assert.equal(stdout.text.includes(saved.sessionToken), false);
    assert.equal(stderr.text.includes(saved.sessionToken), false);
    assert.match(stderr.text, /https:\/\/slipway\.test\/cli-login\.html/u);
    const parsed = JSON.parse(stdout.text) as { ok: boolean; status: string; session: { identity: { login: string } } };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, "authorized");
    assert.equal(parsed.session.identity.login, "octo-agent");
  });

  it("times out when browser authorization does not complete", async () => {
    const out = writer();
    const err = writer();
    const code = await runSlipwayLogin({
      slipwayUrl: "https://slipway.test",
      config: path.join(await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-")), "session.json"),
      noBrowser: true,
      json: true,
      timeoutMs: 1
    }, {
      fetchImpl: async (url) => {
        if (String(url) === "https://slipway.test/api/cli-login/pending") {
          return jsonResponse({
            ok: true,
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "pending",
              expiresAtMs: 1_001,
              pollIntervalMs: 100
            },
            verificationUri: "/cli-login.html?pendingLoginId=0123456789abcdef0123456789abcdef&userCode=ABCD-2345"
          });
        }
        return jsonResponse({
          ok: true,
          status: "pending",
          cliLogin: {
            pendingLoginId: "0123456789abcdef0123456789abcdef",
            userCode: "ABCD-2345",
            status: "pending"
          }
        });
      },
      nowMs: (() => {
        let now = 1_000;
        return () => {
          now += 2;
          return now;
        };
      })(),
      sleepMs: async () => {},
      stderr: err.write,
      stdout: out.write
    });
    assert.equal(code, 1);
    const parsed = JSON.parse(out.text) as { ok: boolean; error: string; slipwayUrl: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_CLI_LOGIN_TIMEOUT");
    assert.equal(parsed.slipwayUrl, "https://slipway.test");
  });
});

function writer(): { text: string; write: (line: string) => void } {
  const output = {
    text: "",
    write(line: string): void {
      output.text += `${line}\n`;
    }
  };
  return output;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function setEnvironmentPlanItem(): Record<string, unknown> {
  const origin = { acurast: "5origin" };
  return {
    planItemId: "set-env-1",
    kind: "acurast.setEnvironment",
    applicationId: "alpha",
    policyDigest: "policy-digest-1",
    callSummary: {
      applicationId: "alpha",
      serviceId: "web",
      role: "web",
      policyDigest: "policy-digest-1",
      childSessionId: "child-1",
      jobId: "job-1",
      deploymentId: "deployment-1",
      acurastJobRef: {
        origin,
        sequence: 1,
        canonicalJobId: JSON.stringify([origin, 1])
      },
      expectedProcessors: ["processor-1"],
      envNames: ["SECRET_VALUE"],
      variables: [{ name: "SECRET_VALUE", source: "secret", required: true }]
    }
  };
}

function encryptedHandoff(): Record<string, unknown> {
  const origin = { acurast: "5origin" };
  return {
    domain: "proof.slipway.acurast-environment-handoff.v1",
    actionId: "set-env-1",
    applicationId: "alpha",
    policyDigest: "policy-digest-1",
    childSessionId: "child-1",
    jobId: "job-1",
    deploymentId: "deployment-1",
    acurastJobRef: {
      origin,
      sequence: 1,
      canonicalJobId: JSON.stringify([origin, 1])
    },
    envNames: ["SECRET_VALUE"],
    assignments: [{
      processor: "processor-1",
      publicKey: "client-public-key",
      variables: [{
        key: "SECRET_VALUE",
        encryptedValue: {
          iv: "iv",
          ciphertext: "ciphertext",
          authTag: "auth-tag"
        }
      }]
    }]
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
