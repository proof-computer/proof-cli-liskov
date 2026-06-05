import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  runSlipwayApplicationBackfillIdentities,
  runSlipwayApplicationDelete,
  runSlipwayApplicationImport,
  runSlipwayApplicationList,
  runSlipwayApplicationLockboxGrantStatus,
  runSlipwayApplicationPlans,
  runSlipwayApplicationStatus,
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
