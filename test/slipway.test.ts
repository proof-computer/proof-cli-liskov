import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  runSlipwayApplicationBackfillIdentities,
  runSlipwayApplicationBlackboxConfigure,
  runSlipwayApplicationActivity,
  runSlipwayApplicationActionPlanRetry,
  runSlipwayApplicationDelete,
  runSlipwayApplicationDeploymentImport,
  runSlipwayApplicationDeploymentStatus,
  runSlipwayApplicationImport,
  runSlipwayApplicationList,
  runSlipwayApplicationLockboxDispatch,
  runSlipwayApplicationLockboxGrantEnsure,
  runSlipwayApplicationLockboxGrantStatus,
  runSlipwayApplicationLockboxGrantVerify,
  runSlipwayApplicationLockboxSetupPr,
  runSlipwayApplicationPlans,
  runSlipwayApplicationPublish,
  runSlipwayApplicationDevtoolsViewKey,
  runSlipwayApplicationRename,
  runSlipwayApplicationRuntimeImageWorkflow,
  runSlipwayApplicationSetRepository,
  runSlipwayApplicationStatus,
  runSlipwayApplicationStatusTransition,
  runSlipwayCustodyAccountEnsure,
  runSlipwayCustodyEnvironmentUpload,
  runSlipwayCustodyExecutionDiagnose,
  runSlipwayCustodyExecutionList,
  runSlipwayCustodyExecutionObserve,
  runSlipwayCustodyExecutionRecover,
  runSlipwayCustodyExecutionRetry,
  runSlipwayCustodyExecutionRunOne,
  runSlipwayCustodyExecutionSubmit,
  runSlipwayCustodyMachineCatalog,
  runSlipwayCustodyPair,
  runSlipwayCustodyPreflight,
  runSlipwayLogin,
  runSlipwayLogout,
  runSlipwayWhoami,
  saveSlipwaySession
} from "../src/index.js";

