import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import RuntimeImageWorkflowCommand from "../src/commands/liskov/application/runtime-image/workflow.js";
import {
  runSlipwayAdminDeploySpendResolve,
  runSlipwayAdminExecutorOperationReconcile,
  runSlipwayApplicationBackfillIdentities,
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
  runSlipwayApplicationPolicyPublish,
  runSlipwayApplicationPublish,
  runSlipwayApplicationDevtoolsViewKey,
  runSlipwayApplicationCreate,
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
  runSlipwayOrganizationBilling,
  runSlipwayOrganizationList,
  runSlipwayOrganizationServiceCredits,
  runSlipwayOrganizationTransactions,
  runSlipwayOrganizationUse,
  runSlipwayWhoami,
  saveSlipwaySession
} from "../src/index.js";

describe("proof-cli Liskov runner", () => {
  it("writes a manifest-bound @v1 runtime-image workflow without inline upload logic", async () => {
    const { dir, manifestPath } = await runtimeImageWorkflowFixture("proof-docs");
    const output = path.join(dir, ".github", "workflows", "liskov-runtime-image.yml");
    const out = writer();
    const code = await runSlipwayApplicationRuntimeImageWorkflow({
      applicationRef: "proof-docs",
      json: true,
      liskovUrl: "https://liskov.test",
      manifestPath,
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
      manifestPath: string;
      actionsRef: string;
      policyWorkflowRefHint: string;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.applicationRef, "proof-docs");
    assert.equal(parsed.output, output);
    assert.equal(parsed.liskovUrl, "https://liskov.test");
    assert.equal(parsed.oidcAudience, "liskov-runtime-image-upload");
    assert.equal(parsed.manifestPath, manifestPath);
    assert.equal(
      parsed.actionsRef,
      "proof-computer/liskov-github-actions/.github/workflows/runtime-image.yml@v1"
    );
    assert.match(parsed.policyWorkflowRefHint, /\.github\/workflows\/liskov-runtime-image\.yml@refs\/heads\/<branch>/u);
    assert.equal(out.text.includes("secretAccessKey"), false);
    assert.equal(out.text.includes("AWS_SECRET_ACCESS_KEY"), false);

    const workflow = await readFile(output, "utf8");
    assert.match(workflow, /^name: 'Upload Runtime'$/mu);
    assert.match(workflow, /^"on":$/mu);
    assert.match(workflow, /description: 'Optional sha256 digest, with or without sha256: prefix'/u);
    assert.match(workflow, /id-token: write/u);
    assert.match(
      workflow,
      /uses: proof-computer\/liskov-github-actions\/\.github\/workflows\/runtime-image\.yml@v1/u
    );
    assert.match(workflow, /application-id: 'proof-docs'/u);
    assert.match(workflow, new RegExp(`manifest-path: '${manifestPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}'`, "u"));
    assert.match(workflow, /image-url: \$\{\{ inputs\.image_url \}\}/u);
    assert.match(workflow, /expected-sha256: \$\{\{ inputs\.expected_sha256 \}\}/u);
    assert.match(workflow, /liskov-url: 'https:\/\/liskov\.test'/u);
    assert.match(workflow, /audience: 'liskov-runtime-image-upload'/u);
    assert.doesNotMatch(workflow, /runtime-images\/upload-session/u);
    assert.doesNotMatch(workflow, /aws s3api|ACTIONS_ID_TOKEN_REQUEST|secretAccessKey|AWS_SECRET_ACCESS_KEY/u);
    assert.doesNotMatch(workflow, /curl --request POST|::add-mask::|run: \|/u);
  });

  it("requires --yes before overwriting an existing runtime-image workflow", async () => {
    const { dir, manifestPath } = await runtimeImageWorkflowFixture("proof-docs");
    const output = path.join(dir, "runtime-image.yml");
    await writeFile(output, "existing workflow\n", "utf8");
    const out = writer();
    const code = await runSlipwayApplicationRuntimeImageWorkflow({
      applicationRef: "proof-docs",
      json: true,
      manifestPath,
      output
    }, { stdout: out.write });

    assert.equal(code, 1);
    assert.equal(await readFile(output, "utf8"), "existing workflow\n");
    const parsed = JSON.parse(out.text) as { ok: boolean; error: string; output: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_RUNTIME_IMAGE_WORKFLOW_EXISTS");
    assert.equal(parsed.output, output);

    const confirmed = writer();
    const confirmedCode = await runSlipwayApplicationRuntimeImageWorkflow({
      applicationRef: "proof-docs",
      json: true,
      manifestPath,
      output,
      yes: true
    }, { stdout: confirmed.write });
    assert.equal(confirmedCode, 0);
    assert.match(
      await readFile(output, "utf8"),
      /uses: proof-computer\/liskov-github-actions\/\.github\/workflows\/runtime-image\.yml@v1/u
    );
  });

  it("requires the runtime-image workflow manifest flag", () => {
    const manifest = RuntimeImageWorkflowCommand.flags.manifest as { required?: boolean };
    assert.equal(manifest.required, true);
  });

  it("rejects invalid, mismatched, and non-runtime-image manifests before writing", async (context) => {
    await context.test("unsafe manifest path", async () => {
      const output = path.join(tmpdir(), "unsafe-runtime-image.yml");
      const out = writer();
      const code = await runSlipwayApplicationRuntimeImageWorkflow({
        applicationRef: "proof-docs",
        json: true,
        manifestPath: "../manifest.json",
        output
      }, { stdout: out.write });

      assert.equal(code, 1);
      assert.equal(
        (JSON.parse(out.text) as { error: string }).error,
        "SLIPWAY_RUNTIME_IMAGE_MANIFEST_PATH_INVALID"
      );
    });

    await context.test("malformed manifest", async () => {
      const { dir, manifestPath } = await runtimeImageWorkflowFixture("proof-docs");
      await writeFile(path.resolve(manifestPath), "{not json\n", "utf8");
      const output = path.join(dir, "malformed.yml");
      const out = writer();
      const code = await runSlipwayApplicationRuntimeImageWorkflow({
        applicationRef: "proof-docs",
        json: true,
        manifestPath,
        output
      }, { stdout: out.write });

      assert.equal(code, 1);
      assert.equal(
        (JSON.parse(out.text) as { error: string }).error,
        "SLIPWAY_RUNTIME_IMAGE_MANIFEST_INVALID"
      );
    });

    await context.test("application id mismatch", async () => {
      const { dir, manifestPath } = await runtimeImageWorkflowFixture("another-app");
      const output = path.join(dir, "application-mismatch.yml");
      const out = writer();
      const code = await runSlipwayApplicationRuntimeImageWorkflow({
        applicationRef: "proof-docs",
        json: true,
        manifestPath,
        output
      }, { stdout: out.write });

      assert.equal(code, 1);
      assert.equal(
        (JSON.parse(out.text) as { error: string }).error,
        "SLIPWAY_RUNTIME_IMAGE_MANIFEST_APPLICATION_MISMATCH"
      );
    });

    await context.test("non-runtime-image build", async () => {
      const { dir, manifestPath, manifest } = await runtimeImageWorkflowFixture("proof-docs");
      (manifest.release as { artifact: Record<string, unknown> }).artifact = {
        kind: "ipfs_bundle",
        encryption: { mode: "none" }
      };
      await writeFile(path.resolve(manifestPath), `${JSON.stringify(manifest)}\n`, "utf8");
      const output = path.join(dir, "wrong-artifact.yml");
      const out = writer();
      const code = await runSlipwayApplicationRuntimeImageWorkflow({
        applicationRef: "proof-docs",
        json: true,
        manifestPath,
        output
      }, { stdout: out.write });

      assert.equal(code, 1);
      assert.equal(
        (JSON.parse(out.text) as { error: string }).error,
        "SLIPWAY_RUNTIME_IMAGE_MANIFEST_RELEASE_INVALID"
      );
    });

    await context.test("authored manifest path mismatch", async () => {
      const { dir, manifestPath, manifest } = await runtimeImageWorkflowFixture("proof-docs");
      ((manifest.release as { builder: Record<string, unknown> }).builder).manifestPath =
        ".liskov/different.json";
      await writeFile(path.resolve(manifestPath), `${JSON.stringify(manifest)}\n`, "utf8");
      const output = path.join(dir, "path-mismatch.yml");
      const out = writer();
      const code = await runSlipwayApplicationRuntimeImageWorkflow({
        applicationRef: "proof-docs",
        json: true,
        manifestPath,
        output
      }, { stdout: out.write });

      assert.equal(code, 1);
      assert.equal(
        (JSON.parse(out.text) as { error: string }).error,
        "SLIPWAY_RUNTIME_IMAGE_MANIFEST_PATH_MISMATCH"
      );
    });
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

  it("propagates one trimmed request organization across GET, POST, and DELETE", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "request_organization_transport_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });
    const requests: Array<{ method: string; authorization?: string; organization?: string }> = [];
    const fetchImpl = async (_url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const headers = init?.headers as Record<string, string>;
      const method = init?.method ?? "GET";
      requests.push({
        method,
        authorization: headers.authorization,
        organization: headers["x-liskov-organization"]
      });
      if (method === "GET") return jsonResponse({ ok: true, count: 0, applications: [] });
      if (method === "POST") {
        return jsonResponse({ ok: true, dryRun: true, changed: false, scanned: 0, changedCount: 0, changes: [] });
      }
      return jsonResponse({
        ok: true,
        dryRun: false,
        deleted: true,
        changed: true,
        application: { applicationUid: "app-1", applicationName: "one", status: "deleted" },
        impact: {}
      });
    };
    const options = { fetchImpl, organization: "  Exact-Slug  ", stdout: () => undefined };
    assert.equal(await runSlipwayApplicationList({ config: sessionFile, json: true }, options), 0);
    assert.equal(await runSlipwayApplicationBackfillIdentities({ config: sessionFile, json: true }, options), 0);
    assert.equal(await runSlipwayApplicationDelete({
      applicationRef: "app-1",
      reason: "done",
      yes: true,
      config: sessionFile,
      json: true
    }, options), 0);
    assert.deepEqual(requests, ["GET", "POST", "DELETE"].map((method) => ({
      method,
      authorization: `Liskov-Organization ${token}`,
      organization: "Exact-Slug"
    })));
  });

  it("shows effective and persistent organizations under a whoami override", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "request_organization_whoami_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });
    const effective = { id: "org-2", name: "Requested", slug: "requested", isPersonal: false, role: "developer" };
    const sessionDefault = { id: "org-1", name: "Persistent", slug: "persistent", isPersonal: false, role: "owner" };
    const fetchImpl = async (_url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, `Liskov-Organization ${token}`);
      assert.equal(headers["x-liskov-organization"], "requested");
      return jsonResponse({
        ok: true,
        session: { sessionId: "session-1", identity: { kind: "github_app", login: "octo" } },
        organization: effective,
        organizations: [sessionDefault, effective],
        organizationContext: { source: "request", effective, sessionDefault }
      });
    };
    const json = writer();
    assert.equal(await runSlipwayWhoami({ config: sessionFile, json: true }, {
      fetchImpl,
      organization: "requested",
      stdout: json.write
    }), 0);
    assert.deepEqual((JSON.parse(json.text) as { organizationContext: unknown }).organizationContext, {
      source: "request",
      effective,
      sessionDefault
    });
    const human = writer();
    assert.equal(await runSlipwayWhoami({ config: sessionFile }, {
      fetchImpl,
      organization: "requested",
      stdout: human.write
    }), 0);
    assert.match(human.text, /Effective organization: Requested/u);
    assert.match(human.text, /Persistent organization: Persistent/u);
    assert.equal(human.text.includes(token), false);
  });

  it("reports an unavailable persistent organization without mislabeling the override", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "request_organization_stale_default_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });
    const effective = { id: "org-2", name: "Requested", slug: "requested", isPersonal: false, role: "developer" };
    const fetchImpl = async (): Promise<Response> => jsonResponse({
      ok: true,
      session: { sessionId: "session-1", identity: { kind: "github_app", login: "octo" } },
      organization: effective,
      organizations: [effective],
      organizationContext: { source: "request", effective, sessionDefault: null }
    });

    const json = writer();
    assert.equal(await runSlipwayWhoami({ config: sessionFile, json: true }, {
      fetchImpl,
      organization: "requested",
      stdout: json.write
    }), 0);
    assert.equal(
      (JSON.parse(json.text) as { organizationContext: { sessionDefault: unknown } }).organizationContext.sessionDefault,
      null
    );

    const human = writer();
    assert.equal(await runSlipwayWhoami({ config: sessionFile }, {
      fetchImpl,
      organization: "requested",
      stdout: human.write
    }), 0);
    assert.match(human.text, /Effective organization: Requested/u);
    assert.match(human.text, /Persistent organization: unavailable/u);
    assert.doesNotMatch(human.text, /Persistent organization: Requested/u);
  });

  it("rejects an invalid request organization before network I/O", async () => {
    let calls = 0;
    const out = writer();
    assert.equal(await runSlipwayApplicationList({ json: true }, {
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ ok: true });
      },
      organization: "   ",
      stdout: out.write
    }), 1);
    assert.equal(calls, 0);
    assert.equal((JSON.parse(out.text) as { error: string }).error, "LISKOV_ORGANIZATION_SELECTOR_INVALID");
  });

  it("shows organization and UID in human Application list output", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "application_human_list_token",
      savedAtMs: 0
    }, { config: sessionFile });
    const out = writer();
    assert.equal(await runSlipwayApplicationList({ config: sessionFile }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        count: 1,
        applications: [{
          organizationId: "org-1",
          applicationUid: "app-0123456789abcdef",
          applicationName: "alpha",
          applicationId: "legacy-alpha",
          status: "active"
        }]
      }),
      stdout: out.write
    }), 0);
    assert.match(out.text, /org org-1/u);
    assert.match(out.text, /uid app-0123456789abcdef/u);
  });

  it("preserves raw JSON for organization and billing reads with exact query passthrough", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "organization_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const organizations = {
      ok: true,
      organizations: [{
        id: "org-1",
        name: "Example Org",
        slug: "example-org",
        isPersonal: false,
        avatarColor: "tide",
        role: "owner"
      }]
    };
    const billing = {
      ok: true,
      organization: organizations.organizations[0],
      plan: { id: "starter", name: "Starter" },
      usage: { applications: 2, users: 1, meteredSeats: 0 },
      nextCharge: { totalUsd: 0 },
      serviceCredits: {
        availableUsd: 10,
        reservedUsd: 2,
        usedUsd: 3,
        promoUsd: 4
      },
      transactions: []
    };
    const credits = {
      ok: true,
      organizationId: "org-1",
      generatedAtMs: 1_719_230_000_000,
      serviceCredits: billing.serviceCredits
    };
    const transactions = {
      ok: true,
      transactions: [{
        txId: "tx-1",
        orgId: "org-1",
        applicationId: "app-1",
        kind: "credit_issued",
        asset: "USD",
        amount: "10.000000",
        status: "settled",
        txRef: "private-provider-reference",
        memo: "private billing memo",
        createdAtMs: 1_719_230_000_000
      }]
    };
    const expected = new Map([
      ["https://slipway.test/api/organizations", organizations],
      ["https://slipway.test/api/organizations/org-1/billing", billing],
      ["https://slipway.test/api/organizations/org-1/service-credits", credits],
      ["https://slipway.test/api/organizations/org-1/billing/transactions?limit=25&before=1719230000000", transactions]
    ]);
    const requested: string[] = [];
    const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const href = String(url);
      requested.push(href);
      assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
      return jsonResponse(expected.get(href));
    };

    for (const [run, body] of [
      [
        () => runSlipwayOrganizationList({ config: sessionFile, json: true }, { fetchImpl, stdout: current.write }),
        organizations
      ],
      [
        () => runSlipwayOrganizationBilling({ organizationId: " example-org ", config: sessionFile, json: true }, {
          fetchImpl,
          organization: "flag-loser",
          stdout: current.write
        }),
        billing
      ],
      [
        () => runSlipwayOrganizationServiceCredits({ config: sessionFile, json: true }, {
          fetchImpl,
          organization: "example-org",
          stdout: current.write
        }),
        credits
      ],
      [
        () => runSlipwayOrganizationTransactions({
          organizationId: "org-1",
          limit: 25,
          beforeMs: 1_719_230_000_000,
          config: sessionFile,
          json: true
        }, { fetchImpl, stdout: current.write }),
        transactions
      ]
    ] as const) {
      var current = writer();
      assert.equal(await run(), 0);
      assert.equal(current.text, `${JSON.stringify(body)}\n`);
      assert.equal(current.text.includes(token), false);
    }
    assert.deepEqual(requested, [
      "https://slipway.test/api/organizations",
      "https://slipway.test/api/organizations",
      "https://slipway.test/api/organizations/org-1/billing",
      "https://slipway.test/api/organizations",
      "https://slipway.test/api/organizations/org-1/service-credits",
      "https://slipway.test/api/organizations",
      "https://slipway.test/api/organizations/org-1/billing/transactions?limit=25&before=1719230000000"
    ]);
  });

  it("formats organization and execution history reads without leaking private fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "human_read_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });
    const out = writer();
    const fetchImpl = async (url: URL | RequestInfo): Promise<Response> => {
      if (String(url).endsWith("/api/organizations")) {
        return jsonResponse({
          ok: true,
          organizations: [{
            id: "org-1",
            name: "Example Org",
            slug: "example-org",
            isPersonal: false,
            role: "owner"
          }]
        });
      }
      if (String(url).endsWith("/billing")) {
        return jsonResponse({
          ok: true,
          organization: {
            id: "org-1",
            name: "Example Org",
            slug: "example-org",
            isPersonal: false,
            role: "owner"
          },
          plan: { id: "starter", name: "Starter" },
          nextCharge: { totalUsd: 0 },
          serviceCredits: {
            availableUsd: 10,
            reservedUsd: 2,
            usedUsd: 3,
            promoUsd: 4
          }
        });
      }
      if (String(url).includes("/billing/transactions")) {
        return jsonResponse({
          ok: true,
          transactions: [{
            txId: "tx-safe",
            orgId: "org-1",
            applicationId: "app-safe",
            kind: "deploy_spend",
            asset: "USD",
            amount: "-1.250000",
            status: "reserved",
            txRef: "provider-secret-reference",
            memo: "private memo",
            createdAtMs: 1_719_230_000_000
          }]
        });
      }
      return jsonResponse({
        ok: true,
        attempts: [{
          executionId: "exec-safe",
          planItemId: "plan-safe",
          idempotencyKey: "secret-idempotency-key",
          status: "reviewed_failed",
          operatorReviewReason: "chain pending",
          updatedAtMs: 1_719_230_000_000,
          receipt: { signedPayload: "private-chain-payload" }
        }],
        count: 1,
        total: 3,
        nextOffset: 2
      });
    };
    assert.equal(await runSlipwayOrganizationBilling({
      organizationId: "org-1",
      config: sessionFile
    }, { fetchImpl, stdout: out.write }), 0);
    assert.equal(await runSlipwayOrganizationTransactions({
      organizationId: "org-1",
      config: sessionFile
    }, { fetchImpl, stdout: out.write }), 0);
    assert.equal(await runSlipwayCustodyExecutionList({
      applicationRef: "app-safe",
      config: sessionFile
    }, { fetchImpl, stdout: out.write }), 0);
    assert.match(out.text, /tx-safe/u);
    assert.match(out.text, /exec-safe/u);
    assert.match(out.text, /Next charge: \$0\.00/u);
    assert.match(out.text, /returned 1, total 3, next offset 2/u);
    assert.match(out.text, /chain pending/u);
    assert.doesNotMatch(out.text, /provider-secret-reference|private memo|secret-idempotency-key|private-chain-payload/u);
    assert.equal(out.text.includes(token), false);
  });

  it("selects an organization idempotently, preserves raw JSON, and updates whoami", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "organization_use_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });
    const organization = {
      id: "org-2",
      name: "Selected Org",
      slug: "selected-org",
      isPersonal: false,
      role: "developer"
    };
    const responseBody = {
      ok: true,
      principalId: "principal-1",
      organization,
      organizations: [organization],
      serverMarker: { preserved: true }
    };
    const requests: Array<{ url: string; method?: string; body?: string; authorization?: string }> = [];
    const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      requests.push({
        url: String(url),
        method: init?.method,
        body: init?.body as string | undefined,
        authorization: (init?.headers as Record<string, string> | undefined)?.authorization
      });
      if (String(url).endsWith("/api/session/organization")) {
        return jsonResponse(responseBody);
      }
      return jsonResponse({
        ok: true,
        session: {
          sessionId: "session-1",
          identity: { kind: "github_app", login: "octo-agent" }
        },
        organization,
        organizations: [organization]
      });
    };

    for (let index = 0; index < 2; index += 1) {
      const out = writer();
      assert.equal(await runSlipwayOrganizationUse({
        organizationId: "org-2",
        config: sessionFile,
        json: true
      }, { fetchImpl, stdout: out.write }), 0);
      assert.equal(out.text, `${JSON.stringify(responseBody)}\n`);
      assert.equal(out.text.includes(token), false);
    }
    const whoami = writer();
    assert.equal(await runSlipwayWhoami({
      config: sessionFile,
      json: true
    }, { fetchImpl, stdout: whoami.write }), 0);
    const whoamiBody = JSON.parse(whoami.text) as {
      organization: { id: string; slug: string; role: string };
    };
    assert.deepEqual(whoamiBody.organization, {
      id: "org-2",
      name: "Selected Org",
      slug: "selected-org",
      isPersonal: false,
      role: "developer"
    });
    assert.deepEqual(
      requests.slice(0, 4).map((request) => ({
        url: request.url,
        method: request.method,
        body: request.body,
        authorization: request.authorization
      })),
      [0, 1].flatMap(() => ([
        {
          url: "https://slipway.test/api/organizations",
          method: "GET",
          body: undefined,
          authorization: `Bearer ${token}`
        },
        {
          url: "https://slipway.test/api/session/organization",
          method: "POST",
          body: JSON.stringify({ organizationId: "org-2" }),
          authorization: `Bearer ${token}`
        }
      ]))
    );
    assert.equal(whoami.text.includes(token), false);
  });

  it("formats successful organization selection for humans", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "human-organization-use-token",
      savedAtMs: 0
    }, { config: sessionFile });
    const out = writer();
    assert.equal(await runSlipwayOrganizationUse({
      organizationId: "org-2",
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        organization: {
          id: "org-2",
          name: "Selected Org",
          slug: "selected-org",
          isPersonal: false,
          role: "developer"
        },
        organizations: [{
          id: "org-2",
          name: "Selected Org",
          slug: "selected-org",
          isPersonal: false,
          role: "developer"
        }]
      }),
      stdout: out.write
    }), 0);
    assert.equal(
      out.text,
      "Using Liskov organization Selected Org (org-2, selected-org, role developer).\n"
    );
  });

  it("handles organization selection authorization, malformed, and network failures safely", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "organization_use_error_secret_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    for (const [status, responseBody, expectedError, expectedReason] of [
      [401, { ok: false, error: "unauthorized" }, "SLIPWAY_SESSION_UNAUTHORIZED", "unauthorized"],
      [403, { ok: false, error: "not_a_member" }, "not_a_member", undefined],
      [200, { ok: true, organization: { id: "org-2" } }, "SLIPWAY_ORGANIZATION_USE_FAILED", "malformed_response"]
    ] as const) {
      const out = writer();
      assert.equal(await runSlipwayOrganizationUse({
        organizationId: "org-2",
        config: sessionFile,
        json: true
      }, {
        fetchImpl: async (url) => String(url).endsWith("/api/organizations")
          ? jsonResponse({
              ok: true,
              organizations: [{
                id: "org-2",
                name: "Selected Org",
                slug: "selected-org",
                isPersonal: false,
                role: "developer"
              }]
            })
          : jsonResponse(responseBody, status),
        stdout: out.write
      }), 1);
      const parsed = JSON.parse(out.text) as { error: string; reason?: string };
      assert.equal(parsed.error, expectedError);
      assert.equal(parsed.reason, expectedReason);
      assert.equal(out.text.includes(token), false);
    }

    const network = writer();
    assert.equal(await runSlipwayOrganizationUse({
      organizationId: "org-2",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async () => {
        throw new Error("network offline");
      },
      stdout: network.write
    }), 1);
    const networkBody = JSON.parse(network.text) as { error: string; message: string };
    assert.equal(networkBody.error, "SLIPWAY_ORGANIZATION_USE_FAILED");
    assert.match(networkBody.message, /network offline/u);
    assert.equal(network.text.includes(token), false);
  });

  it("handles unauthorized, forbidden, and malformed organization responses without token leakage", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "organization_error_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    for (const [status, responseBody, expectedError] of [
      [401, { ok: false, error: "unauthorized" }, "SLIPWAY_SESSION_UNAUTHORIZED"],
      [403, { ok: false, error: "not_a_member" }, "not_a_member"],
      [200, { ok: true, organizations: "not-an-array" }, "SLIPWAY_ORGANIZATION_LIST_FAILED"]
    ] as const) {
      const out = writer();
      const code = await runSlipwayOrganizationList({
        config: sessionFile,
        json: true
      }, {
        fetchImpl: async () => jsonResponse(responseBody, status),
        stdout: out.write
      });
      assert.equal(code, 1);
      const parsed = JSON.parse(out.text) as { error: string; reason?: string };
      assert.equal(parsed.error, expectedError);
      if (status === 200) assert.equal(parsed.reason, "malformed_response");
      assert.equal(out.text.includes(token), false);
    }
  });

  it("lists only tombstones with the deleted Application view", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "deleted-list-token",
      savedAtMs: 0
    }, { config: sessionFile });
    let requestedUrl = "";
    const out = writer();
    const code = await runSlipwayApplicationList({
      config: sessionFile,
      deleted: true,
      json: true
    }, {
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return jsonResponse({
          ok: true,
          count: 2,
          applications: [
            { applicationUid: "app-active", applicationName: "active", status: "active" },
            { applicationUid: "app-deleted", applicationName: "deleted", status: "deleted", deletedAtMs: 42 }
          ]
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.equal(requestedUrl, "https://slipway.test/api/applications?includeDeleted=true");
    const parsed = JSON.parse(out.text) as { count: number; applications: Array<{ applicationUid: string }> };
    assert.equal(parsed.count, 1);
    assert.deepEqual(parsed.applications.map((application) => application.applicationUid), ["app-deleted"]);
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

  it("previews Application deletion with GET only and preserves raw JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_delete_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: string }> = [];
    const out = writer();
    const serverBody = {
      ok: true,
      dryRun: true,
      deleted: false,
      changed: false,
      application: {
        applicationUid: "app-1111111111111111",
        applicationName: "alpha",
        applicationId: "legacy-alpha",
        ownerAddress: "5 owner/+?",
        status: "active"
      },
      impact: {
        activeDeploymentCount: 1,
        liveJobCount: 2,
        pendingOperationCount: 1,
        hasLiveOrPendingResources: true,
        stopsFuturePlanning: true,
        existingResourcesContinue: true
      }
    };
    const code = await runSlipwayApplicationDelete({
      applicationRef: "alpha/beta",
      owner: "5 owner/+?",
      reason: "cleanup",
      acknowledgeLiveResources: true,
      force: true,
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: init?.body === undefined ? undefined : String(init.body)
        });
        return jsonResponse(serverBody);
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha%2Fbeta/deletion-preview?owner=5+owner%2F%2B%3F",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
    }]);
    assert.equal(out.text.includes(token), false);
    assert.deepEqual(JSON.parse(out.text), serverBody);
  });

  it("requires a reason before confirmed Application deletion", async () => {
    const out = writer();
    let calls = 0;
    const code = await runSlipwayApplicationDelete({
      applicationRef: "app-1111111111111111",
      yes: true,
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
    const parsed = JSON.parse(out.text) as { error: string };
    assert.equal(parsed.error, "SLIPWAY_APPLICATION_DELETE_REASON_REQUIRED");
  });

  it("uses guarded DELETE only for confirmed Application deletion", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_confirmed_delete_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: unknown }> = [];
    const serverBody = {
      ok: true,
      dryRun: false,
      deleted: true,
      changed: true,
      application: {
        applicationUid: "app-1111111111111111",
        applicationName: "alpha",
        applicationId: "legacy-alpha",
        ownerAddress: "5owner",
        status: "deleted"
      },
      impact: {
        activeDeploymentCount: 1,
        liveJobCount: 0,
        pendingOperationCount: 0,
        hasLiveOrPendingResources: true,
        stopsFuturePlanning: true,
        existingResourcesContinue: true
      }
    };
    const out = writer();
    const code = await runSlipwayApplicationDelete({
      applicationRef: "app-1111111111111111",
      owner: "5owner",
      reason: "retired",
      acknowledgeLiveResources: true,
      force: true,
      yes: true,
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body ?? "{}"))
        });
        return jsonResponse(serverBody);
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/app-1111111111111111?owner=5owner",
      method: "DELETE",
      authorization: `Bearer ${token}`,
      body: {
        confirm: true,
        acknowledgeLiveResources: true,
        force: true,
        reason: "retired"
      }
    }]);
    assert.deepEqual(JSON.parse(out.text), serverBody);
    assert.equal(out.text.includes(token), false);
  });

  it("renders an immutable deletion receipt as already tombstoned", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_deleted_receipt_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const out = writer();
    const code = await runSlipwayApplicationDelete({
      applicationRef: "app-1111111111111111",
      config: sessionFile
    }, {
      fetchImpl: async (_url, init) => {
        assert.equal(init?.method, "GET");
        assert.equal(init?.body, undefined);
        return jsonResponse({
          ok: true,
          dryRun: false,
          deleted: true,
          changed: false,
          application: {
            applicationUid: "app-1111111111111111",
            applicationName: "alpha",
            applicationId: "legacy-alpha",
            ownerAddress: "5owner",
            status: "deleted"
          },
          impact: {
            activeDeploymentCount: 0,
            liveJobCount: 0,
            pendingOperationCount: 0,
            hasLiveOrPendingResources: false,
            stopsFuturePlanning: true,
            existingResourcesContinue: true
          }
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.match(out.text, /alpha is already tombstoned\./u);
    assert.doesNotMatch(out.text, /Deleted alpha\./u);
    assert.equal(out.text.includes(token), false);
  });

  it("handles deletion-preview authorization, malformed, and network failures without leaking the bearer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_delete_failure_secret_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    for (const [response, expectedError] of [
      [jsonResponse({ ok: false, error: "unauthorized" }, 401), "SLIPWAY_SESSION_UNAUTHORIZED"],
      [jsonResponse({ ok: false, error: "application_not_authorized" }, 403), "SLIPWAY_APPLICATION_DELETE_FAILED"],
      [new Response("not-json", { status: 502 }), "SLIPWAY_APPLICATION_DELETE_FAILED"]
    ] as const) {
      const out = writer();
      const code = await runSlipwayApplicationDelete({
        applicationRef: "alpha",
        config: sessionFile,
        json: true
      }, {
        fetchImpl: async (_url, init) => {
          assert.equal(init?.method, "GET");
          assert.equal(init?.body, undefined);
          return response;
        },
        stdout: out.write
      });
      assert.equal(code, 1);
      assert.equal((JSON.parse(out.text) as { error: string }).error, expectedError);
      assert.equal(out.text.includes(token), false);
    }

    const network = writer();
    const networkCode = await runSlipwayApplicationDelete({
      applicationRef: "alpha",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async () => {
        throw new Error("network offline");
      },
      stdout: network.write
    });
    assert.equal(networkCode, 1);
    const networkBody = JSON.parse(network.text) as { error: string; message: string };
    assert.equal(networkBody.error, "SLIPWAY_APPLICATION_DELETE_FAILED");
    assert.match(networkBody.message, /network offline/u);
    assert.equal(network.text.includes(token), false);
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

    const requests: Array<{ url: string; method?: string; authorization?: string; body?: string }> = [];
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
          body: init?.body === undefined ? undefined : String(init.body)
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
      url: "https://slipway.test/api/applications/shared/deletion-preview",
      method: "GET",
      authorization: `Bearer ${token}`,
      body: undefined
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

  it("creates an Application from identity alone without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_create_secret_token_do_not_print";
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
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        requests.push({
          url: String(url),
          method: init?.method,
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body
        });
        return jsonResponse({
          ok: true,
          application: {
            applicationUid: "app-2222222222222222",
            applicationName: "shard-worker",
            applicationId: "shard-worker",
            displayName: body.displayName
          }
        });
      },
      stdout: out.write
    };

    const code = await runSlipwayApplicationCreate({
      applicationId: "shard-worker",
      displayName: "Shard Worker",
      repository: "proof-computer/shard-worker",
      config: sessionFile,
      json: true
    }, options);

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: {
        applicationId: "shard-worker",
        displayName: "Shard Worker",
        repository: "proof-computer/shard-worker"
      }
    }]);
    assert.equal(out.text.includes(token), false);
    const output = JSON.parse(out.text.trim()) as { ok: boolean; application: { applicationUid: string } };
    assert.equal(output.ok, true);
    assert.equal(output.application.applicationUid, "app-2222222222222222");
  });

  it("rejects an empty create application id before making any request", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "slipway_create_invalid_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    let calls = 0;
    const out = writer();
    const code = await runSlipwayApplicationCreate({
      applicationId: "   ",
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
    const output = JSON.parse(out.text.trim()) as { ok: boolean; error: string };
    assert.equal(output.ok, false);
    assert.equal(output.error, "SLIPWAY_APPLICATION_CREATE_INVALID");
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
          from: { displayName: "Slipway diagnostic" },
          to: { displayName: body.displayName },
          application: {
            applicationUid: "app-1111111111111111",
            applicationName: "slipway-diagnostic",
            applicationId: "legacy-diagnostic",
            displayName: body.displayName
          }
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
    const outputs = out.text.trim().split(/\n(?=\{)/u).map((line) => JSON.parse(line) as { ok: boolean; dryRun: boolean; to: { displayName: string }; application: { applicationName: string } });
    assert.equal(outputs[0]?.ok, true);
    assert.equal(outputs[0]?.dryRun, true);
    assert.equal(outputs[0]?.to.displayName, "Liskov Diagnostic");
    assert.equal(outputs[0]?.application.applicationName, "slipway-diagnostic");
    assert.equal(outputs[1]?.dryRun, false);
    assert.equal(outputs[1]?.application.applicationName, "slipway-diagnostic");
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
    }, {
      url: "https://slipway.test/api/applications/alpha/policy?view=explanation",
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
          return jsonResponse({ ok: true, child: { childSessionId: "child-1" }, grant: { grantId: "grant-1" } });
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
      runSlipwayApplicationLockboxGrantVerify({ applicationRef: "alpha", grantId: "grant-1", config: sessionFile, json: true }, options)
    ];
    const codes = await Promise.all(commands);
    assert.deepEqual(codes, [1, 1, 1, 1, 1, 1]);
    assert.match(out.text, /CONFIRMATION_REQUIRED/u);
  });

  it("validates publish-paused reason before confirmation or network I/O", async () => {
    const out = writer();
    const code = await runSlipwayApplicationPublish({
      applicationRef: "alpha",
      json: true,
      paused: true,
      reason: "   ",
      yes: true
    }, {
      fetchImpl: async () => {
        throw new Error("network should not be called");
      },
      stdout: out.write
    });
    assert.equal(code, 1);
    const body = JSON.parse(out.text) as { error: string };
    assert.equal(body.error, "SLIPWAY_APPLICATION_PUBLISH_PAUSED_REASON_REQUIRED");
  });

  it("preflights publication, fences the observed manifest digest, and supports read-only dry-run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "publish-fence-token",
      savedAtMs: 0
    }, { config: sessionFile });
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const options = {
      fetchImpl: async (url: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        requests.push({ url: String(url), body });
        if (String(url).endsWith("/publish/preflight")) {
          return jsonResponse({
            ok: true,
            manifestValid: true,
            releaseResolved: true,
            policyValid: true,
            targetSupported: true,
            entitled: true,
            publicationEnabled: true,
            publicationReady: true,
            authoredDigest: "a".repeat(64),
            releaseIntentDigest: "b".repeat(64),
            policyDigest: "c".repeat(64),
            artifactVersionId: "av-test"
          });
        }
        return jsonResponse({ ok: true, policy: { policyVersionId: "pv-test" } });
      },
      stdout: writer().write
    };

    assert.equal(await runSlipwayApplicationPublish({
      applicationRef: "alpha",
      artifactVersion: "av-test",
      config: sessionFile,
      json: true,
      yes: true
    }, options), 0);
    assert.deepEqual(requests, [
      {
        url: "https://slipway.test/api/applications/alpha/publish/preflight",
        body: { artifactVersionId: "av-test" }
      },
      {
        url: "https://slipway.test/api/applications/alpha/publish",
        body: {
          expectedAuthoredDigest: "a".repeat(64),
          artifactVersionId: "av-test"
        }
      }
    ]);

    requests.length = 0;
    assert.equal(await runSlipwayApplicationPublish({
      applicationRef: "alpha",
      artifactVersion: "av-test",
      config: sessionFile,
      dryRun: true,
      json: true
    }, options), 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/publish/preflight",
      body: { artifactVersionId: "av-test" }
    }]);
  });

  it("publishes a validated retained V5 source document through the registered writer with exact evidence", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-v5-publish-"));
    const sessionFile = path.join(dir, "session.json");
    const manifestPath = path.join(dir, "manifest.json");
    const token = "registered_v5_publish_token_do_not_print";
    const artifactDigest = `sha256:${"a".repeat(64)}`;
    const document = retainedV5SourceManifest("alpha");
    await writeFile(manifestPath, JSON.stringify(document), "utf8");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; authorization?: string; body: unknown }> = [];
    const out = writer();
    const code = await runSlipwayApplicationPolicyPublish({
      applicationRef: "alpha",
      artifactDigest,
      bindingRevision: 1,
      config: sessionFile,
      expectedPointerVersion: 0,
      file: manifestPath,
      json: true,
      revocationEpoch: 0,
      sourceCommit: "b".repeat(40),
      sourceRef: "refs/heads/main",
      workflowIdentity: "proof-computer/alpha/.github/workflows/release.yml@refs/heads/main",
      yes: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body))
        });
        return jsonResponse({
          ok: true,
          policyVersion: {
            schema: "proof.liskov.application-policy",
            schemaVersion: 5,
            policyVersionId: "alpha-v1",
            activePointerVersion: 1,
            handlerGeneration: 2
          }
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/policy-versions",
      authorization: `Bearer ${token}`,
      body: {
        document,
        release: {
          mode: "source",
          artifactDigest,
          build: {
            bindingRevision: 1,
            revocationEpoch: 0,
            sourceRef: "refs/heads/main",
            sourceCommit: "b".repeat(40),
            workflowIdentity: "proof-computer/alpha/.github/workflows/release.yml@refs/heads/main",
            artifactDigests: [artifactDigest]
          }
        },
        expectedActivePointerVersion: 0
      }
    }]);
    assert.equal(out.text.includes(token), false);
    const output = JSON.parse(out.text) as { ok: boolean; policyVersion: { policyVersionId: string } };
    assert.equal(output.ok, true);
    assert.equal(output.policyVersion.policyVersionId, "alpha-v1");
  });

  it("refuses registered V5 publication without confirmation or with an invalid document before network I/O", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-v5-publish-refusal-"));
    const invalidManifestPath = path.join(dir, "invalid.json");
    await writeFile(invalidManifestPath, JSON.stringify({ schemaVersion: 4 }), "utf8");
    const base = {
      applicationRef: "alpha",
      artifactDigest: `sha256:${"a".repeat(64)}`,
      bindingRevision: 1,
      expectedPointerVersion: 0,
      file: invalidManifestPath,
      json: true,
      revocationEpoch: 0,
      sourceCommit: "b".repeat(40),
      sourceRef: "refs/heads/main",
      workflowIdentity: "proof-computer/alpha/.github/workflows/release.yml@refs/heads/main"
    };
    const out = writer();
    const options = {
      fetchImpl: async () => {
        throw new Error("network should not be called");
      },
      stdout: out.write
    };

    assert.equal(await runSlipwayApplicationPolicyPublish(base, options), 1);
    assert.equal(await runSlipwayApplicationPolicyPublish({ ...base, yes: true }, options), 1);
    const outputs = out.text.trim().split("\n").map((line) => JSON.parse(line) as { error: string });
    assert.equal(outputs[0]?.error, "SLIPWAY_APPLICATION_POLICY_PUBLISH_CONFIRMATION_REQUIRED");
    assert.equal(outputs[1]?.error, "SLIPWAY_APPLICATION_POLICY_PUBLISH_MANIFEST_INVALID");
  });

  it("reconciles executor operations with exact guards, dry-run default, JSON-only stdout, and token redaction", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const sessionToken = "slipway_reconcile_session_token_do_not_print";
    const adminToken = "slipway_reconcile_admin_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken,
      savedAtMs: 0
    }, { config: sessionFile });
    const requests: Array<{ authorization?: string; body?: unknown; url: string }> = [];
    const out = writer();
    const code = await runSlipwayAdminExecutorOperationReconcile({
      adminToken,
      config: sessionFile,
      expectApplication: "slipway-diagnostic",
      expectDeployment: "dep-1",
      expectJob: "job-1",
      expectKind: "runtime_replacement",
      expectStatus: "pending",
      json: true,
      operationId: "op-1",
      reason: "terminalize unsubmitted replacement"
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body)),
          url: String(url)
        });
        return jsonResponse({
          ok: true,
          dryRun: true,
          eligible: true,
          reconciled: false,
          idempotentReplay: false,
          operationId: "op-1",
          blockers: []
        });
      },
      stdout: out.write
    });
    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      authorization: `Bearer ${adminToken}`,
      body: {
        expectApplication: "slipway-diagnostic",
        expectDeployment: "dep-1",
        expectJob: "job-1",
        expectKind: "runtime_replacement",
        expectStatus: "pending",
        reason: "terminalize unsubmitted replacement",
        confirm: false
      },
      url: "https://slipway.test/api/admin/executor-operations/op-1/reconcile"
    }]);
    assert.equal(out.text.includes(adminToken), false);
    assert.equal(out.text.includes(sessionToken), false);
    const body = JSON.parse(out.text) as { dryRun: boolean; operationId: string };
    assert.equal(body.dryRun, true);
    assert.equal(body.operationId, "op-1");
  });

  it("resolves deploy-spend review holds with exact evidence and dry-run default", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const adminToken = "deploy_spend_admin_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "session_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });
    const requests: Array<{ authorization?: string; body?: unknown; url: string }> = [];
    const out = writer();
    const sha = "a".repeat(64);
    const code = await runSlipwayAdminDeploySpendResolve({
      reserveId: "deploy-reserve:abc",
      adminToken,
      config: sessionFile,
      expectOrganization: "org-1",
      expectApplication: "app-1",
      expectDeployment: "dep-1",
      expectExecution: "exec-1",
      expectBillingTransaction: "deploy-spend:abc",
      expectStatus: "review_required",
      finalUsdMicros: 25_000,
      evidenceRef: "case:123",
      evidenceSha256: sha,
      reason: "manual adjudication",
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body)),
          url: String(url)
        });
        return jsonResponse({
          ok: true,
          dryRun: true,
          eligible: true,
          resolved: false,
          idempotentReplay: false,
          reserveId: "deploy-reserve:abc",
          blockers: []
        });
      },
      stdout: out.write
    });
    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      authorization: `Bearer ${adminToken}`,
      body: {
        expectOrganization: "org-1",
        expectApplication: "app-1",
        expectDeployment: "dep-1",
        expectExecution: "exec-1",
        expectBillingTransaction: "deploy-spend:abc",
        expectStatus: "review_required",
        finalUsdMicros: 25_000,
        evidenceRef: "case:123",
        evidenceSha256: sha,
        reason: "manual adjudication",
        confirm: false
      },
      url: "https://slipway.test/api/admin/billing/deploy-spend/deploy-reserve%3Aabc/resolve"
    }]);
    assert.equal(out.text.includes(adminToken), false);
    assert.equal((JSON.parse(out.text) as { dryRun: boolean }).dryRun, true);
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
          count: 1,
          total: 1,
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
    assert.equal(await runSlipwayCustodyExecutionList({
      applicationRef: "alpha",
      config: sessionFile,
      json: true,
      limit: 25,
      offset: 5,
      statuses: ["submitted", "observed"],
      reasons: ["chain_pending"]
    }, options), 0);
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
    assert.equal(await runSlipwayCustodyExecutionRecover({ applicationRef: "alpha", executionId: "exec-1", reason: "expired registration; reclaim escrow", mode: "abandon", config: sessionFile, json: true, yes: true }, options), 0);
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
      url: "https://slipway.test/api/applications/alpha/live-custody/executions?limit=25&offset=5&status=submitted&status=observed&reason=chain_pending",
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
      body: { yesRecover: true, acknowledgement: "operator-reviewed", reason: "expired registration; reclaim escrow", mode: "abandon" }
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
          actionPlan: { count: 2, items: [{ planItemId: "plan-1", kind: "acurast.deploy" }, { planItemId: "plan-2", kind: "acurast.setEnvironment" }] },
          launchEligibility: launchEligibility("eligible_now"),
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
    assert.match(out.text, /Launch eligibility: eligible now \(eligible_now\); evidence test_authority\./u);
    assert.match(out.text, /Reclaim: 7 candidate\(s\), 2 reclaimable, 1 blocked, 1 failed, 1 already reclaimed, 1 already deregistered, 1 skipped by limit\./u);
    assert.match(out.text, /copy both planItemId and the opaque idempotencyKey from the same custodial\.live actionPlan item/u);
    assert.equal(out.text.includes(token), false);
  });

  it("requests and labels the paused read-only custody preflight preview", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_paused_preflight_secret_token_do_not_print";
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
      config: sessionFile,
      previewPaused: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization
        });
        return jsonResponse({
          ok: true,
          mode: "paused_preview",
          readOnly: true,
          submitAllowed: false,
          actionPlan: { count: 0, items: [] },
          pausedPreview: {
            status: "ready",
            readOnly: true,
            submitAllowed: false,
            itemCount: 1,
            readyCount: 1,
            launchEligibility: launchEligibility("eligible_now"),
            items: [{
              planItemId: "preview-plan-1",
              previewOnly: true,
              submitAllowed: false,
              selection: { processorIds: ["5PreviewProcessor"] }
            }]
          }
        });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://slipway.test/api/applications/alpha/live-custody/preflight?previewPaused=true",
      method: "GET",
      authorization: `Bearer ${token}`
    }]);
    assert.match(out.text, /Paused read-only preflight for alpha: ready; 1\/1 deploy item\(s\) ready\. Launch eligibility: eligible now \(eligible_now\); evidence test_authority\. Submission is disabled\./u);
    assert.equal(out.text.includes("preview-plan-1"), false);
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

  it("refreshes a clock-changed run-one plan id by its unchanged opaque idempotency key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_run_one_refresh_token_do_not_print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const requests: Array<{ url: string; method: string; authorization?: string; organization?: string; body?: Record<string, unknown> }> = [];
    const out = writer();
    const code = await runSlipwayCustodyExecutionRunOne({
      applicationRef: "app-uid-1",
      planItemId: "deploy-plan-from-earlier-clock",
      idempotencyKey: "opaque-stable-key",
      expectKind: "acurast.deploy",
      expectPolicyDigest: "policy-digest-1",
      config: sessionFile,
      json: true,
      yes: true,
      yesSpend: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          organization: (init?.headers as Record<string, string> | undefined)?.["x-liskov-organization"],
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        });
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse(runOnePreflight([
            runOnePreflightPlan({
              planItemId: "deploy-plan-from-current-clock",
              idempotencyKey: "opaque-stable-key"
            })
          ]));
        }
        return jsonResponse({ ok: true, mode: "submit", attempt: { executionId: "exec-1", status: "submitted" } });
      },
      organization: "  org-concurrent  ",
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`), [
      "GET /api/applications/app-uid-1/live-custody/preflight",
      "POST /api/applications/app-uid-1/live-custody/executions/run-one"
    ]);
    assert.deepEqual(requests[1]?.body, {
      expectedKind: "acurast.deploy",
      expectedPolicyDigest: "policy-digest-1",
      yes: true,
      acknowledgement: "run-one",
      planItemId: "deploy-plan-from-current-clock",
      idempotencyKey: "opaque-stable-key",
      yesSpend: true,
      spendAcknowledgement: "yes-spend"
    });
    assert.deepEqual(requests.map((request) => request.authorization), [
      `Liskov-Organization ${token}`,
      `Liskov-Organization ${token}`
    ]);
    assert.deepEqual(requests.map((request) => request.organization), ["org-concurrent", "org-concurrent"]);
    assert.equal(out.text.includes(token), false);
  });

  it("rejects unsafe run-one preflight selections without making a run-one POST", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "slipway_run_one_rejection_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    const cases: Array<{
      name: string;
      items: Record<string, unknown>[];
      input?: Partial<Parameters<typeof runSlipwayCustodyExecutionRunOne>[0]>;
      reason: string;
      field?: string;
      counts?: Record<string, number>;
    }> = [
      {
        name: "caller-generated replacement key",
        items: [runOnePreflightPlan()],
        input: { planItemId: "expired-clock-plan", idempotencyKey: "caller-generated-key" },
        reason: "plan_item_not_found",
        counts: { planItemMatches: 0, idempotencyMatches: 0 }
      },
      {
        name: "plan/key pair mismatch",
        items: [
          runOnePreflightPlan({ planItemId: "plan-1", idempotencyKey: "key-1" }),
          runOnePreflightPlan({ planItemId: "plan-2", idempotencyKey: "key-2" })
        ],
        input: { planItemId: "plan-1", idempotencyKey: "key-2" },
        reason: "live_custody_run_one_plan_guard_mismatch",
        counts: { planItemMatches: 1, idempotencyMatches: 1 }
      },
      {
        name: "duplicate stable key",
        items: [
          runOnePreflightPlan({ planItemId: "fresh-plan-1", idempotencyKey: "duplicate-key" }),
          runOnePreflightPlan({ planItemId: "fresh-plan-2", idempotencyKey: "duplicate-key" })
        ],
        input: { planItemId: "expired-plan", idempotencyKey: "duplicate-key" },
        reason: "live_custody_run_one_ambiguous_plan_item",
        counts: { matches: 2 }
      },
      {
        name: "stale policy",
        items: [runOnePreflightPlan({ policyDigest: "new-policy-digest" })],
        reason: "live_custody_run_one_guard_mismatch",
        field: "policyDigest"
      },
      {
        name: "wrong kind",
        items: [runOnePreflightPlan({ kind: "acurast.setEnvironment" })],
        reason: "live_custody_run_one_guard_mismatch",
        field: "kind"
      },
      {
        name: "wrong deployment",
        items: [runOnePreflightPlan({ deploymentId: "778" })],
        input: { expectDeploymentId: "777" },
        reason: "live_custody_run_one_guard_mismatch",
        field: "deploymentId"
      },
      {
        name: "blocked plan",
        items: [runOnePreflightPlan({ blockers: [{ code: "missing_processor" }] })],
        reason: "live_custody_plan_blocked",
        field: "blockers",
        counts: { blockerCount: 1 }
      },
      {
        name: "malformed live plan",
        items: [runOnePreflightPlan({ idempotencyKey: "" })],
        reason: "invalid_live_custody_plan_item",
        field: "actionPlan.items",
        counts: { malformedCount: 1, livePlanCount: 1 }
      },
      {
        name: "concurrent child creation removes the plan",
        items: [],
        reason: "plan_item_not_found",
        counts: { planItemMatches: 0, idempotencyMatches: 0 }
      }
    ];

    for (const testCase of cases) {
      let requestCount = 0;
      const out = writer();
      const code = await runSlipwayCustodyExecutionRunOne({
        applicationRef: "app-uid-1",
        planItemId: "plan-1",
        idempotencyKey: "key-1",
        expectKind: "acurast.deploy",
        expectPolicyDigest: "policy-digest-1",
        config: sessionFile,
        json: true,
        yes: true,
        yesSpend: true,
        ...testCase.input
      }, {
        fetchImpl: async (_url, init) => {
          requestCount += 1;
          assert.equal(init?.method ?? "GET", "GET", `${testCase.name} must not POST`);
          return jsonResponse(runOnePreflight(testCase.items));
        },
        stdout: out.write
      });

      assert.equal(code, 1, testCase.name);
      assert.equal(requestCount, 1, testCase.name);
      const parsed = JSON.parse(out.text) as Record<string, unknown>;
      assert.equal(parsed.error, "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_PREFLIGHT_REJECTED", testCase.name);
      assert.equal(parsed.reason, testCase.reason, testCase.name);
      if (testCase.field) assert.equal(parsed.field, testCase.field, testCase.name);
      for (const [field, value] of Object.entries(testCase.counts ?? {})) {
        assert.equal(parsed[field], value, `${testCase.name}: ${field}`);
      }
      assert.equal(out.text.includes("slipway_run_one_rejection_token_do_not_print"), false, testCase.name);
    }
  });

  it("requires explicit canary lifecycle proof and emits a deterministic recovery handle", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_run_one_canary_token_do_not_print";
    const idempotencyKey = "opaque-canary-key-do-not-print";
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });

    const invoke = async (lifecyclePolicy: Record<string, unknown>) => {
      let requestCount = 0;
      const out = writer();
      const err = writer();
      const code = await runSlipwayCustodyExecutionRunOne({
        applicationRef: "app-uid-1",
        planItemId: "plan-1",
        idempotencyKey,
        expectKind: "acurast.deploy",
        expectPolicyDigest: "policy-digest-1",
        requireEnvironmentBootstrap: true,
        minimumEnvironmentRunwayMs: 580_000,
        minimumRuntimeDurationMs: 3_600_000,
        requireOneGeneration: true,
        requireZeroRetries: true,
        config: sessionFile,
        json: true,
        yes: true,
        yesSpend: true
      }, {
        fetchImpl: async (_url, init) => {
          requestCount += 1;
          if ((init?.method ?? "GET") === "GET") {
            return jsonResponse({
              ...runOnePreflight([runOnePreflightPlan({ idempotencyKey })]),
              lifecyclePolicy
            });
          }
          throw new Error("response interrupted after acceptance became possible");
        },
        stdout: out.write,
        stderr: err.write
      });
      return { code, err, out, requestCount };
    };

    const missingEnvironment = await invoke({
      activePolicyFound: true,
      serverEnvironmentRequired: true,
      setEnvironmentEnabled: false,
      environmentReady: false,
      maxGenerations: 1,
      oneGenerationFenced: true
    });
    assert.equal(missingEnvironment.code, 1);
    assert.equal(missingEnvironment.requestCount, 1);
    assert.equal(
      (JSON.parse(missingEnvironment.out.text) as Record<string, unknown>).reason,
      "environment_bootstrap_not_ready"
    );

    const disabledOwnedBootstrap = await invoke({
      activePolicyFound: true,
      serverEnvironmentRequired: false,
      bootstrapDelivery: "acurast-set-environment",
      setEnvironmentEnabled: true,
      serverEnvironmentHandoffEnabled: false,
      serverEnvironmentHandoffApplicationAllowed: true,
      environmentReady: true
    });
    assert.equal(disabledOwnedBootstrap.code, 1);
    assert.equal(disabledOwnedBootstrap.requestCount, 1);
    assert.equal(
      (JSON.parse(disabledOwnedBootstrap.out.text) as Record<string, unknown>).reason,
      "environment_bootstrap_not_ready"
    );

    const missingGenerationFence = await invoke({
      activePolicyFound: true,
      serverEnvironmentRequired: true,
      setEnvironmentEnabled: true,
      environmentReady: true,
      maxGenerations: null,
      oneGenerationFenced: false
    });
    assert.equal(missingGenerationFence.code, 1);
    assert.equal(missingGenerationFence.requestCount, 1);
    assert.equal(
      (JSON.parse(missingGenerationFence.out.text) as Record<string, unknown>).reason,
      "one_generation_fence_not_ready"
    );

    const missingZeroRetryFence = await invoke({
      activePolicyFound: true,
      serverEnvironmentRequired: true,
      setEnvironmentEnabled: true,
      environmentReady: true,
      maxGenerations: 1,
      oneGenerationFenced: true,
      maxAutoRetries: 5,
      maxRuntimeReplaces: 2,
      zeroRecoveryRetriesFenced: false,
      environmentBootstrapRunwayMs: 580_000
    });
    assert.equal(missingZeroRetryFence.code, 1);
    assert.equal(missingZeroRetryFence.requestCount, 1);
    assert.equal(
      (JSON.parse(missingZeroRetryFence.out.text) as Record<string, unknown>).reason,
      "zero_recovery_retries_not_ready"
    );

    const shortEnvironmentRunway = await invoke({
      activePolicyFound: true,
      serverEnvironmentRequired: true,
      setEnvironmentEnabled: true,
      environmentReady: true,
      maxGenerations: 1,
      oneGenerationFenced: true,
      maxAutoRetries: 0,
      maxRuntimeReplaces: 0,
      zeroRecoveryRetriesFenced: true,
      environmentBootstrapRunwayMs: 160_000
    });
    assert.equal(shortEnvironmentRunway.code, 1);
    assert.equal(shortEnvironmentRunway.requestCount, 1);
    assert.equal(
      (JSON.parse(shortEnvironmentRunway.out.text) as Record<string, unknown>).reason,
      "environment_bootstrap_runway_too_short"
    );

    const shortRuntimeDuration = await invoke({
      activePolicyFound: true,
      serverEnvironmentRequired: true,
      setEnvironmentEnabled: true,
      environmentReady: true,
      maxGenerations: 1,
      oneGenerationFenced: true,
      maxAutoRetries: 0,
      maxRuntimeReplaces: 0,
      zeroRecoveryRetriesFenced: true,
      environmentBootstrapRunwayMs: 580_000,
      runtimeDurationMs: 60_000
    });
    assert.equal(shortRuntimeDuration.code, 1);
    assert.equal(shortRuntimeDuration.requestCount, 1);
    const shortRuntimeDurationBody = JSON.parse(
      shortRuntimeDuration.out.text
    ) as Record<string, unknown>;
    assert.equal(shortRuntimeDurationBody.reason, "runtime_duration_too_short");
    assert.equal(shortRuntimeDurationBody.field, "lifecyclePolicy.runtimeDurationMs");
    assert.equal(shortRuntimeDurationBody.minimumRuntimeDurationMs, 3_600_000);
    assert.equal(shortRuntimeDurationBody.runtimeDurationMs, 60_000);

    const interrupted = await invoke({
      activePolicyFound: true,
      serverEnvironmentRequired: false,
      bootstrapDelivery: "acurast-set-environment",
      setEnvironmentEnabled: true,
      serverEnvironmentHandoffEnabled: true,
      serverEnvironmentHandoffApplicationAllowed: true,
      environmentReady: true,
      maxGenerations: 1,
      oneGenerationFenced: true,
      maxAutoRetries: 0,
      maxRuntimeReplaces: 0,
      zeroRecoveryRetriesFenced: true,
      environmentBootstrapRunwayMs: 580_000,
      runtimeDurationMs: 3_600_000
    });
    const expectedExecutionId = `live-execution:${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
    const interruptedBody = JSON.parse(interrupted.out.text) as Record<string, unknown>;
    assert.equal(interrupted.code, 1);
    assert.equal(interrupted.requestCount, 2);
    assert.equal(interruptedBody.recoveryExecutionId, expectedExecutionId);
    assert.match(String(interruptedBody.recoveryCommand), new RegExp(expectedExecutionId, "u"));
    assert.match(interrupted.err.text, new RegExp(expectedExecutionId, "u"));
    assert.equal(interrupted.out.text.includes(idempotencyKey), false);
    assert.equal(interrupted.err.text.includes(idempotencyKey), false);
    assert.equal(interrupted.out.text.includes(token), false);
  });

  it("reports UID/org authorization and preflight read failures without making a run-one POST", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: "slipway_run_one_auth_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    for (const response of [
      jsonResponse({ ok: false, error: "unauthorized" }, 401),
      jsonResponse({ ok: false, error: "application_not_authorized" }, 403),
      new Response("not-json", { status: 502 })
    ]) {
      let requestCount = 0;
      const out = writer();
      const code = await runSlipwayCustodyExecutionRunOne({
        applicationRef: "app-uid-1",
        planItemId: "plan-1",
        idempotencyKey: "key-1",
        expectKind: "acurast.deploy",
        expectPolicyDigest: "policy-digest-1",
        config: sessionFile,
        json: true,
        yes: true,
        yesSpend: true
      }, {
        fetchImpl: async (_url, init) => {
          requestCount += 1;
          assert.equal(init?.method ?? "GET", "GET");
          return response;
        },
        stdout: out.write
      });

      assert.equal(code, 1);
      assert.equal(requestCount, 1);
      const parsed = JSON.parse(out.text) as Record<string, unknown>;
      assert.equal(parsed.error, "SLIPWAY_CUSTODY_EXECUTION_RUN_ONE_PREFLIGHT_FAILED");
      assert.equal(out.text.includes("slipway_run_one_auth_token_do_not_print"), false);
      assert.equal(out.text.includes(sessionFile), false);
    }
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
        if (String(url).endsWith("/api/applications/alpha/live-custody/preflight")) {
          return jsonResponse(runOnePreflight([
            runOnePreflightPlan({
              planItemId: "set-env-1",
              idempotencyKey: "idempotency-1",
              kind: "acurast.setEnvironment",
              deploymentId: "deployment-1"
            })
          ]));
        }
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
      "GET /api/applications/alpha/live-custody/preflight",
      "GET /api/applications/alpha/action-plan",
      "GET /api/applications/alpha",
      "POST /api/applications/alpha/live-custody/executions"
    ]);
    assert.deepEqual(requests[3]?.body, {
      planItemId: "set-env-1",
      idempotencyKey: "idempotency-1",
      yesSpend: true,
      acknowledgement: "yes-spend",
      environmentHandoff: handoff
    });
    assert.equal(requests[3]?.authorization, `Bearer ${token}`);
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
        if (String(url).endsWith("/api/applications/alpha/live-custody/preflight")) {
          return jsonResponse(runOnePreflight([
            runOnePreflightPlan({
              planItemId: "set-env-1",
              idempotencyKey: "idempotency-1",
              kind: "acurast.setEnvironment",
              deploymentId: "777"
            })
          ]));
        }
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
      "GET /api/applications/alpha/live-custody/preflight",
      "GET /api/applications/alpha/action-plan",
      "GET /api/applications/alpha",
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
        if (String(url).endsWith("/api/applications/alpha/live-custody/preflight")) {
          return jsonResponse(runOnePreflight([
            runOnePreflightPlan({
              planItemId: "set-env-1",
              idempotencyKey: "idempotency-1",
              kind: "acurast.setEnvironment",
              deploymentId: "777"
            })
          ]));
        }
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
      "GET /api/applications/alpha/live-custody/preflight",
      "GET /api/applications/alpha/action-plan",
      "GET /api/applications/alpha",
      "GET /api/actions/set-env-1/submit-material",
      "POST /api/applications/alpha/live-custody/executions/run-one"
    ]);
    assert.deepEqual(requests[4]?.body, {
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
    assert.equal(requests[4]?.authorization, `Bearer ${token}`);
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
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse(runOnePreflight([
            runOnePreflightPlan({
              planItemId: "set-env-1",
              idempotencyKey: "idempotency-1",
              kind: "acurast.setEnvironment",
              deploymentId: "777"
            })
          ]));
        }
        return jsonResponse({ ok: true, mode: "submit", attempt: { executionId: "exec-1", status: "submitted", receipt: { deploymentId: "777" } } });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`), [
      "GET /api/applications/alpha/live-custody/preflight",
      "POST /api/applications/alpha/live-custody/executions/run-one"
    ]);
    assert.deepEqual(requests[1]?.body, {
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
    assert.equal(requests[1]?.authorization, `Bearer ${token}`);
    assert.equal(out.text.includes(token), false);
  });

  it("imports a GitHub Application manifest through server fetch without publishing or printing the bearer token", async () => {
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
      github: "proof-computer/alpha:.liskov/application-manifest.json@main",
      serverFetch: true,
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
            path: ".liskov/application-manifest.json",
            commitSha: "a".repeat(40)
          },
          authoredDigest: "a".repeat(64),
          releaseIntentDigest: "b".repeat(64)
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
        path: ".liskov/application-manifest.json"
      }
    });
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; applicationCount: number; authoredDigest: string };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.applicationCount, 1);
    assert.equal(parsed.authoredDigest, "a".repeat(64));
  });

  it("imports a local Application manifest file without printing the bearer token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const policyFile = path.join(dir, "application-manifest.json");
    const token = "slipway_import_file_secret_token_do_not_print";
    const document = {
      schema: "proof.liskov.application-manifest",
      schemaVersion: 4,
      applicationId: "alpha",
      release: {
        mode: "pinned",
        artifact: {
          kind: "ipfs_bundle",
          cid: "ipfs://bafyalpha",
          digest: `sha256:${"a".repeat(64)}`,
          encryption: { mode: "none" }
        }
      }
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
      source: { kind: "upload", filename: "application-manifest.json" }
    });
    assert.equal(out.text.includes(token), false);
    const parsed = JSON.parse(out.text) as { ok: boolean; count: number };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.count, 1);
  });

  it("can client-fetch a public GitHub Application manifest before import", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const token = "slipway_import_client_github_secret_token_do_not_print";
    const document = {
      schema: "proof.liskov.application-manifest",
      schemaVersion: 4,
      applicationId: "alpha",
      release: {
        mode: "pinned",
        artifact: {
          kind: "ipfs_bundle",
          cid: "ipfs://bafyalpha",
          digest: `sha256:${"a".repeat(64)}`,
          encryption: { mode: "none" }
        }
      }
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
      github: "proof-computer/alpha:.liskov/application-manifest.json@main",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
        });
        if (String(url) === "https://raw.githubusercontent.com/proof-computer/alpha/main/.liskov/application-manifest.json") {
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
    assert.equal(requests[0]?.url, "https://raw.githubusercontent.com/proof-computer/alpha/main/.liskov/application-manifest.json");
    assert.equal(requests[0]?.authorization, undefined);
    assert.equal(requests[1]?.url, "https://slipway.test/api/applications/imports");
    assert.equal(requests[1]?.authorization, `Bearer ${token}`);
    assert.deepEqual(requests[1]?.body, {
      document,
      source: {
        kind: "github",
        repository: "proof-computer/alpha",
        ref: "main",
        path: ".liskov/application-manifest.json"
      }
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

  it("stores a minted session token after GET /api/session succeeds and never prints the token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const stdout = writer();
    const stderr = writer();
    const token = "minted-session-token-must-not-print";
    const code = await runSlipwayLogin({
      liskovUrl: "https://liskov.test",
      config: sessionFile,
      json: true,
      sessionToken: token
    }, {
      fetchImpl: async (url, init) => {
        assert.equal(String(url), "https://liskov.test/api/session");
        assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
        return jsonResponse({
          ok: true,
          session: {
            sessionId: "sess-local",
            address: "github:1",
            identity: { kind: "github_app", githubUserId: "1", login: "liskov-local" },
            createdAtMs: 1,
            expiresAtMs: 2
          }
        });
      },
      nowMs: () => 1_000,
      stderr: stderr.write,
      stdout: stdout.write
    });
    assert.equal(code, 0);
    const saved = JSON.parse(await readFile(sessionFile, "utf8")) as {
      slipwayUrl: string;
      sessionToken: string;
      session: { identity: { login: string } };
    };
    assert.equal(saved.slipwayUrl, "https://liskov.test");
    assert.equal(saved.sessionToken, token);
    assert.equal(saved.session.identity.login, "liskov-local");
    assert.equal(stdout.text.includes(token), false);
    assert.equal(stderr.text.includes(token), false);
    const parsed = JSON.parse(stdout.text) as { ok: boolean; status: string };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, "authorized");
  });

  it("does not write a session file when a minted token is rejected", async () => {
    const sessionFile = path.join(await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-")), "session.json");
    const stdout = writer();
    const token = "rejected-session-token-must-not-print";
    const code = await runSlipwayLogin({
      liskovUrl: "https://liskov.test",
      config: sessionFile,
      json: true,
      sessionToken: token
    }, {
      fetchImpl: async () => jsonResponse({ ok: false, error: "unauthorized" }, 401),
      stdout: stdout.write
    });
    assert.equal(code, 1);
    await assert.rejects(() => readFile(sessionFile), /ENOENT/u);
    assert.equal(stdout.text.includes(token), false);
    const parsed = JSON.parse(stdout.text) as { ok: boolean; error: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_SESSION_UNAUTHORIZED");
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

  it("reports deterministic login timings from the injected clock after a pending poll", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const stdout = writer();
    const stderr = writer();
    let pollCalls = 0;
    // Counter clock: every nowMs() call advances by 2, starting from 1_000.
    // With noBrowser the calls in runSlipwayLogin land as follows:
    //   1  enteredAtMs          = 1002
    //   2  pendingStartedAtMs   = 1004
    //   3  after pending JSON   = 1006   -> pendingMs = 2
    //   4  startedAtMs          = 1008   (timeout anchor; expiresAtMs 10_000 wins)
    //   5  loop condition       = 1010
    //   6  poll #1 start        = 1012   (firstPollStartedAtMs)
    //   7  poll #1 end          = 1014   -> sample 2, status pending, sleep is a no-op
    //   8  loop condition       = 1016
    //   9  poll #2 start        = 1018
    //  10  poll #2 end          = 1020   -> sample 2, authorized; wait = 1020 - 1012 = 8
    //  11  savedAtMs argument   = 1022
    //  12  saveSlipwaySession   = 1024   (its own nowMs call)
    //  13  totalMs              = 1026 - 1002 = 24
    const code = await runSlipwayLogin({
      slipwayUrl: "https://slipway.test",
      config: sessionFile,
      noBrowser: true,
      json: true
    }, {
      fetchImpl: async (url) => {
        if (String(url) === "https://slipway.test/api/cli-login/pending") {
          return jsonResponse({
            ok: true,
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "pending",
              expiresAtMs: 10_000,
              pollIntervalMs: 100
            },
            verificationUri: "/cli-login.html?pendingLoginId=0123456789abcdef0123456789abcdef&userCode=ABCD-2345"
          });
        }
        if (String(url) === "https://slipway.test/api/cli-login/0123456789abcdef0123456789abcdef/poll") {
          pollCalls += 1;
          if (pollCalls === 1) {
            return jsonResponse({
              ok: true,
              status: "pending",
              cliLogin: {
                pendingLoginId: "0123456789abcdef0123456789abcdef",
                userCode: "ABCD-2345",
                status: "pending"
              }
            });
          }
          return jsonResponse({
            ok: true,
            status: "authorized",
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "authorized"
            },
            session: {
              sessionId: "session-timed",
              address: "github:12345",
              identity: { kind: "github_app", githubUserId: "12345", login: "octo-agent" },
              createdAtMs: 100,
              expiresAtMs: 200
            }
          });
        }
        return jsonResponse({ ok: false, error: "unexpected_request" }, 404);
      },
      nowMs: (() => {
        let now = 1_000;
        return () => {
          now += 2;
          return now;
        };
      })(),
      sleepMs: async () => {},
      stderr: stderr.write,
      stdout: stdout.write
    });
    assert.equal(code, 0);
    assert.equal(pollCalls, 2);
    const saved = JSON.parse(await readFile(sessionFile, "utf8")) as { sessionToken: string; savedAtMs: number };
    assert.equal(saved.savedAtMs, 1_024);
    assert.equal(stdout.text.includes(saved.sessionToken), false);
    assert.equal(stderr.text.includes(saved.sessionToken), false);
    // stdout is exactly one JSON line; the human timings summary goes to stderr in --json mode.
    assert.equal(stdout.text.trim().split("\n").length, 1);
    const parsed = JSON.parse(stdout.text) as {
      ok: boolean;
      status: string;
      browserOpened: boolean;
      timings: {
        pendingMs: number;
        browserOpenMs: number;
        waitForAuthorizationMs: number;
        pollCount: number;
        pollRoundTripMs: { p50: number; max: number };
        totalMs: number;
      };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, "authorized");
    assert.equal(parsed.browserOpened, false);
    assert.deepEqual(Object.keys(parsed.timings).sort(), [
      "browserOpenMs",
      "pendingMs",
      "pollCount",
      "pollRoundTripMs",
      "totalMs",
      "waitForAuthorizationMs"
    ]);
    for (const value of [
      parsed.timings.pendingMs,
      parsed.timings.browserOpenMs,
      parsed.timings.waitForAuthorizationMs,
      parsed.timings.pollCount,
      parsed.timings.pollRoundTripMs.p50,
      parsed.timings.pollRoundTripMs.max,
      parsed.timings.totalMs
    ]) {
      assert.equal(typeof value, "number");
    }
    assert.deepEqual(parsed.timings, {
      pendingMs: 2,
      browserOpenMs: 0,
      waitForAuthorizationMs: 8,
      pollCount: 2,
      pollRoundTripMs: { p50: 2, max: 2 },
      totalMs: 24
    });
    assert.match(stderr.text, /Timings:/u);
    assert.equal(
      stderr.text.includes("Timings: pending 2 ms \u00b7 browser 0 ms \u00b7 wait 8 ms (2 polls, p50 2 ms, max 2 ms) \u00b7 total 24 ms"),
      true
    );
  });

  it("long-polls without sleeping when the server held the request", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const stdout = writer();
    const stderr = writer();
    const pollBodies: Array<Record<string, unknown> | undefined> = [];
    const code = await runSlipwayLogin({
      slipwayUrl: "https://slipway.test",
      config: sessionFile,
      noBrowser: true,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        if (String(url) === "https://slipway.test/api/cli-login/pending") {
          return jsonResponse({
            ok: true,
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "pending",
              expiresAtMs: 10_000,
              pollIntervalMs: 100
            },
            verificationUri: "/cli-login.html?pendingLoginId=0123456789abcdef0123456789abcdef&userCode=ABCD-2345"
          });
        }
        if (String(url) === "https://slipway.test/api/cli-login/0123456789abcdef0123456789abcdef/poll") {
          pollBodies.push(body);
          if (pollBodies.length === 1) {
            return jsonResponse({
              ok: true,
              status: "pending",
              cliLogin: {
                pendingLoginId: "0123456789abcdef0123456789abcdef",
                userCode: "ABCD-2345",
                status: "pending"
              },
              waitedMs: 20_000
            });
          }
          return jsonResponse({
            ok: true,
            status: "authorized",
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "authorized"
            },
            session: {
              sessionId: "session-long-poll",
              address: "github:12345",
              identity: { kind: "github_app", githubUserId: "12345", login: "octo-agent" },
              createdAtMs: 100,
              expiresAtMs: 200
            }
          });
        }
        return jsonResponse({ ok: false, error: "unexpected_request" }, 404);
      },
      nowMs: () => 1_000,
      sleepMs: async () => {
        throw new Error("must not sleep");
      },
      stderr: stderr.write,
      stdout: stdout.write
    });
    assert.equal(code, 0);
    assert.equal(pollBodies.length, 2);
    for (const body of pollBodies) {
      assert.equal(typeof body?.pendingSecret, "string");
      assert.equal(body?.waitMs, 20_000);
    }
    const saved = JSON.parse(await readFile(sessionFile, "utf8")) as { sessionToken: string };
    assert.equal(stdout.text.includes(saved.sessionToken), false);
    assert.equal(stderr.text.includes(saved.sessionToken), false);
    const parsed = JSON.parse(stdout.text) as { ok: boolean; status: string; timings: { pollCount: number } };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, "authorized");
    assert.equal(parsed.timings.pollCount, 2);
  });

  it("keeps the interval sleep for servers without waitedMs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-cli-"));
    const sessionFile = path.join(dir, "session.json");
    const stdout = writer();
    const stderr = writer();
    const pollBodies: Array<Record<string, unknown> | undefined> = [];
    const sleeps: number[] = [];
    const code = await runSlipwayLogin({
      slipwayUrl: "https://slipway.test",
      config: sessionFile,
      noBrowser: true,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
        if (String(url) === "https://slipway.test/api/cli-login/pending") {
          return jsonResponse({
            ok: true,
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "pending",
              expiresAtMs: 10_000,
              pollIntervalMs: 100
            },
            verificationUri: "/cli-login.html?pendingLoginId=0123456789abcdef0123456789abcdef&userCode=ABCD-2345"
          });
        }
        if (String(url) === "https://slipway.test/api/cli-login/0123456789abcdef0123456789abcdef/poll") {
          pollBodies.push(body);
          if (pollBodies.length === 1) {
            // An old server: no waitedMs in the pending response.
            return jsonResponse({
              ok: true,
              status: "pending",
              cliLogin: {
                pendingLoginId: "0123456789abcdef0123456789abcdef",
                userCode: "ABCD-2345",
                status: "pending"
              }
            });
          }
          return jsonResponse({
            ok: true,
            status: "authorized",
            cliLogin: {
              pendingLoginId: "0123456789abcdef0123456789abcdef",
              userCode: "ABCD-2345",
              status: "authorized"
            },
            session: {
              sessionId: "session-old-server",
              address: "github:12345",
              identity: { kind: "github_app", githubUserId: "12345", login: "octo-agent" },
              createdAtMs: 100,
              expiresAtMs: 200
            }
          });
        }
        return jsonResponse({ ok: false, error: "unexpected_request" }, 404);
      },
      nowMs: () => 1_000,
      sleepMs: async (ms) => {
        sleeps.push(ms);
      },
      stderr: stderr.write,
      stdout: stdout.write
    });
    assert.equal(code, 0);
    assert.equal(pollBodies.length, 2);
    for (const body of pollBodies) {
      assert.equal(body?.waitMs, 20_000);
    }
    assert.deepEqual(sleeps, [100]);
    const saved = JSON.parse(await readFile(sessionFile, "utf8")) as { sessionToken: string };
    assert.equal(stdout.text.includes(saved.sessionToken), false);
    assert.equal(stderr.text.includes(saved.sessionToken), false);
    const parsed = JSON.parse(stdout.text) as { ok: boolean; timings: { pollCount: number } };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.timings.pollCount, 2);
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

async function runtimeImageWorkflowFixture(applicationId: string): Promise<{
  dir: string;
  manifestPath: string;
  manifest: Record<string, unknown>;
}> {
  const fixtureRoot = path.join(process.cwd(), ".tmp");
  await mkdir(fixtureRoot, { recursive: true });
  const dir = await mkdtemp(path.join(fixtureRoot, "runtime-image-workflow-"));
  const manifestFile = path.join(dir, "application-manifest.json");
  const manifestPath = path.relative(process.cwd(), manifestFile).split(path.sep).join("/");
  const manifest = runtimeImageBuildManifest(applicationId, manifestPath);
  await writeFile(manifestFile, `${JSON.stringify(manifest)}\n`, "utf8");
  return { dir, manifestPath, manifest };
}

function runtimeImageBuildManifest(
  applicationId: string,
  manifestPath: string
): Record<string, unknown> {
  return {
    schema: "proof.liskov.application-manifest",
    schemaVersion: 4,
    applicationId,
    release: {
      mode: "build",
      artifact: { kind: "runtime_image" },
      builder: {
        kind: "github",
        repository: "proof-computer/runtime-image-app",
        allowedRefs: ["refs/heads/main"],
        workflowRef:
          "proof-computer/runtime-image-app/.github/workflows/liskov-runtime-image.yml@refs/heads/main",
        manifestPath
      }
    },
    deployment: {
      parallelism: 1,
      schedule: { durationMs: 1_800_000 },
      lifecycle: {
        renewal: { mode: "after_scheduled_end" },
        update: {
          timing: "immediate",
          existingJobs: { mode: "run_until_scheduled_end" }
        },
        recovery: {
          launch: { maxRetries: 0 },
          runtimeFailure: { mode: "wait_until_scheduled_end" }
        }
      }
    }
  };
}

function retainedV5SourceManifest(applicationId: string): Record<string, unknown> {
  return {
    schema: "proof.liskov.application-manifest",
    schemaVersion: 5,
    applicationId,
    release: { mode: "source" },
    runtime: {
      kind: "javascript",
      engine: "nodejs",
      entrypoint: { file: "bundle.cjs" }
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

function runOnePreflightPlan(overrides: {
  planItemId?: string;
  idempotencyKey?: string;
  kind?: string;
  policyDigest?: string;
  deploymentId?: string;
  blockers?: unknown[];
} = {}): Record<string, unknown> {
  return {
    planItemId: overrides.planItemId ?? "plan-1",
    idempotencyKey: overrides.idempotencyKey ?? "key-1",
    kind: overrides.kind ?? "acurast.deploy",
    policyDigest: overrides.policyDigest ?? "policy-digest-1",
    executorMode: "custodial.live",
    blockers: overrides.blockers ?? [],
    ...(overrides.kind === "acurast.setEnvironment"
      ? {}
      : { launchEligibility: launchEligibility("eligible_now") }),
    callSummary: {
      ...(overrides.deploymentId === undefined ? {} : { deploymentId: overrides.deploymentId })
    }
  };
}

function runOnePreflight(items: Record<string, unknown>[]): Record<string, unknown> {
  return {
    ok: true,
    launchEligibility: launchEligibility("eligible_now"),
    actionPlan: {
      count: items.length,
      items
    }
  };
}

function launchEligibility(code: string): Record<string, unknown> {
  return {
    schema: "proof.liskov.launch-eligibility.v1",
    code,
    evidenceAuthority: "test_authority",
    userActionable: code === "blocked",
    ...(code === "blocked" ? { nextAction: "resolve_blockers", blockerCodes: ["test_blocker"] } : {})
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
