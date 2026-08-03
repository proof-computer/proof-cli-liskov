import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import RecoverDeploySubmitCommand from "../src/commands/liskov/admin/executor-operation/recover-deploy-submit.js";
import {
  runSlipwayAdminDeploySubmitRecovery,
  saveSlipwaySession,
  type SlipwayAdminDeploySubmitRecoveryInput
} from "../src/index.js";

const BLOCK_HASH = `0x${"1".repeat(64)}`;
const TRANSACTION_HASH = `0x${"2".repeat(64)}`;
const PROOF_FINGERPRINT = `sha256:${"3".repeat(64)}`;

describe("deploy-submit recovery CLI", () => {
  it("declares every identity, state, and finalized-chain guard as required", () => {
    const requiredFlags = [
      "expect-organization",
      "expect-application",
      "expect-application-uid",
      "expect-deployment",
      "expect-local-job",
      "expect-execution",
      "expect-proposal",
      "expect-reserve",
      "expect-operation-status",
      "expect-local-job-status",
      "expect-reserve-status",
      "finalized-block-number",
      "finalized-block-hash",
      "extrinsic-index",
      "transaction-hash",
      "reason"
    ];
    for (const flag of requiredFlags) {
      assert.equal((RecoverDeploySubmitCommand.flags[flag] as { required?: boolean }).required, true, flag);
    }
    assert.equal((RecoverDeploySubmitCommand.args.operation_id as { required?: boolean }).required, true);
  });

  it("sends one exact dry run by default and emits only the server JSON", async () => {
    const fixture = await recoveryFixture();
    const requests: Array<{ authorization?: string; body: Record<string, unknown>; url: string }> = [];
    const output = writer();
    const code = await runSlipwayAdminDeploySubmitRecovery(fixture.input, {
      fetchImpl: async (url, init) => {
        requests.push(requestRecord(url, init));
        return jsonResponse({
          ok: true,
          mode: "dry_run",
          operationId: fixture.input.operationId,
          proofFingerprint: PROOF_FINGERPRINT,
          plannedSteps: ["attempt_submitted"]
        });
      },
      stdout: output.write
    });

    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://slipway.test/api/admin/executor-operations/op-ambiguous%2F1/recover-deploy-submit");
    assert.equal(requests[0]?.authorization, `Bearer ${fixture.adminToken}`);
    assert.deepEqual(requests[0]?.body, {
      ...expectedBindings(),
      confirm: false
    });
    assert.deepEqual(JSON.parse(output.text), {
      ok: true,
      mode: "dry_run",
      operationId: fixture.input.operationId,
      proofFingerprint: PROOF_FINGERPRINT,
      plannedSteps: ["attempt_submitted"]
    });
    assert.equal(output.text.trim().split("\n").length, 1);
    assert.equal(output.text.includes(fixture.adminToken), false);
    assert.equal(output.text.includes(fixture.sessionToken), false);
  });

  it("with --yes confirms only after an exact successful dry run and reuses unchanged bindings", async () => {
    const fixture = await recoveryFixture();
    const requests: Array<{ authorization?: string; body: Record<string, unknown>; url: string }> = [];
    const output = writer();
    const code = await runSlipwayAdminDeploySubmitRecovery({ ...fixture.input, yes: true }, {
      fetchImpl: async (url, init) => {
        const request = requestRecord(url, init);
        requests.push(request);
        if (request.body.confirm === false) {
          return jsonResponse({
            ok: true,
            mode: "dry_run",
            operationId: fixture.input.operationId,
            proofFingerprint: PROOF_FINGERPRINT,
            plannedSteps: ["attempt_submitted", "proposal_submitted"]
          });
        }
        return jsonResponse({
          ok: true,
          mode: "confirm",
          operationId: fixture.input.operationId,
          proofFingerprint: PROOF_FINGERPRINT,
          appliedSteps: ["attempt_submitted", "proposal_submitted"],
          idempotentReplay: false
        });
      },
      stdout: output.write
    });

    assert.equal(code, 0);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0]?.body, { ...expectedBindings(), confirm: false });
    assert.deepEqual(requests[1]?.body, {
      ...expectedBindings(),
      confirm: true,
      confirmationFingerprint: PROOF_FINGERPRINT
    });
    assert.deepEqual(JSON.parse(output.text), {
      ok: true,
      mode: "confirm",
      operationId: fixture.input.operationId,
      proofFingerprint: PROOF_FINGERPRINT,
      appliedSteps: ["attempt_submitted", "proposal_submitted"],
      idempotentReplay: false
    });
    assert.equal(output.text.trim().split("\n").length, 1);
    assert.equal(output.text.includes(fixture.adminToken), false);
    assert.equal(output.text.includes(fixture.sessionToken), false);
  });

  it("requires an exact dry-run envelope even without --yes", async (context) => {
    for (const [name, response] of [
      ["missing fingerprint", {
        ok: true,
        mode: "dry_run",
        operationId: "op-ambiguous/1"
      }],
      ["wrong mode", {
        ok: true,
        mode: "confirm",
        operationId: "op-ambiguous/1",
        proofFingerprint: PROOF_FINGERPRINT
      }],
      ["wrong operation", {
        ok: true,
        mode: "dry_run",
        operationId: "op-other",
        proofFingerprint: PROOF_FINGERPRINT
      }]
    ] as const) {
      await context.test(name, async () => {
        const fixture = await recoveryFixture();
        let requestCount = 0;
        const output = writer();
        const code = await runSlipwayAdminDeploySubmitRecovery(fixture.input, {
          fetchImpl: async () => {
            requestCount += 1;
            return jsonResponse(response);
          },
          stdout: output.write
        });
        assert.equal(code, 1);
        assert.equal(requestCount, 1);
        assert.deepEqual(JSON.parse(output.text), {
          ok: false,
          error: "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_DRY_RUN_RESPONSE_INVALID",
          operationId: fixture.input.operationId,
          phase: "dry_run",
          status: 200
        });
      });
    }
  });

  it("never confirms after a failed or malformed dry run", async (context) => {
    await context.test("failed proof", async () => {
      const fixture = await recoveryFixture();
      let requestCount = 0;
      const output = writer();
      const code = await runSlipwayAdminDeploySubmitRecovery({ ...fixture.input, yes: true }, {
        fetchImpl: async () => {
          requestCount += 1;
          return jsonResponse({ ok: false, reason: "state_changed", blockers: ["operation.status"] }, 409);
        },
        stdout: output.write
      });
      assert.equal(code, 1);
      assert.equal(requestCount, 1);
      assert.deepEqual(JSON.parse(output.text), {
        ok: false,
        error: "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_DRY_RUN_FAILED",
        status: 409,
        reason: "state_changed",
        blockers: ["operation.status"],
        operationId: fixture.input.operationId,
        phase: "dry_run",
        slipwayUrl: "https://slipway.test",
        sessionFile: fixture.sessionFile
      });
    });

    await context.test("missing proof fingerprint", async () => {
      const fixture = await recoveryFixture();
      let requestCount = 0;
      const output = writer();
      const code = await runSlipwayAdminDeploySubmitRecovery({ ...fixture.input, yes: true }, {
        fetchImpl: async () => {
          requestCount += 1;
          return jsonResponse({ ok: true, mode: "dry_run", operationId: fixture.input.operationId });
        },
        stdout: output.write
      });
      assert.equal(code, 1);
      assert.equal(requestCount, 1);
      assert.deepEqual(JSON.parse(output.text), {
        ok: false,
        error: "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_DRY_RUN_RESPONSE_INVALID",
        operationId: fixture.input.operationId,
        phase: "dry_run",
        status: 200
      });
    });
  });

  it("rejects repeated dry-run, wrong-operation, and changed-fingerprint confirmation envelopes", async (context) => {
    for (const [name, confirmationBody] of [
      ["repeated dry run", {
        ok: true,
        mode: "dry_run",
        operationId: "op-ambiguous/1",
        proofFingerprint: PROOF_FINGERPRINT
      }],
      ["wrong operation", {
        ok: true,
        mode: "confirm",
        operationId: "op-other",
        proofFingerprint: PROOF_FINGERPRINT
      }],
      ["changed fingerprint", {
        ok: true,
        mode: "confirm",
        operationId: "op-ambiguous/1",
        proofFingerprint: `sha256:${"4".repeat(64)}`
      }]
    ] as const) {
      await context.test(name, async () => {
        const fixture = await recoveryFixture();
        let requestCount = 0;
        const output = writer();
        const code = await runSlipwayAdminDeploySubmitRecovery({ ...fixture.input, yes: true }, {
          fetchImpl: async () => {
            requestCount += 1;
            return requestCount === 1
              ? jsonResponse({
                  ok: true,
                  mode: "dry_run",
                  operationId: fixture.input.operationId,
                  proofFingerprint: PROOF_FINGERPRINT
                })
              : jsonResponse(confirmationBody);
          },
          stdout: output.write
        });
        assert.equal(code, 1);
        assert.equal(requestCount, 2);
        assert.deepEqual(JSON.parse(output.text), {
          ok: false,
          error: "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_CONFIRM_RESPONSE_INVALID",
          operationId: fixture.input.operationId,
          phase: "confirm",
          status: 200
        });
      });
    }
  });

  it("redacts admin and session tokens embedded in thrown request errors", async (context) => {
    for (const throwOnRequest of [1, 2]) {
      await context.test(throwOnRequest === 1 ? "dry run" : "confirmation", async () => {
        const fixture = await recoveryFixture();
        let requestCount = 0;
        const output = writer();
        const code = await runSlipwayAdminDeploySubmitRecovery({ ...fixture.input, yes: true }, {
          fetchImpl: async () => {
            requestCount += 1;
            if (requestCount === throwOnRequest) {
              throw new Error(`request failed with ${fixture.adminToken} and ${fixture.sessionToken}`);
            }
            return jsonResponse({
              ok: true,
              mode: "dry_run",
              operationId: fixture.input.operationId,
              proofFingerprint: PROOF_FINGERPRINT
            });
          },
          stdout: output.write
        });
        assert.equal(code, 1);
        assert.equal(requestCount, throwOnRequest);
        assert.deepEqual(JSON.parse(output.text), {
          ok: false,
          error: "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_FAILED",
          message: "request_failed",
          slipwayUrl: "https://slipway.test",
          sessionFile: fixture.sessionFile
        });
        assert.equal(output.text.includes(fixture.adminToken), false);
        assert.equal(output.text.includes(fixture.sessionToken), false);
      });
    }
  });

  it("rejects malformed exact evidence with exit code 2 before network access", async () => {
    const fixture = await recoveryFixture();
    let fetched = false;
    const output = writer();
    const code = await runSlipwayAdminDeploySubmitRecovery({
      ...fixture.input,
      finalizedBlockHash: "not-a-hash",
      reason: "   "
    }, {
      fetchImpl: async () => {
        fetched = true;
        return jsonResponse({ ok: true });
      },
      stdout: output.write
    });
    assert.equal(code, 2);
    assert.equal(fetched, false);
    assert.deepEqual(JSON.parse(output.text), {
      ok: false,
      error: "SLIPWAY_ADMIN_DEPLOY_SUBMIT_RECOVERY_INPUT_INVALID",
      operationId: fixture.input.operationId,
      invalid: ["reason", "finalized block hash"]
    });
  });
});

