import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runSlipwayApplicationHoldRelease, saveSlipwaySession } from "../src/index.js";

const HOLD_ID = `failure-hold:sha256:${"a".repeat(64)}`;
const OTHER_HOLD_ID = `failure-hold:sha256:${"b".repeat(64)}`;
const AUTHORIZATION_ID = `failure-hold-release:sha256:${"c".repeat(64)}`;

describe("application hold release", () => {
  it("previews a release and then requests it, without printing the bearer token", async () => {
    const token = "liskov_hold_release_secret_token_do_not_print";
    const sessionFile = await savedSession(token);
    const requests: Array<{ url: string; method?: string; authorization?: string; body?: Record<string, unknown> }> = [];
    const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { confirm?: boolean };
      requests.push({
        url: String(url),
        method: init?.method,
        authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
        body
      });
      return jsonResponse(releaseResponse({
        requested: body.confirm === true,
        dryRun: body.confirm !== true,
        authorizationId: body.confirm === true ? AUTHORIZATION_ID : null,
        nextAction: body.confirm === true ? "release_applies_at_next_executor_tick" : null
      }));
    };

    const preview = writer();
    const previewCode = await runSlipwayApplicationHoldRelease({
      applicationRef: "standing-two-job",
      config: sessionFile
    }, { fetchImpl, stdout: preview.write });
    const confirm = writer();
    const confirmCode = await runSlipwayApplicationHoldRelease({
      applicationRef: "standing-two-job",
      reason: "config fixed",
      yes: true,
      config: sessionFile
    }, { fetchImpl, stdout: confirm.write });

    assert.equal(previewCode, 0);
    assert.equal(confirmCode, 0);
    assert.deepEqual(requests, [{
      url: "https://liskov.test/api/applications/standing-two-job/holds/release",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { confirm: false }
    }, {
      url: "https://liskov.test/api/applications/standing-two-job/holds/release",
      method: "POST",
      authorization: `Bearer ${token}`,
      body: { confirm: true, reason: "config fixed" }
    }]);

    assert.equal(preview.text.includes(token), false);
    assert.match(preview.text, /^Dry run: slot-0 · g3 of standing-two-job would be released\.$/mu);
    assert.match(preview.text, /^- slot-0 · g3 held since 2026-09-07T15:08:33\.443Z; hold failure-hold:sha256:a+$/mu);
    assert.match(preview.text, /Add --yes to request the release\.$/mu);
    // The route records intent; the human output must never read as a
    // promise that the job relaunched.
    assert.equal(/relaunched|is running|has launched/u.test(preview.text), false);

    assert.equal(confirm.text.includes(token), false);
    assert.match(confirm.text, /^Requested the release of slot-0 · g3 of standing-two-job\.$/mu);
    assert.match(confirm.text, /executor's next pass/u);
    assert.match(confirm.text, /`proof liskov application execution show standing-two-job --watch`/u);
  });

  it("names the hold and appends the owner query when asked to", async () => {
    const sessionFile = await savedSession("hold_release_owner_token");
    let requestedUrl = "";
    let sentBody: Record<string, unknown> = {};
    const out = writer();
    const code = await runSlipwayApplicationHoldRelease({
      applicationRef: "legacy-app",
      holdId: HOLD_ID,
      owner: "github:12345",
      yes: true,
      json: true,
      config: sessionFile
    }, {
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        sentBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse(releaseResponse({ requested: true, dryRun: false, authorizationId: AUTHORIZATION_ID }));
      },
      stdout: out.write
    });
    assert.equal(code, 0);
    assert.equal(requestedUrl, "https://liskov.test/api/applications/legacy-app/holds/release?owner=github%3A12345");
    assert.deepEqual(sentBody, { confirm: true, holdId: HOLD_ID });
    const parsed = JSON.parse(out.text) as Record<string, unknown>;
    assert.equal(parsed.requested, true);
    assert.equal(parsed.authorizationId, AUTHORIZATION_ID);
    assert.equal(out.text.includes("hold_release_owner_token"), false);
  });

  it("treats an already-requested release as success and says so", async () => {
    const sessionFile = await savedSession("hold_release_noop_token");
    const out = writer();
    const code = await runSlipwayApplicationHoldRelease({
      applicationRef: "standing-two-job",
      yes: true,
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        noop: true,
        reason: "failure_hold_release_already_requested",
        authorizationId: AUTHORIZATION_ID,
        hold: holdSummary({ pendingRelease: { authorizationId: AUTHORIZATION_ID, requestedAtMs: 1 } }),
        nextAction: "release_applies_at_next_executor_tick"
      }),
      stdout: out.write
    });
    assert.equal(code, 0);
    assert.match(out.text, /^standing-two-job already has a release of slot-0 · g3 requested and not yet applied\.$/mu);
    assert.match(out.text, /does not queue a second release/u);
  });

  it("renders a refusal as an error with the server's code and remedy", async () => {
    const sessionFile = await savedSession("hold_release_refusal_token");
    const out = writer();
    const code = await runSlipwayApplicationHoldRelease({
      applicationRef: "standing-two-job",
      yes: true,
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse(releaseResponse({
        ok: false,
        hold: null,
        openHolds: [],
        refusal: { code: "failure_hold_not_open", detail: "this application has no open failure hold to release" }
      })),
      stdout: out.write
    });
    assert.equal(code, 1);
    assert.match(out.text, /^Error \(SLIPWAY_APPLICATION_HOLD_NOT_OPEN\): this application has no open failure hold to release\.$/mu);
    assert.match(out.text, /Nothing to release: no job of standing-two-job is held\./u);
  });

  it("lists the open holds when the server cannot pick one", async () => {
    const sessionFile = await savedSession("hold_release_ambiguous_token");
    const out = writer();
    const code = await runSlipwayApplicationHoldRelease({
      applicationRef: "standing-two-job",
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse(releaseResponse({
        ok: false,
        hold: null,
        openHolds: [holdSummary(), holdSummary({ holdId: OTHER_HOLD_ID, stableSlotId: "slot-1", generation: 5 })],
        refusal: { code: "failure_hold_ambiguous", detail: "more than one member is held; name the hold to release with `holdId`" }
      })),
      stdout: out.write
    });
    assert.equal(code, 1);
    assert.match(out.text, /^Error \(SLIPWAY_APPLICATION_HOLD_AMBIGUOUS\)/mu);
    assert.match(out.text, /^- slot-0 · g3 .*; hold failure-hold:sha256:a+$/mu);
    assert.match(out.text, /^- slot-1 · g5 .*; hold failure-hold:sha256:b+$/mu);
    assert.match(out.text, /Name the hold to release with --hold-id\.$/mu);
  });

  it("echoes an unknown refusal code rather than renaming it", async () => {
    const sessionFile = await savedSession("hold_release_unknown_token");
    const out = writer();
    const code = await runSlipwayApplicationHoldRelease({
      applicationRef: "standing-two-job",
      yes: true,
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse(releaseResponse({
        ok: false,
        hold: null,
        refusal: { code: "failure_hold_frozen", detail: "a future refusal" }
      })),
      stdout: out.write
    });
    assert.equal(code, 1);
    assert.match(out.text, /^Error \(SLIPWAY_APPLICATION_HOLD_RELEASE_FAILED\): a future refusal\.$/mu);
    assert.match(out.text, /^Server refusal code: failure_hold_frozen\.$/mu);
  });

  it("maps a 401 to the session error and never prints the token", async () => {
    const token = "hold_release_expired_token";
    const sessionFile = await savedSession(token);
    const out = writer();
    const code = await runSlipwayApplicationHoldRelease({
      applicationRef: "standing-two-job",
      yes: true,
      json: true,
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({ ok: false, error: "unauthorized" }, 401),
      stdout: out.write
    });
    assert.equal(code, 1);
    const parsed = JSON.parse(out.text) as Record<string, unknown>;
    assert.equal(parsed.error, "SLIPWAY_SESSION_UNAUTHORIZED");
    assert.equal(out.text.includes(token), false);
  });
});

function holdSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    holdId: HOLD_ID,
    occurrenceId: `policy-occurrence:sha256:${"d".repeat(64)}`,
    stableJobId: `stable-job:sha256:${"e".repeat(64)}`,
    stableSlotId: "slot-0",
    generation: 3,
    status: "held",
    stateRevision: 1,
    heldAtMs: 1_788_793_713_443,
    failureEvidenceDigest: `sha256:${"f".repeat(64)}`,
    pendingRelease: null,
    ...overrides
  };
}

function releaseResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    requested: false,
    dryRun: true,
    hold: holdSummary(),
    openHolds: [holdSummary()],
    authorizationId: null,
    nextAction: null,
    refusal: null,
    ...overrides
  };
}

async function savedSession(token: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "proof-liskov-hold-release-"));
  const sessionFile = path.join(directory, "session.json");
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://liskov.test",
    sessionToken: token,
    savedAtMs: 0
  }, { config: sessionFile });
  return sessionFile;
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
