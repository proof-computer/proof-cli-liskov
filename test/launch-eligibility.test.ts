import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  formatLaunchEligibility,
  launchEligibilityCodes,
  readLaunchEligibility
} from "../src/launch-eligibility.js";
import {
  runSlipwayCustodyExecutionSubmit,
  runSlipwayCustodyExecutionRunOne,
  runSlipwayCustodyPreflight,
  saveSlipwaySession
} from "../src/session.js";

const labels: Record<(typeof launchEligibilityCodes)[number], string> = {
  eligible_now: "eligible now",
  not_due: "not due",
  one_shot_consumed: "generation already consumed",
  recovery_not_authorized: "recovery not authorized",
  equivalent_proposal_exists: "equivalent proposal exists",
  administratively_ineligible: "administratively ineligible",
  blocked: "blocked"
};

describe("canonical launch eligibility", () => {
  it("decodes and renders every closed code, with only eligible_now launchable", () => {
    for (const code of launchEligibilityCodes) {
      const read = readLaunchEligibility(eligibility(code));
      assert.equal(read.known, true, code);
      assert.equal(read.eligible, code === "eligible_now", code);
      assert.match(formatLaunchEligibility(read), new RegExp(`${labels[code]} \\(${code}\\)`), code);
    }
  });

  it("fails closed for missing, malformed, and future values", () => {
    const cases: Array<[unknown, string]> = [
      [undefined, "missing"],
      [{ ...eligibility("eligible_now"), schema: "proof.liskov.launch-eligibility.v2" }, "invalid_contract"],
      [eligibility("future_server_code"), "unknown_code"],
      [{ ...eligibility("eligible_now"), evidenceAuthority: "" }, "invalid_contract"],
      [{ ...eligibility("eligible_now"), blockerCodes: [""] }, "invalid_contract"]
    ];
    for (const [value, reason] of cases) {
      const read = readLaunchEligibility(value);
      assert.equal(read.known, false);
      assert.equal(read.eligible, false);
      if (!read.known) assert.equal(read.reason, reason);
    }
  });

  it("rejects every unavailable or non-eligible deploy preflight before POST", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-launch-eligibility-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://liskov.test",
      sessionToken: "launch_eligibility_test_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    const unavailable: Array<[string, unknown]> = [
      ["missing", undefined],
      ["unknown", eligibility("future_server_code")],
      ...launchEligibilityCodes
        .filter((code) => code !== "eligible_now")
        .map((code): [string, unknown] => [code, eligibility(code)])
    ];
    for (const [name, topLevelEligibility] of unavailable) {
      let requestCount = 0;
      let output = "";
      const response: Record<string, unknown> = {
        ok: true,
        actionPlan: { count: 1, items: [deployPlanItem(eligibility("eligible_now"))] },
        ...(topLevelEligibility === undefined ? {} : { launchEligibility: topLevelEligibility })
      };
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
          assert.equal(init?.method ?? "GET", "GET", name);
          return jsonResponse(response);
        },
        stdout: (line) => { output += `${line}\n`; }
      });
      assert.equal(code, 1, name);
      assert.equal(requestCount, 1, name);
      const parsed = JSON.parse(output) as Record<string, unknown>;
      assert.equal(parsed.reason, "launch_not_eligible", name);
      assert.equal(parsed.field, "launchEligibility", name);
      assert.equal(output.includes("launch_eligibility_test_token_do_not_print"), false, name);
    }
  });

  it("requires the eligible contract on the exact deploy item too", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-launch-item-eligibility-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://liskov.test",
      sessionToken: "launch_item_test_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    for (const [name, itemEligibility] of [["missing", undefined], ["unknown", eligibility("future_server_code")]] as const) {
      let output = "";
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
        fetchImpl: async () => jsonResponse({
          ok: true,
          launchEligibility: eligibility("eligible_now"),
          actionPlan: { count: 1, items: [deployPlanItem(itemEligibility)] }
        }),
        stdout: (line) => { output += `${line}\n`; }
      });
      assert.equal(code, 1, name);
      const parsed = JSON.parse(output) as Record<string, unknown>;
      assert.equal(parsed.reason, "launch_plan_item_not_eligible", name);
      assert.equal(parsed.field, "actionPlan.items.launchEligibility", name);
    }
  });

  it("guards the direct execution submit path with the same fresh eligibility evidence", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-submit-eligibility-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://liskov.test",
      sessionToken: "launch_submit_test_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    let requestCount = 0;
    let output = "";
    const code = await runSlipwayCustodyExecutionSubmit({
      applicationRef: "app-uid-1",
      planItemId: "plan-1",
      idempotencyKey: "key-1",
      config: sessionFile,
      json: true,
      yes: true,
      yesSpend: true
    }, {
      fetchImpl: async (_url, init) => {
        requestCount += 1;
        assert.equal(init?.method ?? "GET", "GET");
        return jsonResponse({
          ok: true,
          launchEligibility: eligibility("one_shot_consumed"),
          actionPlan: { count: 1, items: [deployPlanItem(eligibility("eligible_now"))] }
        });
      },
      stdout: (line) => { output += `${line}\n`; }
    });

    assert.equal(code, 1);
    assert.equal(requestCount, 1);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    assert.equal(parsed.error, "SLIPWAY_CUSTODY_EXECUTION_SUBMIT_PREFLIGHT_REJECTED");
    assert.equal(parsed.reason, "launch_not_eligible");
    assert.equal(parsed.launchEligibilityCode, "one_shot_consumed");
    assert.equal(output.includes("launch_submit_test_token_do_not_print"), false);
  });

  it("renders the initial-funding wait as a wait, not a customer funding failure", () => {
    const read = readLaunchEligibility({
      schema: "proof.liskov.launch-eligibility.v1",
      code: "blocked",
      evidenceAuthority: "canonical_launch_preflight",
      userActionable: false,
      nextAction: "wait_for_initial_funding",
      blockerCodes: ["awaiting_initial_funding"]
    });
    assert.equal(read.known, true);
    assert.equal(read.eligible, false);
    assert.match(
      formatLaunchEligibility(read),
      /waiting for initial ACU funding \(typically under a minute\)/u
    );
    assert.doesNotMatch(formatLaunchEligibility(read), /next resolve_blockers/u);
  });

  it("does not repeat a preview ready claim when eligibility is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-preview-eligibility-"));
    const sessionFile = path.join(dir, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://liskov.test",
      sessionToken: "launch_preview_test_token_do_not_print",
      savedAtMs: 0
    }, { config: sessionFile });

    let output = "";
    const code = await runSlipwayCustodyPreflight({
      applicationRef: "app-uid-1",
      previewPaused: true,
      config: sessionFile
    }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        mode: "paused_preview",
        pausedPreview: { status: "ready", itemCount: 1, readyCount: 1, items: [{}] }
      }),
      stdout: (line) => { output += `${line}\n`; }
    });

    assert.equal(code, 0);
    assert.match(output, /Paused read-only preflight for app-uid-1: unavailable; 0\/1 deploy item\(s\) ready\./u);
    assert.match(output, /Launch eligibility: unavailable \(missing\)\./u);
    assert.doesNotMatch(output, /: ready; 1\/1/u);
  });
});

function eligibility(code: string): Record<string, unknown> {
  return {
    schema: "proof.liskov.launch-eligibility.v1",
    code,
    evidenceAuthority: "test_authority",
    userActionable: code === "blocked",
    ...(code === "blocked" ? { nextAction: "resolve_blockers", blockerCodes: ["test_blocker"] } : {})
  };
}

function deployPlanItem(launchEligibility: unknown): Record<string, unknown> {
  return {
    planItemId: "plan-1",
    idempotencyKey: "key-1",
    kind: "acurast.deploy",
    policyDigest: "policy-digest-1",
    executorMode: "custodial.live",
    blockers: [],
    ...(launchEligibility === undefined ? {} : { launchEligibility })
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
