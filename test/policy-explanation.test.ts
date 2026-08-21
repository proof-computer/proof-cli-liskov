import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import LiskovApplicationPolicyExplain from "../src/commands/liskov/application/policy/explain.js";
import {
  POLICY_EXPLANATION_SCHEMA,
  formatPolicyExplanation,
  nextActionsFromExplanation,
  parsePolicyExplanation,
  policyExplanationPath
} from "../src/policy-explanation.js";
import {
  runSlipwayApplicationPolicyExplain,
  runSlipwayApplicationStatus,
  saveSlipwaySession
} from "../src/index.js";

const TOKEN = "session-token-that-must-not-be-printed";

function explanationEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    schema: POLICY_EXPLANATION_SCHEMA,
    generatedAtMs: 1,
    publication: {
      outcome: "satisfied",
      code: "publication_committed",
      pointer: "/release",
      provenance: { schemaVersion: 5, policyVersionId: "pv1" },
      completeThrough: 1,
      gaps: [],
      entries: []
    },
    execution: {
      outcome: "refused",
      code: "handler_generation_changed",
      pointer: "/deployment/schedule",
      provenance: { status: "refused" },
      completeThrough: 0,
      gaps: [],
      entries: [{
        sequence: 1,
        domain: "execution",
        decision: "refused",
        code: "handler_generation_changed",
        pointer: "/deployment/schedule",
        summary: "Server refused this rollout.",
        evidenceDigests: ["sha256:aa"],
        recordedAtMs: 1
      }]
    },
    spendCloseout: {
      outcome: "absent",
      code: "no_spend_closeout",
      pointer: "/deployment/spend",
      completeThrough: 0,
      gaps: [],
      entries: []
    },
    managedSsh: {
      outcome: "notApplicable",
      code: "access_ssh_not_authored",
      pointer: "/access/ssh",
      completeThrough: 0,
      gaps: [],
      entries: []
    },
    ...overrides
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

async function withSession(run: (sessionFile: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "proof-policy-explain-"));
  const sessionFile = path.join(directory, "session.json");
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://liskov.test",
    sessionToken: TOKEN,
    savedAtMs: 1
  }, { config: sessionFile });
  try {
    await run(sessionFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("canonical policy explanation adapter", () => {
  it("parses proof.liskov.policy-explanation.v1 and maps server codes to next actions", () => {
    const parsed = parsePolicyExplanation(explanationEnvelope({
      ingress: { outcome: "satisfied" },
      cohort: { id: "hidden" }
    }));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.explanation.schema, POLICY_EXPLANATION_SCHEMA);
    assert.equal(parsed.explanation.publication.outcome, "satisfied");
    assert.equal(parsed.explanation.execution.outcome, "refused");
    assert.equal(parsed.explanation.spendCloseout.outcome, "absent");
    assert.equal(parsed.explanation.managedSsh.outcome, "notApplicable");
    assert.equal("ingress" in parsed.explanation, false);
    assert.equal("cohort" in parsed.explanation, false);
    const actions = Object.fromEntries(parsed.nextActions.map((item) => [item.section, item]));
    assert.match(actions.publication?.action ?? "", /Publication is committed/u);
    assert.match(actions.execution?.action ?? "", /Server refused \(handler_generation_changed\)/u);
    assert.match(actions.spendCloseout?.action ?? "", /not a client recomputation|No spend\/closeout/u);
    assert.match(actions.managedSsh?.action ?? "", /not applicable/iu);
    const human = formatPolicyExplanation(parsed.explanation, parsed.nextActions);
    assert.match(human, /proof\.liskov\.policy-explanation\.v1/u);
    assert.doesNotMatch(human, /ingress|cohort|hooks/u);
  });

  it("refuses to interpret an unknown explanation schema", () => {
    const parsed = parsePolicyExplanation(explanationEnvelope({
      schema: "proof.liskov.policy-explanation.v2"
    }));
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.error, "POLICY_EXPLANATION_UNSUPPORTED_SCHEMA");
  });

  it("drives the shipped explain command through GET view=explanation and does not recompute spend", async () => {
    await withSession(async (sessionFile) => {
      const requests: string[] = [];
      const out = writer();
      const code = await runSlipwayApplicationPolicyExplain({
        applicationId: "app_1",
        config: sessionFile,
        json: true
      }, {
        fetchImpl: async (url, init) => {
          requests.push(String(url));
          assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
          return Response.json(explanationEnvelope({
            managedSsh: {
              outcome: "absent",
              code: "managed_ssh_session_not_on_policy_read",
              pointer: "/access/ssh",
              completeThrough: 0,
              gaps: [],
              entries: []
            }
          }));
        },
        stdout: out.write
      });
      assert.equal(code, 0);
      assert.deepEqual(requests, [`https://liskov.test${policyExplanationPath("app_1")}`]);
      assert.equal(out.text.includes(TOKEN), false);
      const parsed = JSON.parse(out.text) as {
        ok: boolean;
        schema: string;
        explanation: { managedSsh: { code: string } };
        nextActions: Array<{ section: string; code: string | null; action: string }>;
      };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.schema, POLICY_EXPLANATION_SCHEMA);
      assert.equal(parsed.explanation.managedSsh.code, "managed_ssh_session_not_on_policy_read");
      const ssh = parsed.nextActions.find((item) => item.section === "managedSsh");
      assert.match(ssh?.action ?? "", /proof liskov ssh/u);
      assert.doesNotMatch(out.text, /maxServiceCredit|perJob \*|coverageGapMs \+/u);
    });
  });

  it("attaches server explanation outcomes to application status without a second assembler", async () => {
    await withSession(async (sessionFile) => {
      const requests: string[] = [];
      const out = writer();
      const code = await runSlipwayApplicationStatus({
        applicationId: "app_1",
        config: sessionFile,
        json: true
      }, {
        fetchImpl: async (url) => {
          requests.push(String(url));
          if (String(url).includes("view=explanation")) {
            return Response.json(explanationEnvelope());
          }
          return Response.json({
            ok: true,
            application: { applicationId: "app_1", status: "active" },
            activePolicy: { policyVersionId: "pv1", status: "active" }
          });
        },
        stdout: out.write
      });
      assert.equal(code, 0);
      assert.deepEqual(requests, [
        "https://liskov.test/api/applications/app_1",
        `https://liskov.test${policyExplanationPath("app_1")}`
      ]);
      const parsed = JSON.parse(out.text) as {
        explanation: { schema: string; execution: { outcome: string; code: string } };
        nextActions: Array<{ section: string; outcome: string }>;
      };
      assert.equal(parsed.explanation.schema, POLICY_EXPLANATION_SCHEMA);
      assert.equal(parsed.explanation.execution.outcome, "refused");
      assert.ok(parsed.nextActions.some((item) => item.section === "execution" && item.outcome === "refused"));
    });
  });
});