async function recoveryFixture(): Promise<{
  input: SlipwayAdminDeploySubmitRecoveryInput;
  adminToken: string;
  sessionToken: string;
  sessionFile: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-deploy-submit-recovery-"));
  const sessionFile = path.join(dir, "session.json");
  const adminToken = "deploy_submit_recovery_admin_token_do_not_print";
  const sessionToken = "deploy_submit_recovery_session_token_do_not_print";
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
      adminToken,
      config: sessionFile,
      expectOrganization: "org-personal",
      expectApplication: "uptime-prober-2",
      expectApplicationUid: "app-b200b9b491eaa3e5cdbb517dd1b0ff75",
      expectDeployment: "dep-a04fbbfe9b67430570660621f334613b",
      expectLocalJob: "job-6fd657c62e411111a370807a3501f290",
      expectExecution: "live-execution:63455c924e454d0a9337927655a01972:r1",
      expectProposal: "proposal-1",
      expectReserve: "deploy-reserve:1",
      expectOperationStatus: "pending",
      expectLocalJobStatus: "proposed",
      expectReserveStatus: "reserved",
      finalizedBlockNumber: 3_929_512,
      finalizedBlockHash: BLOCK_HASH,
      extrinsicIndex: 3,
      transactionHash: TRANSACTION_HASH,
      json: true,
      operationId: "op-ambiguous/1",
      reason: "adopt exact finalized deploy receipt"
    }
  };
}

function expectedBindings(): Record<string, unknown> {
  return {
    expectOrganization: "org-personal",
    expectApplication: "uptime-prober-2",
    expectApplicationUid: "app-b200b9b491eaa3e5cdbb517dd1b0ff75",
    expectDeployment: "dep-a04fbbfe9b67430570660621f334613b",
    expectLocalJob: "job-6fd657c62e411111a370807a3501f290",
    expectExecution: "live-execution:63455c924e454d0a9337927655a01972:r1",
    expectProposal: "proposal-1",
    expectReserve: "deploy-reserve:1",
    expectOperationStatus: "pending",
    expectLocalJobStatus: "proposed",
    expectReserveStatus: "reserved",
    finalizedBlockNumber: 3_929_512,
    finalizedBlockHash: BLOCK_HASH,
    extrinsicIndex: 3,
    transactionHash: TRANSACTION_HASH,
    reason: "adopt exact finalized deploy receipt"
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
