import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import AdjudicateLineageCommand from "../src/commands/liskov/admin/retirement/adjudicate-lineage.js";
import {
  runSlipwayAdminRetirementAdjudicateLineage,
  saveSlipwaySession,
  type SlipwayAdminRetirementAdjudicateLineageInput
} from "../src/index.js";

const EVIDENCE = "a".repeat(64);
const FINGERPRINT = `sha256:${"b".repeat(64)}`;

describe("retirement lineage adjudication CLI", () => {
  it("declares the exact identity, state, and evidence guards as required", () => {
    const requiredFlags = [
      "operation",
      "expect-organization",
      "expect-application",
      "expect-application-uid",
      "expect-operation-kind",
      "expect-operation-status",
      "expect-deployment",
      "expect-job",
      "expect-reserve",
      "expect-reserve-status",
      "expect-billing-transaction",
      "expect-billing-status",
      "actor-id",
      "evidence-ref",
      "evidence-sha256",
      "reason"
    ];
    for (const flag of requiredFlags) {
      assert.equal((AdjudicateLineageCommand.flags[flag] as { required?: boolean }).required, true, flag);
    }
    assert.equal((AdjudicateLineageCommand.args.uid as { required?: boolean }).required, true);
  });

  it("sends one exact dry run by default and never prints tokens", async () => {
    const fixture = await fixtureFor();
    const requests: Array<{ authorization?: string; body: Record<string, unknown>; url: string }> = [];
    const output = writer();
    const code = await runSlipwayAdminRetirementAdjudicateLineage(fixture.input, {
      fetchImpl: async (url, init) => {
        requests.push(requestRecord(url, init));
        return jsonResponse({
          ok: true,
          dryRun: true,
          eligible: true,
          resolved: false,
          confirmationFingerprint: FINGERPRINT,
          disposition: "finalized_rejection"
        });
      },
      stdout: output.write
    });

    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.url,
      "https://slipway.test/api/admin/applications/uid-adjudicate/retirement/adjudicate-lineage"
    );
    assert.equal(requests[0]?.authorization, `Bearer ${fixture.adminToken}`);
    assert.deepEqual(requests[0]?.body, { ...expectedBody(), confirm: false });
    assert.equal((JSON.parse(output.text) as { dryRun: boolean }).dryRun, true);
    assert.equal(output.text.includes(fixture.adminToken), false);
    assert.equal(output.text.includes(fixture.sessionToken), false);
  });

  it("refuses --confirm without --fingerprint before network access", async () => {
    const fixture = await fixtureFor();
    let fetched = false;
    const output = writer();
    const code = await runSlipwayAdminRetirementAdjudicateLineage({
      ...fixture.input,
      confirm: true
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
      "SLIPWAY_ADMIN_RETIREMENT_ADJUDICATE_LINEAGE_FINGERPRINT_REQUIRED"
    );
  });

  it("with --confirm --fingerprint sends the exact confirmation body once", async () => {
    const fixture = await fixtureFor();
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const output = writer();
    const code = await runSlipwayAdminRetirementAdjudicateLineage({
      ...fixture.input,
      confirm: true,
      confirmationFingerprint: FINGERPRINT
    }, {
      fetchImpl: async (_url, init) => {
        requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return jsonResponse({
          ok: true,
          dryRun: false,
          resolved: true,
          eligible: true,
          idempotentReplay: false,
          confirmationFingerprint: FINGERPRINT
        });
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
    assert.equal((JSON.parse(output.text) as { resolved: boolean }).resolved, true);
  });
});

async function fixtureFor(): Promise<{
  input: SlipwayAdminRetirementAdjudicateLineageInput;
  adminToken: string;
  sessionToken: string;
  sessionFile: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-adjudicate-lineage-"));
  const sessionFile = path.join(dir, "session.json");
  const adminToken = "adjudicate_lineage_admin_token_do_not_print";
  const sessionToken = "adjudicate_lineage_session_token_do_not_print";
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://slipway.test",
    sessionToken,
    savedAtMs: 0
  }, { config: sessionFile });
  return {
    adminToken,
    sessionFile,
    sessionToken,
    input: {
      applicationUid: "uid-adjudicate",
      adminToken,
      config: sessionFile,
      json: true,
      actorId: "admin-1",
      actorKind: "platform_admin",
      evidenceRef: "ticket://k4jz",
      evidenceSha256: EVIDENCE,
      expectApplication: "app-adjudicate",
      expectApplicationUid: "uid-adjudicate",
      expectBillingStatus: "review_required",
      expectBillingTransaction: "tx-adjudicate",
      expectDeployment: "dep-adjudicate",
      expectJob: "job-adjudicate",
      expectOperation: "op-adjudicate",
      expectOperationKind: "deploy_submit",
      expectOperationStatus: "review_required",
      expectOrganization: "org-adjudicate",
      expectReserve: "reserve-adjudicate",
      expectReserveStatus: "review_required",
      reason: "finalized JobRegistrationStartInPast"
    }
  };
}

function expectedBody(): Record<string, unknown> {
  return {
    expectOrganization: "org-adjudicate",
    expectApplication: "app-adjudicate",
    expectApplicationUid: "uid-adjudicate",
    expectOperation: "op-adjudicate",
    expectOperationKind: "deploy_submit",
    expectOperationStatus: "review_required",
    expectDeployment: "dep-adjudicate",
    expectJob: "job-adjudicate",
    expectReserve: "reserve-adjudicate",
    expectReserveStatus: "review_required",
    expectBillingTransaction: "tx-adjudicate",
    expectBillingStatus: "review_required",
    actorKind: "platform_admin",
    actorId: "admin-1",
    reason: "finalized JobRegistrationStartInPast",
    evidenceRef: "ticket://k4jz",
    evidenceSha256: EVIDENCE
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
