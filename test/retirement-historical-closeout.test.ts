import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import HistoricalCloseoutCommand from "../src/commands/liskov/admin/retirement/historical-closeout.js";
import {
  runSlipwayAdminRetirementHistoricalCloseout,
  saveSlipwaySession,
  type SlipwayAdminRetirementHistoricalCloseoutInput
} from "../src/index.js";

const DIGEST = "c".repeat(64);
const FINGERPRINT = `sha256:${"d".repeat(64)}`;
const MANIFEST = "docs/raw/2026-09-23-firegrass-paused-disabled-retirement-manifest.md";

describe("retirement historical closeout CLI", () => {
  it("declares the manifest, expectation, actor, and reason guards as required", () => {
    for (const flag of ["manifest-ref", "expect-retirement", "expect-assessment-digest", "actor-id", "reason"]) {
      assert.equal((HistoricalCloseoutCommand.flags[flag] as { required?: boolean }).required, true, flag);
    }
    for (const flag of ["confirm", "fingerprint", "actor-kind"]) {
      assert.notEqual((HistoricalCloseoutCommand.flags[flag] as { required?: boolean }).required, true, flag);
    }
    assert.equal((HistoricalCloseoutCommand.flags["actor-kind"] as { default?: unknown }).default, "platform_admin");
    assert.equal((HistoricalCloseoutCommand.args.uid as { required?: boolean }).required, true);
  });

  it("sends one dry run with no confirm field and never prints tokens", async () => {
    const fixture = await fixtureFor();
    const requests: Array<{ authorization?: string; body: Record<string, unknown>; url: string }> = [];
    const output = writer();
    const code = await runSlipwayAdminRetirementHistoricalCloseout(fixture.input, {
      fetchImpl: async (url, init) => {
        requests.push(requestRecord(url, init));
        return jsonResponse({
          ok: true,
          dryRun: true,
          eligible: true,
          error: null,
          retirementId: "ret-closeout",
          assessmentDigest: DIGEST,
          confirmationFingerprint: FINGERPRINT,
          plan: { lineages: [], chainReads: [], releasedUsdMicros: 0, refusalReasons: [] }
        });
      },
      stdout: output.write
    });

    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.url,
      "https://slipway.test/api/admin/applications/uid-closeout/retirement/historical-closeout"
    );
    assert.equal(requests[0]?.authorization, `Bearer ${fixture.adminToken}`);
    assert.deepEqual(requests[0]?.body, expectedBody());
    assert.equal("confirm" in (requests[0]?.body ?? {}), false);
    assert.equal("confirmationFingerprint" in (requests[0]?.body ?? {}), false);
    const printed = JSON.parse(output.text) as { dryRun: boolean; confirmationFingerprint: string };
    assert.equal(printed.dryRun, true);
    assert.equal(printed.confirmationFingerprint, FINGERPRINT);
    assert.equal(output.text.includes(fixture.adminToken), false);
    assert.equal(output.text.includes(fixture.sessionToken), false);
  });

  it("refuses --confirm without --fingerprint before network access", async () => {
    const fixture = await fixtureFor();
    let fetched = false;
    const output = writer();
    const code = await runSlipwayAdminRetirementHistoricalCloseout({ ...fixture.input, confirm: true }, {
      fetchImpl: async () => {
        fetched = true;
        return jsonResponse({ ok: true });
      },
      stdout: output.write
    });
    assert.equal(code, 1);
    assert.equal(fetched, false);
    assert.equal(
      (JSON.parse(output.text) as { error: string }).error,
      "SLIPWAY_ADMIN_RETIREMENT_HISTORICAL_CLOSEOUT_FINGERPRINT_REQUIRED"
    );
  });

  it("refuses an assessment digest that is not 64 lowercase hex before network access", async () => {
    const fixture = await fixtureFor();
    let fetched = false;
    const output = writer();
    const code = await runSlipwayAdminRetirementHistoricalCloseout({
      ...fixture.input,
      expectAssessmentDigest: `sha256:${DIGEST}`
    }, {
      fetchImpl: async () => {
        fetched = true;
        return jsonResponse({ ok: true });
      },
      stdout: output.write
    });
    assert.equal(code, 1);
    assert.equal(fetched, false);
    assert.equal(
      (JSON.parse(output.text) as { error: string }).error,
      "SLIPWAY_ADMIN_RETIREMENT_HISTORICAL_CLOSEOUT_INPUT_INVALID"
    );
  });

  it("with --confirm --fingerprint sends confirm: true and the fingerprint once", async () => {
    const fixture = await fixtureFor();
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const output = writer();
    const code = await runSlipwayAdminRetirementHistoricalCloseout({
      ...fixture.input,
      confirm: true,
      confirmationFingerprint: FINGERPRINT
    }, {
      fetchImpl: async (_url, init) => {
        requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return jsonResponse({ ok: true, dryRun: false, eligible: true, confirmationFingerprint: FINGERPRINT });
      },
      stdout: output.write
    });
    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]?.body, {
      ...expectedBody(),
      confirm: true,
      confirmationFingerprint: FINGERPRINT
    });
    assert.equal((JSON.parse(output.text) as { dryRun: boolean }).dryRun, false);
  });

  it("surfaces a 404 as historical_closeout_disabled and exits non-zero", async () => {
    const fixture = await fixtureFor();
    const output = writer();
    const code = await runSlipwayAdminRetirementHistoricalCloseout(fixture.input, {
      fetchImpl: async () => jsonResponse({ ok: false, error: "not_found" }, 404),
      stdout: output.write
    });
    assert.equal(code, 1);
    const printed = JSON.parse(output.text) as { ok: boolean; error: string; status: number };
    assert.equal(printed.ok, false);
    assert.equal(printed.error, "historical_closeout_disabled");
    assert.equal(printed.status, 404);
  });

  it("carries the server's error code for a 409 and for a refused plan", async () => {
    const fixture = await fixtureFor();
    const conflict = writer();
    const conflictCode = await runSlipwayAdminRetirementHistoricalCloseout({
      ...fixture.input,
      confirm: true,
      confirmationFingerprint: FINGERPRINT
    }, {
      fetchImpl: async () => jsonResponse({ ok: false, error: "historical_closeout_fingerprint_mismatch" }, 409),
      stdout: conflict.write
    });
    assert.equal(conflictCode, 1);
    assert.equal(
      (JSON.parse(conflict.text) as { error: string }).error,
      "historical_closeout_fingerprint_mismatch"
    );

    const refused = writer();
    const refusedCode = await runSlipwayAdminRetirementHistoricalCloseout(fixture.input, {
      fetchImpl: async () => jsonResponse({
        ok: false,
        dryRun: true,
        eligible: false,
        error: "plan_refused",
        plan: { lineages: [], refusalReasons: ["created_after_cutoff"] }
      }),
      stdout: refused.write
    });
    assert.equal(refusedCode, 1);
    const printed = JSON.parse(refused.text) as { error: string; status: number; plan: { refusalReasons: string[] } };
    assert.equal(printed.error, "plan_refused");
    assert.equal(printed.status, 200);
    assert.deepEqual(printed.plan.refusalReasons, ["created_after_cutoff"]);
  });
});