describe("proof-cli Liskov runner", () => {
  it("writes a runtime-image upload workflow without emitting credentials", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const output = path.join(dir, ".github", "workflows", "liskov-runtime-image.yml");
    const out = writer();
    const code = await runSlipwayApplicationRuntimeImageWorkflow({
      applicationRef: "proof-docs",
      json: true,
      liskovUrl: "https://liskov.test",
      oidcAudience: "liskov-runtime-image-upload",
      output,
      workflowName: "Upload Runtime"
    }, { stdout: out.write });

    assert.equal(code, 0);
    const parsed = JSON.parse(out.text) as {
      ok: boolean;
      applicationRef: string;
      output: string;
      liskovUrl: string;
      oidcAudience: string;
      policyWorkflowRefHint: string;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.applicationRef, "proof-docs");
    assert.equal(parsed.output, output);
    assert.equal(parsed.liskovUrl, "https://liskov.test");
    assert.equal(parsed.oidcAudience, "liskov-runtime-image-upload");
    assert.match(parsed.policyWorkflowRefHint, /\.github\/workflows\/liskov-runtime-image\.yml@refs\/heads\/<branch>/u);
    assert.equal(out.text.includes("secretAccessKey"), false);
    assert.equal(out.text.includes("AWS_SECRET_ACCESS_KEY"), false);

    const workflow = await readFile(output, "utf8");
    assert.match(workflow, /^name: 'Upload Runtime'$/mu);
    assert.match(workflow, /^"on":$/mu);
    assert.match(workflow, /description: 'Optional sha256 digest, with or without sha256: prefix'/u);
    assert.match(workflow, /id-token: write/u);
    assert.match(workflow, /LISKOV_URL: 'https:\/\/liskov\.test'/u);
    assert.match(workflow, /LISKOV_APPLICATION_REF: 'proof-docs'/u);
    assert.match(workflow, /runtime-images\/upload-session/u);
    assert.match(workflow, /runtime-images\/upload-sessions\/\$\{session_path\}\/finalize/u);
    assert.match(workflow, /aws s3api put-object/u);
    assert.match(workflow, /::add-mask::/u);
    assert.doesNotMatch(workflow, /^const fs = require/m);
    assert.doesNotMatch(workflow, /\$GITHUB_ENV/u);
    assert.doesNotMatch(workflow, /steps\.[^.]+\.outputs\.token/u);
    assert.doesNotMatch(workflow, /set -x/u);
    assert.doesNotMatch(workflow, /secret-once|do_not_print/u);
    await assertWorkflowRunBlocksAreBashSyntax(workflow, dir);
  });

  it("does not overwrite an existing runtime-image workflow without --yes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const output = path.join(dir, "runtime-image.yml");
    await writeFile(output, "existing workflow\n", "utf8");
    const out = writer();
    const code = await runSlipwayApplicationRuntimeImageWorkflow({
      applicationRef: "proof-docs",
      json: true,
      output
    }, { stdout: out.write });

    assert.equal(code, 1);
    assert.equal(await readFile(output, "utf8"), "existing workflow\n");
    const parsed = JSON.parse(out.text) as { ok: boolean; error: string; output: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_RUNTIME_IMAGE_WORKFLOW_EXISTS");
    assert.equal(parsed.output, output);
  });

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
    // Label is the slug only — the internal applicationId codename is no longer surfaced.
    assert.match(out.text, /shared-a \(owner 5owner-a/u);
    assert.doesNotMatch(out.text, /legacy shared/u);
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
      overrideReplacementHold: true,
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
        reason: "funded",
        overrideReplacementHold: true
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

  it("dry-runs and confirms an Application repository change without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_set_repository_secret_token_do_not_print";
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
        const body = JSON.parse(String(init?.body ?? "{}")) as { repository?: string; workflowRef?: string; confirm?: boolean };
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
          from: {
            repository: "proof-computer/slipway-diagnostic",
            artifactRepository: "proof-computer/slipway-diagnostic",
            workflowRef: "proof-computer/slipway-diagnostic/.github/workflows/diagnostic-ipfs.yml@refs/heads/main"
          },
          to: {
            repository: body.repository,
            artifactRepository: body.repository,
            workflowRef: body.workflowRef ?? `${body.repository}/.github/workflows/diagnostic-ipfs.yml@refs/heads/main`
          },
          policy: body.confirm === true ? { policyVersionId: "slipway-diagnostic-v23" } : undefined
        });
      },
      stdout: out.write
    };

    const dryRunCode = await runSlipwayApplicationSetRepository({
      applicationRef: "slipway-diagnostic",
      owner: "5owner",
      repository: "proof-computer/liskov-diagnostic",
      config: sessionFile,
      json: true
    }, options);
    const confirmCode = await runSlipwayApplicationSetRepository({
      applicationRef: "slipway-diagnostic",
      repository: "proof-computer/liskov-diagnostic",
      workflowRef: "proof-computer/liskov-diagnostic/.github/workflows/diagnostic-ipfs.yml@refs/heads/main",
      yes: true,
      config: sessionFile,
      json: true
    }, options);

    assert.equal(dryRunCode, 0);
    assert.equal(confirmCode, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/slipway-diagnostic/repository?owner=5owner",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {
        repository: "proof-computer/liskov-diagnostic",
        confirm: false
      }
    }, {
      url: "https://slipway.test/api/applications/slipway-diagnostic/repository",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {
        repository: "proof-computer/liskov-diagnostic",
        workflowRef: "proof-computer/liskov-diagnostic/.github/workflows/diagnostic-ipfs.yml@refs/heads/main",
        confirm: true
      }
    }]);
    assert.equal(out.text.includes(token), false);
    const outputs = out.text.trim().split(/\n(?=\{)/u).map((line) => JSON.parse(line) as { ok: boolean; dryRun: boolean; to: { repository: string }; policy?: { policyVersionId?: string } });
    assert.equal(outputs[0]?.ok, true);
    assert.equal(outputs[0]?.dryRun, true);
    assert.equal(outputs[0]?.to.repository, "proof-computer/liskov-diagnostic");
    assert.equal(outputs[1]?.dryRun, false);
    assert.equal(outputs[1]?.policy?.policyVersionId, "slipway-diagnostic-v23");
  });

  it("rejects an invalid repository slug before making any request", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "slipway_invalid_repo_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    let calls = 0;
    const out = writer();
    const code = await runSlipwayApplicationSetRepository({
      applicationRef: "slipway-diagnostic",
      repository: "not-a-repo",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ ok: true });
      },
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.equal(calls, 0);
    const parsed = JSON.parse(out.text) as { ok: boolean; error: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_SET_REPOSITORY_INVALID");
  });

  it("surfaces a new-repository access denial as a non-zero exit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_repo_denied_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const out = writer();
    const code = await runSlipwayApplicationSetRepository({
      applicationRef: "slipway-diagnostic",
      repository: "proof-computer/liskov-diagnostic",
      yes: true,
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async () => jsonResponse({
        ok: false,
        error: "forbidden",
        reasonCode: "github_repository_access_denied",
        reason: "GitHub session does not include the requested repository"
      }, 403),
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; error: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_REPOSITORY_ACCESS_DENIED");
  });

  it("dry-runs and confirms an Application rename without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_rename_secret_token_do_not_print";
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
        const body = JSON.parse(String(init?.body ?? "{}")) as { displayName?: string; confirm?: boolean };
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
          from: { displayName: "Slipway diagnostic", applicationName: "slipway-diagnostic" },
          to: {
            displayName: body.displayName,
            applicationName: "liskov-diagnostic",
            expectedPolicyPath: ".liskov/liskov-diagnostic.policy.json"
          },
          policy: body.confirm === true ? { policyVersionId: "slipway-diagnostic-v23" } : undefined
        });
      },
      stdout: out.write
    };

    const dryRunCode = await runSlipwayApplicationRename({
      applicationRef: "slipway-diagnostic",
      owner: "5owner",
      displayName: "Liskov Diagnostic",
      config: sessionFile,
      json: true
    }, options);
    const confirmCode = await runSlipwayApplicationRename({
      applicationRef: "slipway-diagnostic",
      displayName: "Liskov Diagnostic",
      yes: true,
      config: sessionFile,
      json: true
    }, options);

    assert.equal(dryRunCode, 0);
    assert.equal(confirmCode, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/slipway-diagnostic/rename?owner=5owner",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { displayName: "Liskov Diagnostic", confirm: false }
    }, {
      url: "https://slipway.test/api/applications/slipway-diagnostic/rename",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { displayName: "Liskov Diagnostic", confirm: true }
    }]);
    assert.equal(out.text.includes(token), false);
    const outputs = out.text.trim().split(/\n(?=\{)/u).map((line) => JSON.parse(line) as { ok: boolean; dryRun: boolean; to: { applicationName: string }; policy?: { policyVersionId?: string } });
    assert.equal(outputs[0]?.ok, true);
    assert.equal(outputs[0]?.dryRun, true);
    assert.equal(outputs[0]?.to.applicationName, "liskov-diagnostic");
    assert.equal(outputs[1]?.dryRun, false);
    assert.equal(outputs[1]?.policy?.policyVersionId, "slipway-diagnostic-v23");
  });

  it("rejects an empty rename display name before making any request", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "slipway_rename_invalid_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    let calls = 0;
    const out = writer();
    const code = await runSlipwayApplicationRename({
      applicationRef: "slipway-diagnostic",
      displayName: "   ",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ ok: true });
      },
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.equal(calls, 0);
    const parsed = JSON.parse(out.text) as { ok: boolean; error: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_RENAME_INVALID");
  });

  it("prints replacement-hold resume blockers and preserves server JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_replacement_hold_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });
    const serverBody = {
      ok: false,
      error: "application_resume_blocked_by_replacement_hold",
      reason: "replacement_hold_requires_explicit_override_reason",
      status: "active",
      overrideRequired: true,
      application: {
        applicationUid: "app-1111111111111111",
        applicationName: "alpha",
        applicationId: "legacy-alpha",
        ownerAddress: "5owner",
        status: "paused"
      },
      replacementHold: {
        domain: "proof.slipway.application-replacement-hold.v1",
        executionId: "live-execution:latest",
        deploymentId: "75824",
        policyDigest: "c".repeat(64),
        dossierClassification: "assignment_rows_missing_after_deadline",
        replacementRisk: "high",
        recommendation: "hold_replacement_spend",
        comparisonCounts: {
          observedDeployments: 2,
          currentPolicyAssignmentDeadlineMissedDeployments: 2
        }
      }
    };
    const requests: Array<{ body?: Record<string, unknown>; authorization?: string }> = [];
    const humanOut = writer();
    const humanCode = await runSlipwayApplicationStatusTransition({
      applicationRef: "alpha",
      status: "active",
      reason: "funded",
      yes: true,
      config: sessionFile
    }, {
      fetchImpl: async (_url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse(serverBody, 409);
      },
      stdout: humanOut.write
    });
    assert.equal(humanCode, 1);
    assert.equal(humanOut.text.includes(token), false);
    assert.match(humanOut.text, /application_resume_blocked_by_replacement_hold/u);
    assert.match(humanOut.text, /replacement dossier/u);
    assert.match(humanOut.text, /assignment_rows_missing_after_deadline/u);
    assert.match(humanOut.text, /replacement risk high/u);
    assert.match(humanOut.text, /--override-replacement-hold --reason TEXT --yes/u);
    assert.deepEqual(requests[0], {
      authorization: `Bearer ${token}`,
      body: {
        status: "active",
        confirm: true,
        reason: "funded"
      }
    });

    const jsonOut = writer();
    const jsonCode = await runSlipwayApplicationStatusTransition({
      applicationRef: "alpha",
      status: "active",
      reason: "funded",
      yes: true,
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async () => jsonResponse(serverBody, 409),
      stdout: jsonOut.write
    });
    assert.equal(jsonCode, 1);
    assert.equal(jsonOut.text.includes(token), false);
    const parsed = JSON.parse(jsonOut.text) as typeof serverBody;
    assert.equal(parsed.error, "application_resume_blocked_by_replacement_hold");
    assert.equal(parsed.replacementHold.executionId, "live-execution:latest");
    assert.equal(parsed.replacementHold.recommendation, "hold_replacement_spend");
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

  it("prints self-custody signer state in Application status human output without token leakage", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_status_human_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const out = writer();
    const code = await runSlipwayApplicationStatus({
      applicationId: "alpha",
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        application: {
          applicationId: "alpha",
          status: "active",
          source: { repository: "proof-computer/alpha" }
        },
        activePolicy: { policyVersionId: "alpha-v2", status: "active" },
        selfCustodySigner: {
          status: "online",
          address: "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT",
          connected: true,
          pendingRequestCount: 0,
          message: "Self-custody signer is online.",
          pairingToken: "lsk_pair_secret_should_not_print"
        }
      }),
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.match(out.text, /alpha: active/u);
    assert.match(out.text, /signer online 5C62Ck4U…2mLHiFT/u);
    assert.equal(out.text.includes(token), false);
    assert.equal(out.text.includes("lsk_pair_secret_should_not_print"), false);
  });

  it("prints waiting and failed-offline signer state in deployment status human output", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_deploy_status_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const waitingOut = writer();
    const waitingCode = await runSlipwayApplicationDeploymentStatus({
      applicationRef: "alpha",
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        selectedDeploymentId: "dep-waiting",
        deployments: [{ deploymentId: "dep-waiting" }],
        deployment: { state: "waiting_for_signer", stateLabel: "Waiting for signer" },
        selfCustodySigner: {
          status: "waiting_for_signer",
          address: "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT",
          pendingRequestCount: 1,
          message: "Waiting for the self-custody signer to reconnect before deploying.",
          websocketPath: "/api/custody/signer?pairingToken=lsk_pair_secret_should_not_print"
        }
      }),
      stdout: waitingOut.write
    });

    assert.equal(waitingCode, 0);
    assert.match(waitingOut.text, /Deployment state for alpha: Waiting for signer \(dep-waiting\)\./u);
    assert.match(waitingOut.text, /signer waiting for signer 5C62Ck4U…2mLHiFT, 1 pending/u);
    assert.equal(waitingOut.text.includes(token), false);
    assert.equal(waitingOut.text.includes("lsk_pair_secret_should_not_print"), false);

    const failedOut = writer();
    const failedCode = await runSlipwayApplicationDeploymentStatus({
      applicationRef: "alpha",
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        selectedDeploymentId: "dep-failed",
        deployments: [{ deploymentId: "dep-failed" }],
        deployment: {
          state: "failed_offline",
          stateLabel: "Signer offline",
          summary: "Fund the self-custody address with enough ACU to cover the deployment reward and transaction fee buffer, then retry."
        },
        selfCustodySigner: {
          status: "failed_offline",
          address: "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT",
          pendingRequestCount: 0,
          message: "Self-custody signer was offline for 5 minutes; start the signer daemon and retry the deployment."
        }
      }),
      stdout: failedOut.write
    });

    assert.equal(failedCode, 0);
    assert.match(failedOut.text, /Deployment state for alpha: Signer offline \(dep-failed\)\./u);
    assert.match(failedOut.text, /Fund the self-custody address/u);
    assert.match(failedOut.text, /signer failed offline/u);
    assert.match(failedOut.text, /start the signer daemon and retry/u);
    assert.equal(failedOut.text.includes(token), false);

    const mismatchOut = writer();
    const mismatchCode = await runSlipwayApplicationDeploymentStatus({
      applicationRef: "alpha",
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        selectedDeploymentId: "dep-mismatch",
        deployments: [{ deploymentId: "dep-mismatch" }],
        deployment: {
          state: "runtime_mismatch",
          stateLabel: "Signer runtime mismatch",
          summary: "Self-custody signer Acurast runtime metadata does not match Liskov; update or restart the signer, or check its Acurast RPC URL."
        },
        selfCustodySigner: {
          status: "runtime_mismatch",
          address: "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT",
          pendingRequestCount: 0,
          message: "Self-custody signer Acurast runtime metadata does not match Liskov; update or restart the signer, or check its Acurast RPC URL.",
          websocketPath: "/api/custody/signer?pairingToken=lsk_pair_secret_should_not_print"
        }
      }),
      stdout: mismatchOut.write
    });

    assert.equal(mismatchCode, 0);
    assert.match(mismatchOut.text, /Deployment state for alpha: Signer runtime mismatch \(dep-mismatch\)\./u);
    assert.match(mismatchOut.text, /signer runtime mismatch/u);
    assert.match(mismatchOut.text, /update or restart the signer/u);
    assert.equal(mismatchOut.text.includes(token), false);
    assert.equal(mismatchOut.text.includes("lsk_pair_secret_should_not_print"), false);
  });

  it("prints self-custody signer activity rows in human output without leaking raw call bytes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_activity_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const out = writer();
    const code = await runSlipwayApplicationActivity({
      applicationRef: "alpha",
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        events: [
          {
            eventId: "ev-1",
            kind: "liskov.sign_requested",
            category: "deploy",
            summary: "Signature requested — acurast.register.",
            payload: {
              requestId: "req-1",
              operation: "acurast.register",
              signerAddress: "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT",
              callHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              queued: true,
              callBytesHex: "0x04010203",
              pairingToken: "lsk_pair_secret_should_not_print"
            },
            createdAtMs: 1_700_000_000_000
          },
          {
            eventId: "ev-2",
            kind: "liskov.sign_submitted",
            category: "deploy",
            summary: "Self-custody signer submitted acurast.register.",
            payload: {
              requestId: "req-1",
              operation: "acurast.register",
              signerAddress: "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT",
              callHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            },
            createdAtMs: 1_700_000_001_000
          },
          {
            eventId: "ev-3",
            kind: "liskov.sign_rejected",
            category: "hold",
            summary: "Self-custody signer rejected acurast.setEnvironments — userRejected.",
            payload: {
              requestId: "req-2",
              operation: "acurast.setEnvironments",
              signerAddress: "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT",
              callHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              reason: "userRejected",
              message: "local signer note should not print"
            },
            createdAtMs: 1_700_000_002_000
          }
        ]
      }),
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.match(out.text, /3 activity event\(s\) for alpha\./u);
    assert.match(out.text, /Signature requested — acurast\.register\./u);
    assert.match(out.text, /Self-custody signer submitted acurast\.register\./u);
    assert.match(out.text, /Self-custody signer rejected acurast\.setEnvironments — userRejected\./u);
    assert.match(out.text, /signer 5C62Ck4U…2mLHiFT/u);
    assert.match(out.text, /call sha256:bbbb/u);
    assert.equal(out.text.includes(token), false);
    assert.equal(out.text.includes("0x04010203"), false);
    assert.equal(out.text.includes("lsk_pair_secret_should_not_print"), false);
    assert.equal(out.text.includes("local signer note should not print"), false);
  });

  it("keeps Application activity JSON output as the server response", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_activity_json_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const body = {
      ok: true,
      events: [{
        eventId: "ev-json",
        kind: "liskov.sign_requested",
        payload: { requestId: "req-json", callBytesHex: "server-json-is-pass-through" }
      }]
    };
    const out = writer();
    const code = await runSlipwayApplicationActivity({
      applicationRef: "alpha",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async () => jsonResponse(body),
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out.text), body);
    assert.equal(out.text.includes(token), false);
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

  it("runs Application mutation commands through confirmed Liskov API requests", async () => {
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
        name: "publish",
        run: () => runSlipwayApplicationPublish({
          applicationRef: "alpha",
          config: sessionFile,
          json: true,
          yes: true
        }, sharedOptions()),
        expected: {
          url: "https://slipway.test/api/applications/alpha/publish",
          method: "POST",
          body: {}
        }
      },
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
      runSlipwayApplicationPublish({ applicationRef: "alpha", config: sessionFile, json: true }, options),
      runSlipwayApplicationDeploymentImport({ applicationRef: "alpha", sequence: 1, origin: "5origin", config: sessionFile, json: true }, options),
      runSlipwayApplicationLockboxSetupPr({ applicationRef: "alpha", config: sessionFile, json: true }, options),
      runSlipwayApplicationLockboxDispatch({ applicationRef: "alpha", config: sessionFile, json: true }, options),
      runSlipwayApplicationLockboxGrantEnsure({ applicationRef: "alpha", config: sessionFile, json: true }, options),
      runSlipwayApplicationLockboxGrantVerify({ applicationRef: "alpha", grantId: "grant-1", config: sessionFile, json: true }, options),
      runSlipwayApplicationBlackboxConfigure({ applicationRef: "alpha", config: sessionFile, json: true }, options)
    ];
    const codes = await Promise.all(commands);
    assert.deepEqual(codes, [1, 1, 1, 1, 1, 1, 1]);
    assert.match(out.text, /CONFIRMATION_REQUIRED/u);
  });

  it("mints Application DevTools view keys without printing the session token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_devtools_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const humanOut = writer();
    const humanCode = await runSlipwayApplicationDevtoolsViewKey({
      applicationRef: "alpha",
      deploymentId: "66059",
      config: sessionFile
    }, {
      fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          ok: true,
          deploymentId: "66059",
          jobId: "[\"5origin\",66059]",
          viewKey: "view-key-secret",
          expiresAt: "2026-06-20T12:10:00.000Z",
          devtoolsUrl: "https://devtools.test/deployment/66059?viewKey=view-key-secret"
        });
      },
      stdout: humanOut.write
    });
    assert.equal(humanCode, 0);
    assert.deepEqual(requests[0], {
      url: "https://slipway.test/api/applications/alpha/live-custody/devtools/view-key",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { deploymentId: "66059" }
    });
    assert.match(humanOut.text, /https:\/\/devtools\.test\/deployment\/66059\?viewKey=view-key-secret/u);
    assert.match(humanOut.text, /Expires: 2026-06-20T12:10:00\.000Z/u);
    assert.equal(humanOut.text.includes(token), false);

    const jsonOut = writer();
    const jsonCode = await runSlipwayApplicationDevtoolsViewKey({
      applicationRef: "alpha",
      deploymentId: "66059",
      accountRef: "live-custody:owner/repo:acurast",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          ok: true,
          deploymentId: "66059",
          viewKey: "json-view-key-secret",
          expiresAt: "2026-06-20T12:15:00.000Z",
          devtoolsUrl: "https://devtools.test/deployment/66059?viewKey=json-view-key-secret"
        });
      },
      stdout: jsonOut.write
    });
    assert.equal(jsonCode, 0);
    assert.deepEqual(requests[1], {
      url: "https://slipway.test/api/applications/alpha/live-custody/devtools/view-key",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { deploymentId: "66059", accountRef: "live-custody:owner/repo:acurast" }
    });
    assert.equal(jsonOut.text.includes(token), false);
    const parsed = JSON.parse(jsonOut.text) as { ok: boolean; viewKey: string; devtoolsUrl: string };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.viewKey, "json-view-key-secret");
    assert.match(parsed.devtoolsUrl, /json-view-key-secret/u);
  });

  it("issues a self-custody signer pairing token without printing the session bearer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_pair_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayCustodyPair({
      applicationRef: "proof-docs",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        });
        return jsonResponse({
          ok: true,
          pairingToken: "lsk_pair_secret_for_signer",
          organizationId: "org-1",
          applicationId: "app-1",
          expiresAtMs: 1_750_000_030_000,
          websocketPath: "/api/custody/signer?pairingToken=lsk_pair_secret_for_signer",
          protocolVersion: 1
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/proof-docs/custody/signer/pairing-token",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {}
    }]);
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as {
      ok: boolean;
      pairingToken: string;
      controlPlaneUrl: string;
      websocketUrl: string;
      signerCommand: string;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.pairingToken, "lsk_pair_secret_for_signer");
    assert.equal(parsed.controlPlaneUrl, "wss://slipway.test/api/custody/signer");
    assert.equal(parsed.websocketUrl, "wss://slipway.test/api/custody/signer?pairingToken=lsk_pair_secret_for_signer");
    assert.match(parsed.signerCommand, /liskov-self-custody-signer --control-plane-url 'wss:\/\/slipway\.test\/api\/custody\/signer' --pairing-token 'lsk_pair_secret_for_signer'/u);
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
        if (String(url).endsWith("/api/applications/alpha/action-plan")) {
          return jsonResponse({
            ok: true,
            blockingDecision: {
              decisionId: "decision-1",
              actions: [{
                action: "retry_all",
                method: "POST",
                href: "/api/applications/alpha/action-plan/decisions/decision-1",
                body: {
                  action: "retry_all",
                  acknowledgement: "operator-reviewed",
                  reason: "retry parked deployment generation",
                  targetExecutionIds: ["exec-1"],
                  targetExecutionCount: 1
                }
              }]
            }
          });
        }
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
    assert.equal(await runSlipwayCustodyExecutionRunOne({
      applicationRef: "alpha",
      executionId: "exec-1",
      expectKind: "acurast.deploy",
      expectPolicyDigest: "policy-digest-1",
      expectDeploymentId: "75824",
      config: sessionFile,
      json: true,
      yes: true
    }, options), 0);
    assert.equal(await runSlipwayCustodyExecutionDiagnose({ applicationRef: "alpha", executionId: "exec-1", network: "testnet", config: sessionFile, json: true }, options), 0);
    assert.equal(await runSlipwayCustodyExecutionRecover({ applicationRef: "alpha", executionId: "exec-1", reason: "operator reviewed", config: sessionFile, json: true, yes: true }, options), 0);
    assert.equal(await runSlipwayCustodyExecutionRetry({ applicationRef: "alpha", executionId: "exec-1", reason: "operator retry secret reason", config: sessionFile, json: true, yes: true }, options), 0);
    assert.equal(await runSlipwayApplicationActionPlanRetry({ applicationRef: "alpha", decisionId: "decision-1", reason: "cohort retry secret reason", config: sessionFile, json: true, yes: true }, options), 0);
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
      url: "https://slipway.test/api/applications/alpha/live-custody/executions/run-one",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {
        expectedKind: "acurast.deploy",
        expectedPolicyDigest: "policy-digest-1",
        expectedDeploymentId: "75824",
        yes: true,
        acknowledgement: "run-one",
        executionId: "exec-1"
      }
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
      url: "https://slipway.test/api/applications/alpha/live-custody/executions/exec-1/recover",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { yesRecover: true, acknowledgement: "operator-reviewed", reason: "operator retry secret reason", mode: "retry" }
    }, {
      url: "https://slipway.test/api/applications/alpha/action-plan",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
    }, {
      url: "https://slipway.test/api/applications/alpha/action-plan/decisions/decision-1",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {
        action: "retry_all",
        acknowledgement: "operator-reviewed",
        reason: "cohort retry secret reason",
        targetExecutionIds: ["exec-1"],
        targetExecutionCount: 1
      }
    }, {
      url: "https://slipway.test/api/live-custody/machine-catalog?network=canary",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
    }]);
    assert.equal(out.text.includes(token), false);
    assert.equal(out.text.includes("operator retry secret reason"), false);
    assert.equal(out.text.includes("cohort retry secret reason"), false);
  });

  it("prints reclaim counts in live custody preflight human output", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_preflight_reclaim_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method: string; authorization?: string }> = [];
    const out = writer();
    const code = await runSlipwayCustodyPreflight({
      applicationRef: "alpha",
      config: sessionFile
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization
        });
        return jsonResponse({
          ok: true,
          actionPlan: { count: 2, items: [{ planItemId: "plan-1" }, { planItemId: "plan-2" }] },
          reclaim: {
            sweepEnabled: false,
            maxPerTick: 2,
            candidateCount: 7,
            reclaimableCount: 2,
            blockedCount: 1,
            failedCount: 1,
            alreadyReclaimedCount: 1,
            alreadyDeregisteredCount: 1,
            skippedByLimitCount: 1,
            items: []
          }
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/live-custody/preflight",
      method: "GET",
      authorization: `Bearer ${token}`
    }]);
    assert.match(out.text, /2 live custody plan item\(s\) for alpha\./u);
    assert.match(out.text, /Reclaim: 7 candidate\(s\), 2 reclaimable, 1 blocked, 1 failed, 1 already reclaimed, 1 already deregistered, 1 skipped by limit\./u);
    assert.equal(out.text.includes(token), false);
  });

  it("prints assignment dossier risk in human custody diagnosis output", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "slipway_human_diagnose_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });
    const out = writer();
    const code = await runSlipwayCustodyExecutionDiagnose({
      applicationRef: "alpha",
      executionId: "exec-1",
      network: "mainnet",
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        classification: "assigned_status_without_current_assignment_rows",
        attempt: {
          deploymentId: "75824"
        },
        assignmentRows: {
          assignedProcessorsCount: 0,
          storedMatchesCount: 0,
          storedMatchesWithRequiredKeys: 0
        },
        dossier: {
          evaluator: {
            classification: "assignment_rows_missing_after_deadline",
            replacementRisk: "high",
            recommendation: "hold_replacement_spend"
          }
        }
      }),
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.match(out.text, /Acurast job diagnosis: assigned_status_without_current_assignment_rows/u);
    assert.match(out.text, /Dossier: assignment_rows_missing_after_deadline, replacement risk high/u);
    assert.match(out.text, /Deployment 75824 assignment rows: assigned 0, stored matches 0, required keys 0/u);
    assert.match(out.text, /Recommendation: hold_replacement_spend/u);
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
    assert.equal(await runSlipwayCustodyExecutionRunOne({
      applicationRef: "alpha",
      executionId: "exec-1",
      expectKind: "acurast.deploy",
      expectPolicyDigest: "policy-digest-1",
      config: sessionFile,
      json: true
    }, options), 1);
    assert.equal(await runSlipwayCustodyExecutionRunOne({
      applicationRef: "alpha",
      planItemId: "plan-1",
      idempotencyKey: "key-1",
      expectKind: "acurast.deploy",
      expectPolicyDigest: "policy-digest-1",
      config: sessionFile,
      json: true,
      yes: true
    }, options), 1);
    assert.equal(await runSlipwayCustodyExecutionRecover({ applicationRef: "alpha", executionId: "exec-1", reason: "review", config: sessionFile, json: true }, options), 1);
    assert.equal(await runSlipwayCustodyExecutionRetry({ applicationRef: "alpha", executionId: "exec-1", reason: "retry", config: sessionFile, json: true }, options), 1);
    assert.equal(await runSlipwayApplicationActionPlanRetry({ applicationRef: "alpha", decisionId: "decision-1", reason: "retry", config: sessionFile, json: true }, options), 1);
    assert.match(out.text, /--yes/u);
    assert.match(out.text, /--yes-spend/u);
  });

  it("fails action-plan retry when the decision is no longer served", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_action_plan_absent_decision_token";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayApplicationActionPlanRetry({
      applicationRef: "alpha",
      decisionId: "decision-missing",
      reason: "retry",
      config: sessionFile,
      json: true,
      yes: true
    }, {
      fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        });
        return jsonResponse({
          ok: true,
          blockingDecision: {
            decisionId: "decision-1",
            actions: [{
              action: "retry_all",
              method: "POST",
              href: "/api/applications/alpha/action-plan/decisions/decision-1",
              body: {
                action: "retry_all",
                acknowledgement: "operator-reviewed",
                reason: "retry parked deployment generation",
                targetExecutionIds: ["exec-1"]
              }
            }]
          }
        });
      },
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/action-plan",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
    }]);
    const parsed = JSON.parse(out.text) as { ok: boolean; error: string; decisionId: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_APPLICATION_ACTION_PLAN_DECISION_NOT_SERVED");
    assert.equal(parsed.decisionId, "decision-missing");
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

  it("runs one setEnvironment execution with an encrypted handoff and spend confirmation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const secretsFile = path.join(dir, ".env");
    const token = "slipway_run_one_secret_token_do_not_print";
    const secretValue = "run-one-secret-value-do-not-print";
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
    const code = await runSlipwayCustodyExecutionRunOne({
      applicationRef: "alpha",
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      expectKind: "acurast.setEnvironment",
      expectPolicyDigest: "policy-digest-1",
      expectDeploymentId: "777",
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
        return jsonResponse({ ok: true, mode: "submit", attempt: { executionId: "exec-1", status: "submitted", receipt: { deploymentId: "777" } } });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`), [
      "GET /api/applications/alpha/action-plan",
      "GET /api/applications/alpha",
      "POST /api/applications/alpha/live-custody/executions/run-one"
    ]);
    assert.deepEqual(requests[2]?.body, {
      expectedKind: "acurast.setEnvironment",
      expectedPolicyDigest: "policy-digest-1",
      expectedDeploymentId: "777",
      yes: true,
      acknowledgement: "run-one",
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      yesSpend: true,
      spendAcknowledgement: "yes-spend",
      environmentHandoff: handoff
    });
    assert.equal(requests[2]?.authorization, `Bearer ${token}`);
    assert.equal(out.text.includes(token), false);
    assert.equal(out.text.includes(secretValue), false);
  });

  it("uses explicit local values as fallback for server-held environment variables", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const secretsFile = path.join(dir, ".env");
    const token = "slipway_run_one_fallback_token_do_not_print";
    const secretValue = "run-one-secret-value-do-not-print";
    const bootstrapValue = "{\"v\":1,\"u\":\"https://slipway.test\",\"a\":\"alpha\",\"p\":\"policy-digest-1\",\"d\":\"777\"}";
    await writeFile(secretsFile, `SECRET_VALUE=${secretValue}\nPROOF_SLIPWAY_BOOTSTRAP=${bootstrapValue}\n`, "utf8");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const handoff = encryptedHandoff();
    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const variables = [
      { name: "SECRET_VALUE", source: "secret", required: true },
      { name: "PROOF_SLIPWAY_BOOTSTRAP", source: "switchboard", required: true }
    ];
    const code = await runSlipwayCustodyExecutionRunOne({
      applicationRef: "alpha",
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      expectKind: "acurast.setEnvironment",
      expectPolicyDigest: "policy-digest-1",
      expectDeploymentId: "777",
      secretsFile,
      config: sessionFile,
      json: true,
      yes: true,
      yesSpend: true
    }, {
      environmentHandoffBuilder: async (input) => {
        assert.equal(input.action.actionId, "set-env-1");
        assert.deepEqual(input.variables, [
          { key: "SECRET_VALUE", value: secretValue },
          { key: "PROOF_SLIPWAY_BOOTSTRAP", value: bootstrapValue }
        ]);
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
          return jsonResponse({ ok: true, items: [setEnvironmentPlanItem(variables)] });
        }
        if (String(url).endsWith("/api/actions/set-env-1/submit-material")) {
          return jsonResponse({ ok: true, values: [] });
        }
        if (String(url).endsWith("/api/applications/alpha")) {
          return jsonResponse({
            ok: true,
            application: { applicationId: "alpha", status: "active" },
            activePolicy: {
              policyDigest: "policy-digest-1",
              environment: { variables }
            }
          });
        }
        return jsonResponse({ ok: true, mode: "submit", attempt: { executionId: "exec-1", status: "submitted", receipt: { deploymentId: "777" } } });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`), [
      "GET /api/applications/alpha/action-plan",
      "GET /api/applications/alpha",
      "GET /api/actions/set-env-1/submit-material",
      "POST /api/applications/alpha/live-custody/executions/run-one"
    ]);
    assert.deepEqual(requests[3]?.body, {
      expectedKind: "acurast.setEnvironment",
      expectedPolicyDigest: "policy-digest-1",
      expectedDeploymentId: "777",
      yes: true,
      acknowledgement: "run-one",
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      yesSpend: true,
      spendAcknowledgement: "yes-spend",
      environmentHandoff: handoff
    });
    assert.equal(requests[3]?.authorization, `Bearer ${token}`);
    assert.equal(out.text.includes(token), false);
    assert.equal(out.text.includes(secretValue), false);
    assert.equal(out.text.includes(bootstrapValue), false);
  });

  it("lets the server build environment handoffs without a local secrets file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_run_one_server_held_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayCustodyExecutionRunOne({
      applicationRef: "alpha",
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      expectKind: "acurast.setEnvironment",
      expectPolicyDigest: "policy-digest-1",
      expectDeploymentId: "777",
      config: sessionFile,
      json: true,
      yes: true,
      yesSpend: true
    }, {
      environmentHandoffBuilder: async () => {
        throw new Error("client should not build a server-held handoff without --secrets-file");
      },
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        });
        return jsonResponse({ ok: true, mode: "submit", attempt: { executionId: "exec-1", status: "submitted", receipt: { deploymentId: "777" } } });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`), [
      "POST /api/applications/alpha/live-custody/executions/run-one"
    ]);
    assert.deepEqual(requests[0]?.body, {
      expectedKind: "acurast.setEnvironment",
      expectedPolicyDigest: "policy-digest-1",
      expectedDeploymentId: "777",
      yes: true,
      acknowledgement: "run-one",
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      yesSpend: true,
      spendAcknowledgement: "yes-spend"
    });
    assert.equal(requests[0]?.authorization, `Bearer ${token}`);
    assert.equal(out.text.includes(token), false);
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

async function assertWorkflowRunBlocksAreBashSyntax(workflow: string, dir: string): Promise<void> {
  const blocks = extractYamlRunBlocks(workflow);
  assert.equal(blocks.length, 4);
  for (const [index, block] of blocks.entries()) {
    const scriptPath = path.join(dir, `workflow-run-${index + 1}.sh`);
    await writeFile(scriptPath, block, "utf8");
    const result = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
}

function extractYamlRunBlocks(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/u);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() !== "run: |") continue;
    const baseIndent = line.length - line.trimStart().length;
    const block: string[] = [];
    index += 1;
    while (index < lines.length) {
      const blockLine = lines[index]!;
      const indent = blockLine.length - blockLine.trimStart().length;
      if (blockLine.trim() && indent <= baseIndent) {
        index -= 1;
        break;
      }
      block.push(blockLine.length >= baseIndent + 2 ? blockLine.slice(baseIndent + 2) : "");
      index += 1;
    }
    blocks.push(`${block.join("\n")}\n`);
  }
  return blocks;
}

function setEnvironmentPlanItem(
  variables: Array<{ name: string; source: string; required: boolean }> = [{ name: "SECRET_VALUE", source: "secret", required: true }]
): Record<string, unknown> {
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
      envNames: variables.map((variable) => variable.name),
      variables
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
