import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  runSlipwayApplicationDelete,
  runSlipwayApplicationList,
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

  it("treats a completion race as the success it is, in JSON and for people", async () => {
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

    // The cancellation lost the race, but the caller got the outcome it wanted:
    // the retirement is complete and the body carries the immutable receipt
    // (ADR-0038 §3). Exiting 1 made a successful retirement look like a failure
    // to every script that checks the status (BKLG-20260902-e7l1). The
    // canonical envelope is still echoed byte-for-byte; only the status moved.
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out.text), response);
    assert.equal(out.text.includes(session.token), false);

    const human = writer();
    const humanCode = await runSlipwayApplicationRetirementCancel({
      applicationRef: "alpha",
      config: session.file,
      yes: true
    }, {
      fetchImpl: async () => jsonResponse(response, 409),
      stdout: human.write
    });
    assert.equal(humanCode, 0);
    assert.match(human.text, /Retirement completed before the cancellation was applied/u);
    assert.match(human.text, /Safe application retirement receipt: abc123\./u);
    assert.doesNotMatch(human.text, /^Error \(/mu);
    assert.equal(human.text.includes(session.token), false);
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

describe("the lifecycle every surface shares", () => {
  /** The same canonical progress payload the Console's component test renders,
   *  so a phase, an owner and a digest cannot mean two things across clients. */
  const progress = async () => JSON.parse(await readFile(
    new URL("./fixtures/retirement_progress.json", import.meta.url), "utf8"
  ));

  it("prints Current, Retiring and Retired, never the persisted word", async () => {
    const session = await sessionFile();
    const out = writer();
    assert.equal(await runSlipwayApplicationList({ config: session.file }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        count: 3,
        applications: [
          { applicationId: "live", status: "active", lifecycleState: "active" },
          { applicationId: "going", status: "paused", lifecycleState: "retiring" },
          { applicationId: "gone", status: "deleted", lifecycleState: "deleted", receiptKind: "safe_retirement" }
        ]
      }),
      stdout: out.write
    }), 0);
    assert.match(out.text, /- live: Current \(status active\)/u);
    assert.match(out.text, /- going: Retiring \(status paused\)/u);
    assert.match(out.text, /- gone: Retired \(status deleted, safe-retirement receipt\)/u);
    // `deleted` survives only as the stored status beside the lifecycle, never
    // as the row's own word.
    assert.doesNotMatch(out.text, /: deleted \(/u);
  });

  it("falls back to the stored status only when the server did not say", async () => {
    // A server older than BKLG-20260902-e7l1 sends no `lifecycleState`; the row
    // must still read truthfully rather than printing `deleted` at a customer.
    const session = await sessionFile();
    const out = writer();
    assert.equal(await runSlipwayApplicationList({ config: session.file }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        count: 2,
        applications: [
          { applicationId: "old-live", status: "active" },
          { applicationId: "old-gone", status: "deleted", deletedAtMs: 5 }
        ]
      }),
      stdout: out.write
    }), 0);
    assert.match(out.text, /- old-live: Current/u);
    assert.match(out.text, /- old-gone: Retired/u);
  });

  it("selects the retired view on the lifecycle the server states", async () => {
    const session = await sessionFile();
    const out = writer();
    let requested = "";
    assert.equal(await runSlipwayApplicationList({ config: session.file, deleted: true, json: true }, {
      fetchImpl: async (url) => {
        requested = String(url);
        return jsonResponse({
          ok: true,
          count: 3,
          applications: [
            { applicationId: "live", status: "active", lifecycleState: "active" },
            { applicationId: "going", status: "paused", lifecycleState: "retiring" },
            { applicationId: "gone", status: "deleted", lifecycleState: "deleted" }
          ]
        });
      },
      stdout: out.write
    }), 0);
    assert.match(requested, /\?includeDeleted=true$/u);
    const body = JSON.parse(out.text);
    // A retiring application has not been retired: it must not appear here.
    assert.deepEqual(body.applications.map((row: { applicationId: string }) => row.applicationId), ["gone"]);
    assert.equal(body.count, 1);
  });

  it("names the owner of every obligation, and never invents one", async () => {
    const session = await sessionFile();
    const fixture = await progress();
    const out = writer();
    assert.equal(await runSlipwayApplicationRetirement({
      applicationRef: "alpha",
      config: session.file
    }, {
      fetchImpl: async () => jsonResponse(fixture),
      stdout: out.write
    }), 0);

    // Three raw facts, two obligations: the reserve and its unreleased billing
    // parent are one thing to resolve.
    assert.equal(fixture.retirement.assessment.blockers.length, 3);
    assert.match(out.text, /2 correlated obligation\(s\):/u);
    // The obligation is named by what its facts are about, not by the server's
    // grouping key: a financial obligation is keyed on the reserve that holds
    // the money, and production reserve ids are hundreds of characters of
    // embedded JSON (BKLG-20260902-e7l1).
    assert.match(out.text, /execution\/job job-fixture-1: waiting on the Acurast chain; no action from you; wait_for_chain_evidence\./u);
    assert.match(out.text, /financial\/deploy_spend_reservation reserve-fixture-1: waiting on Liskov; no action from you; automatic_financial_closeout, 2 facts\./u);
    assert.match(out.text, /Assessment unchanged for 120 minute\(s\)\./u);
    assert.equal(out.text.includes(session.token), false);
  });

  it("reports a blocker with no remediation class as unclassified, not as review", async () => {
    // "Review" names an owner the server did not name. An absent class is
    // unknown, and saying so is the whole point of this packet.
    const session = await sessionFile();
    const out = writer();
    assert.equal(await runSlipwayApplicationRetirement({
      applicationRef: "alpha",
      config: session.file
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        preview: {
          assessment: {
            phase: "blocked",
            executionBlockerCount: 1,
            financialBlockerCount: 0,
            ambiguityBlockerCount: 0,
            blockers: [{ category: "execution", code: "mystery", resourceKind: "job", resourceId: "job-9" }]
          }
        },
        creationAvailability: { available: true },
        capabilities: { create: true }
      }),
      stdout: out.write
    }), 0);
    assert.match(out.text, /remediation unclassified\./u);
    assert.doesNotMatch(out.text, /remediation review\./u);
  });
});

