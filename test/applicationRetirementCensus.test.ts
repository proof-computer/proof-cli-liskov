import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  runSlipwayApplicationRetirementCensus,
  saveSlipwaySession
} from "../src/index.js";

const TOKEN = "census_session_secret_do_not_print";

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

async function sessionFile(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-census-"));
  const file = path.join(dir, "session.json");
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://liskov.test",
    sessionToken: TOKEN,
    savedAtMs: 0
  }, { config: file });
  return file;
}

/** One page of the shape the backend census returns. */
function censusPage(nextCursor: string | null = null): unknown {
  return {
    ok: true,
    generatedAtMs: 1_000_000,
    census: {
      domain: "proof.liskov.application-retirement-census.v1",
      applications: [
        {
          applicationId: "estate-a",
          applicationUid: "uid-estate-a",
          applicationName: "estate-a",
          displayName: "estate-a",
          lifecycle: "active",
          coverage: { available: true },
          phase: "waiting_for_financial_tail",
          executionBlockerCount: 0,
          financialBlockerCount: 3,
          ambiguityBlockerCount: 0,
          blockerFactCount: 3,
          correlatedLineageCount: 1,
          lineageCountsByRemediationClass: { automatic_financial_closeout: 1 },
          factCountsByCode: {
            billing_transaction_not_released: 1,
            deploy_spend_reserved: 1,
            job_financial_closeout_incomplete: 1
          },
          unchangedAssessmentAgeMs: 172_800_000
        },
        {
          applicationId: "estate-e",
          applicationUid: "uid-estate-e",
          applicationName: "estate-e",
          displayName: "estate-e",
          lifecycle: "active",
          coverage: { available: false, reason: "github_repository_required" }
        }
      ],
      nextCursor,
      pageSize: 25,
      estate: {
        applicationsByLifecycle: { active: 3, paused: 1, disabled: 0, deleted: 1, retiring: 0 },
        activeRetirementsByPhase: {},
        receiptsByKind: { safe_retirement: 0, legacy_immediate_tombstone: 1 },
        activeRetirementCount: 0,
        oldestUnchangedAssessmentAgeMs: null
      },
      page: {
        applications: 2,
        applicationsWithBlockers: 1,
        coverageUnavailable: 1,
        blockerFacts: 3,
        correlatedLineages: 1,
        factCountsByCode: {},
        lineageCountsByRemediationClass: { automatic_financial_closeout: 1 }
      },
      fingerprint: "3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a"
    }
  };
}

describe("application retirement census CLI", () => {
  it("distinguishes applications, raw blocker facts, and correlated obligations", async () => {
    const config = await sessionFile();
    const out = writer();
    const code = await runSlipwayApplicationRetirementCensus({ config }, {
      fetchImpl: async (input) => {
        assert.equal(
          String(input),
          "https://liskov.test/api/console/retirement-census"
        );
        return jsonResponse(censusPage());
      },
      stdout: out.write
    });
    assert.equal(code, 0);
    // The three quantities the old per-application fan-out conflated.
    assert.match(out.text, /2 application\(s\), 1 with blockers, 1 without coverage/u);
    assert.match(out.text, /3 raw blocker fact\(s\) group into 1 correlated obligation\(s\)/u);
    // Causes lead, not a per-row worklist.
    assert.match(out.text, /Causes: automatic_financial_closeout 1\./u);
    assert.match(out.text, /\(3 fact\(s\) in 1 obligation\(s\)\)/u);
    // A coverage failure is reported as its own fact, never as a clean gate.
    assert.match(out.text, /coverage unavailable \(github_repository_required\)/u);
    assert.match(out.text, /unchanged 2d/u);
    assert.match(out.text, /No further pages\./u);
    // The bearer token never reaches output.
    assert.ok(!out.text.includes(TOKEN));
  });

  it("passes pagination and exact filters through, and offers the next cursor", async () => {
    const config = await sessionFile();
    const out = writer();
    const code = await runSlipwayApplicationRetirementCensus({
      config,
      limit: 50,
      cursor: "Y3Vyc29y",
      lifecycle: "retiring",
      remediationClass: "operator_adjudication"
    }, {
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        assert.equal(url.pathname, "/api/console/retirement-census");
        assert.equal(url.searchParams.get("limit"), "50");
        assert.equal(url.searchParams.get("cursor"), "Y3Vyc29y");
        assert.equal(url.searchParams.get("lifecycle"), "retiring");
        assert.equal(url.searchParams.get("remediationClass"), "operator_adjudication");
        return jsonResponse(censusPage("bmV4dA"));
      },
      stdout: out.write
    });
    assert.equal(code, 0);
    assert.match(out.text, /Next page: --cursor bmV4dA/u);
  });

  it("emits the canonical backend envelope unchanged under --json", async () => {
    const config = await sessionFile();
    const out = writer();
    const body = censusPage();
    const code = await runSlipwayApplicationRetirementCensus({ config, json: true }, {
      fetchImpl: async () => jsonResponse(body),
      stdout: out.write
    });
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out.text), body);
  });

  it("follows every page under --all and reports the walk", async () => {
    const config = await sessionFile();
    const out = writer();
    const cursors: (string | null)[] = [];
    const code = await runSlipwayApplicationRetirementCensus({ config, all: true }, {
      fetchImpl: async (input) => {
        const cursor = new URL(String(input)).searchParams.get("cursor");
        cursors.push(cursor);
        return jsonResponse(censusPage(cursor === null ? "cGFnZTI" : null));
      },
      stdout: out.write
    });
    assert.equal(code, 0);
    assert.deepEqual(cursors, [null, "cGFnZTI"]);
    assert.match(out.text, /Walked 2 page\(s\); the estate census is complete\./u);
  });

  it("rejects --all with --json before any network call", async () => {
    const config = await sessionFile();
    const out = writer();
    let called = false;
    const code = await runSlipwayApplicationRetirementCensus({ config, all: true, json: true }, {
      fetchImpl: async () => {
        called = true;
        return jsonResponse(censusPage());
      },
      stdout: out.write
    });
    assert.equal(code, 1);
    assert.equal(called, false, "input is rejected before any network I/O");
    assert.equal(
      JSON.parse(out.text).error,
      "SLIPWAY_APPLICATION_RETIREMENT_CENSUS_INPUT_INVALID"
    );
  });

  it("rejects an out-of-range limit before any network call", async () => {
    const config = await sessionFile();
    const out = writer();
    let called = false;
    const code = await runSlipwayApplicationRetirementCensus({ config, limit: 500 }, {
      fetchImpl: async () => {
        called = true;
        return jsonResponse(censusPage());
      },
      stdout: out.write
    });
    assert.equal(code, 1);
    assert.equal(called, false);
    assert.match(out.text, /--limit must be an integer between 1 and 100/u);
  });

  it("surfaces a backend refusal code and exits nonzero", async () => {
    const config = await sessionFile();
    const out = writer();
    const code = await runSlipwayApplicationRetirementCensus({ config, cursor: "bogus" }, {
      fetchImpl: async () => jsonResponse(
        { ok: false, error: "retirement_census_cursor_invalid" },
        400
      ),
      stdout: out.write
    });
    assert.equal(code, 1);
    assert.match(out.text, /retirement_census_cursor_invalid/u);
  });
});