async function fixtureFor(): Promise<{
  input: SlipwayAdminRetirementHistoricalCloseoutInput;
  adminToken: string;
  sessionToken: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-historical-closeout-"));
  const sessionFile = path.join(dir, "session.json");
  const adminToken = "historical_closeout_admin_token_do_not_print";
  const sessionToken = "historical_closeout_session_token_do_not_print";
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://slipway.test",
    sessionToken,
    savedAtMs: 0
  }, { config: sessionFile });
  return {
    adminToken,
    sessionToken,
    input: {
      applicationUid: "uid-closeout",
      adminToken,
      config: sessionFile,
      json: true,
      actorId: "admin-1",
      actorKind: "platform_admin",
      expectAssessmentDigest: DIGEST,
      expectRetirement: "ret-closeout",
      manifestRef: MANIFEST,
      reason: "ADR-0163 firegrass closeout"
    }
  };
}

function expectedBody(): Record<string, unknown> {
  return {
    manifestRef: MANIFEST,
    actorId: "admin-1",
    actorKind: "platform_admin",
    reason: "ADR-0163 firegrass closeout",
    expectRetirement: "ret-closeout",
    expectAssessmentDigest: DIGEST
  };
}

function requestRecord(url: string | URL | Request, init: RequestInit | undefined): {
  authorization?: string;
  body: Record<string, unknown>;
  url: string;
} {
  return {
    authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    url: String(url)
  };
}

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