describe("shipped policy explain command over a real HTTP server", () => {
  it("loads LiskovApplicationPolicyExplain and serves retained vocabulary twice", async () => {
    assert.equal(typeof LiskovApplicationPolicyExplain.run, "function");
    const parsed = parsePolicyExplanation(explanationEnvelope());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(nextActionsFromExplanation(parsed.explanation).map((item) => item.outcome), [
      "satisfied",
      "refused",
      "absent",
      "notApplicable"
    ]);

    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(request.url, policyExplanationPath("app_1"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(explanationEnvelope()));
    });
    const address = await new Promise<{ port: number }>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const listened = server.address();
        if (listened && typeof listened === "object") resolve({ port: listened.port });
      });
    });
    const directory = await mkdtemp(path.join(tmpdir(), "proof-policy-explain-http-"));
    const sessionFile = path.join(directory, "session.json");
    const slipwayUrl = `http://127.0.0.1:${address.port}`;
    await saveSlipwaySession({
      version: 1,
      slipwayUrl,
      sessionToken: TOKEN,
      savedAtMs: 1
    }, { config: sessionFile });
    try {
      const first = writer();
      const second = writer();
      const firstCode = await runSlipwayApplicationPolicyExplain({
        applicationId: "app_1",
        config: sessionFile,
        json: true,
        slipwayUrl
      }, { stdout: first.write });
      const secondCode = await runSlipwayApplicationPolicyExplain({
        applicationId: "app_1",
        config: sessionFile,
        json: true,
        slipwayUrl
      }, { stdout: second.write });
      assert.equal(firstCode, 0);
      assert.equal(secondCode, 0);
      assert.equal(first.text, second.text);
      assert.match(first.text, /proof\.liskov\.policy-explanation\.v1/u);
      assert.match(first.text, /"outcome":"refused"/u);
      assert.doesNotMatch(first.text, /TOKEN|deferred|ingress|cohort/u);
    } finally {
      server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
