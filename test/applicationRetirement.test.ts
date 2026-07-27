import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  runSlipwayApplicationDelete,
  runSlipwayApplicationRetirement,
  runSlipwayApplicationRetirementCancel,
  saveSlipwaySession
} from "../src/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function writer(): { readonly text: string; write: (line: string) => void } {
  const lines: string[] = [];
  return {
    get text() {
      return lines.join("\n");
    },
    write: (line) => lines.push(line)
  };
}

async function sessionFile(): Promise<{ file: string; token: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-retirement-"));
  const file = path.join(dir, "session.json");
  const token = "retirement_session_secret_do_not_print";
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://liskov.test",
    sessionToken: token,
    savedAtMs: 0
  }, { config: file });
  return { file, token };
}

describe("application retirement CLI", () => {
  it("labels legacy delete as clean-only and sends blocked users to retirement", async () => {
    const session = await sessionFile();
    const out = writer();
    const code = await runSlipwayApplicationDelete({
      applicationRef: "alpha",
      config: session.file
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        dryRun: true,
        deleted: false,
        changed: false,
        application: {
          applicationUid: "app-alpha",
          applicationName: "alpha",
          status: "active"
        },
        impact: {
          activeDeploymentCount: 1,
          liveJobCount: 1,
          pendingOperationCount: 0,
          hasLiveOrPendingResources: true
        }
      }),
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.match(out.text, /deprecated clean-only bridge/u);
    assert.match(out.text, /never starts a long-running retirement/u);
    assert.match(out.text, /proof liskov application retire APP_REF/u);
  });

  it("reads the canonical preview without mutating and preserves JSON exactly", async () => {
    const session = await sessionFile();
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    const response = {
      ok: true,
      domain: "proof.liskov.application-retirement.v1",
      lifecycleState: "active",
      creationAvailability: { available: true },
      capabilities: { create: true, cancel: true },
      preview: {
        assessment: {
          domain: "proof.liskov.application-retirement-assessment.v1",
          phase: "waiting_for_schedule_end",
          executionBlockerCount: 1,
          financialBlockerCount: 0,
          ambiguityBlockerCount: 0,
          latestKnownScheduleEndAtMs: 1_800_000_000_000,
          blockers: [{
            category: "execution",
            code: "chain_schedule_not_terminal",
            evidenceAuthority: "acurast_chain",
            resourceKind: "job",
            resourceId: "job-1",
            remediationClass: "wait_for_chain_evidence"
          }]
        }
      }
    };
    const out = writer();
    const code = await runSlipwayApplicationRetirement({
      applicationRef: "alpha/beta",
      config: session.file,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          body: init?.body === undefined ? undefined : String(init.body)
        });
        return jsonResponse(response);
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      url: "https://liskov.test/api/applications/alpha%2Fbeta/retirement",
      method: "GET",
      body: undefined
    }]);
    assert.deepEqual(JSON.parse(out.text), response);
    assert.equal(out.text.includes(session.token), false);
  });

  it("starts retirement only with --yes and trims the optional reason", async () => {
    const session = await sessionFile();
    const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
    const response = {
      ok: true,
      retirement: {
        domain: "proof.liskov.application-retirement.v1",
        retirementId: "retirement-1",
        status: "active",
        lifecycleState: "retiring",
        phase: "waiting_for_financial_tail",
        assessment: {
          phase: "waiting_for_financial_tail",
          executionBlockerCount: 0,
          financialBlockerCount: 1,
          ambiguityBlockerCount: 0,
          blockers: []
        }
      },
      receipt: null
    };
    const preview = {
      ok: true,
      creationAvailability: { available: true },
      capabilities: { create: true, cancel: true },
      preview: { assessment: { executionBlockerCount: 0, financialBlockerCount: 1, ambiguityBlockerCount: 0 } }
    };
    const out = writer();
    const code = await runSlipwayApplicationRetirement({
      applicationRef: "alpha",
      config: session.file,
      json: true,
      reason: "  project complete  ",
      yes: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
        });
        return init?.method === "POST"
          ? jsonResponse(response, 202)
          : jsonResponse(preview);
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [
      {
        url: "https://liskov.test/api/applications/alpha/retirement",
        method: "GET",
        body: undefined
      },
      {
        url: "https://liskov.test/api/applications/alpha/retirement",
        method: "POST",
        body: { reason: "project complete" }
      }
    ]);
    assert.deepEqual(JSON.parse(out.text), response);
  });

  it("does not post a new intent when rollout availability blocks creation", async () => {
    const session = await sessionFile();
    const requests: string[] = [];
    const response = {
      ok: true,
      creationAvailability: {
        domain: "proof.liskov.application-retirement-creation-availability.v1",
        available: false,
        reason: "kill_switch_enabled"
      },
      capabilities: { create: true, cancel: true },
      preview: {
        assessment: {
          phase: "blocked",
          executionBlockerCount: 0,
          financialBlockerCount: 0,
          ambiguityBlockerCount: 1,
          blockers: []
        }
      }
    };
    const out = writer();
    const code = await runSlipwayApplicationRetirement({
      applicationRef: "alpha",
      config: session.file,
      yes: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push(`${init?.method}:${String(url)}`);
        return jsonResponse(response);
      },
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.deepEqual(requests, ["GET:https://liskov.test/api/applications/alpha/retirement"]);
    assert.match(out.text, /operator kill switch is enabled/u);
    assert.doesNotMatch(out.text, /Use --yes/u);
  });

  it("requires explicit confirmation to cancel and leaves the request unsent", async () => {
    let requests = 0;
    const out = writer();
    const code = await runSlipwayApplicationRetirementCancel({
      applicationRef: "alpha",
      json: true
    }, {
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse({ ok: true });
      },
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.equal(requests, 0);
    assert.equal(
      (JSON.parse(out.text) as { error: string }).error,
      "SLIPWAY_APPLICATION_RETIREMENT_CANCEL_CONFIRMATION_REQUIRED"
    );
  });

  it("posts cancellation and preserves a completion-race receipt in canonical JSON", async () => {
    const session = await sessionFile();
    const response = {
      ok: false,
      error: "retirement_already_completed",
      retirement: { retirementId: "retirement-1", status: "completed" },
      receipt: {
        domain: "proof.liskov.application-deletion-receipt.v1",
        receiptKind: "safe_retirement",
        digest: "abc123",
        payload: {}
      }
    };
    const out = writer();
    const code = await runSlipwayApplicationRetirementCancel({
      applicationRef: "alpha",
      config: session.file,
      json: true,
      reason: "  keep paused  ",
      yes: true
    }, {
      fetchImpl: async (url, init) => {
        assert.equal(String(url), "https://liskov.test/api/applications/alpha/retirement/cancel");
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), { reason: "keep paused" });
        return jsonResponse(response, 409);
      },
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(out.text), response);
    assert.equal(out.text.includes(session.token), false);
  });

  it("renders phases, typed blockers, schedule estimates, and receipt kinds for people", async () => {
    const session = await sessionFile();
    const preview = writer();
    const previewCode = await runSlipwayApplicationRetirement({
      applicationRef: "alpha",
      config: session.file
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        creationAvailability: { available: true },
        capabilities: { create: true, cancel: true },
        preview: {
          assessment: {
            phase: "blocked",
            executionBlockerCount: 1,
            financialBlockerCount: 0,
            ambiguityBlockerCount: 1,
            latestKnownScheduleEndAtMs: 1_800_000_000_000,
            blockers: [{
              category: "ambiguity",
              code: "unknown_or_legacy_job_state",
              evidenceAuthority: "liskov_jobs",
              resourceKind: "job",
              resourceId: "job-1",
              remediationClass: "normalize_or_adjudicate"
            }]
          }
        }
      }),
      stdout: preview.write
    });
    assert.equal(previewCode, 0);
    assert.match(preview.text, /Phase blocked: 1 execution, 0 financial, 1 ambiguity/u);
    assert.match(preview.text, /estimate, not a completion promise/u);
    assert.match(preview.text, /ambiguity\/unknown_or_legacy_job_state/u);
    assert.match(preview.text, /Use --yes/u);

    const receipt = writer();
    const receiptCode = await runSlipwayApplicationRetirement({
      applicationRef: "alpha",
      config: session.file
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        lifecycleState: "deleted",
        receipt: {
          receiptKind: "legacy_immediate_tombstone",
          digest: "legacy123",
          payload: {}
        },
        legacyCleanup: {
          resourcesTerminalized: false,
          assessment: {
            phase: "waiting_for_schedule_end",
            executionBlockerCount: 1,
            financialBlockerCount: 0,
            ambiguityBlockerCount: 0,
            blockers: []
          }
        }
      }),
      stdout: receipt.write
    });
    assert.equal(receiptCode, 0);
    assert.match(receipt.text, /Legacy immediate tombstone receipt: legacy123/u);
    assert.match(receipt.text, /Legacy post-deletion cleanup remains open/u);
  });
});