describe("an obligation is named by what it is about", () => {
  const render = async (lineage: Record<string, unknown>) => {
    const session = await sessionFile();
    const out = writer();
    const code = await runSlipwayApplicationRetirement({ applicationRef: "alpha", config: session.file }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        preview: {
          assessment: { phase: "blocked", executionBlockerCount: 1, financialBlockerCount: 0, ambiguityBlockerCount: 0, blockers: [] },
          remediation: { lineages: [lineage] }
        },
        creationAvailability: { available: true },
        capabilities: { create: true }
      }),
      stdout: out.write
    });
    assert.equal(code, 0);
    return out.text;
  };

  const longReserve = "deploy-reserve:launch-proposal:slipway-application:app:app-v2:app:diagnostic:app:replica-0:policy_digest_changed:[{\"name\":\"Acurast\",\"values\":[[[216,252,254,25]]]},138304]:8feb3bbe29df";

  it("shows the resource, not the grouping key", async () => {
    // The production shape: an execution obligation about a job, grouped under
    // a reserve id. Showing the key told the customer their job-abandonment
    // obligation was a spend reservation.
    const text = await render({
      lineageKey: longReserve,
      category: "execution",
      remediationClass: "automatic_local_terminalization",
      owner: "liskov",
      actionable: false,
      factCount: 1,
      facts: [{ category: "execution", code: "local_job_not_abandoned", evidenceAuthority: "liskov_jobs", resourceKind: "job", resourceId: "job-7022", remediationClass: "automatic_local_terminalization" }]
    });
    assert.match(text, /execution\/job job-7022: waiting on Liskov/u);
    assert.doesNotMatch(text, /deploy-reserve:launch-proposal/u);
  });

  it("truncates an id no one can read, and keeps it exact in --json", async () => {
    const text = await render({
      lineageKey: longReserve,
      category: "financial",
      remediationClass: "automatic_financial_closeout",
      owner: "liskov",
      actionable: false,
      factCount: 1,
      facts: [{ category: "financial", code: "deploy_spend_reserved", evidenceAuthority: "slipway_deploy_spend_reservations", resourceKind: "deploy_spend_reservation", resourceId: longReserve, remediationClass: "automatic_financial_closeout" }]
    });
    // Head and tail both survive: the head says what kind of thing it is, the
    // tail is what distinguishes one reservation from another.
    assert.match(text, /deploy_spend_reservation deploy-reserve:launch-proposal:.+….*8feb3bbe29df/u);
    assert.doesNotMatch(text, /"name":"Acurast"/u);
    assert.ok(text.split("\n").every((line) => line.length < 200), "no line is an unreadable wall");
  });

  it("says when one obligation spans several resources", async () => {
    const text = await render({
      lineageKey: "reserve-1",
      category: "financial",
      remediationClass: "automatic_financial_closeout",
      owner: "liskov",
      actionable: false,
      factCount: 3,
      facts: [
        { category: "financial", code: "deploy_spend_reserved", evidenceAuthority: "a", resourceKind: "deploy_spend_reservation", resourceId: "reserve-1", remediationClass: "automatic_financial_closeout" },
        { category: "financial", code: "billing_transaction_not_released", evidenceAuthority: "b", resourceKind: "billing_transaction", resourceId: "reserve-1", remediationClass: "automatic_financial_closeout" },
        { category: "financial", code: "job_financial_closeout_incomplete", evidenceAuthority: "c", resourceKind: "job", resourceId: "job-9", remediationClass: "automatic_financial_closeout" }
      ]
    });
    assert.match(text, /deploy_spend_reservation reserve-1 \(\+1 more resource\)/u);
    assert.match(text, /3 facts/u);
  });
});
