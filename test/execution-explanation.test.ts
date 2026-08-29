import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import LiskovApplicationExecutionShow from "../src/commands/liskov/application/execution/show.js";
import {
  executionChanges,
  executionDigest,
  executionStableBlocker,
  executionTerminal,
  executionView,
  formatExecutionExplanation,
  formatExecutionStatusLine,
  spendView
} from "../src/execution-explanation.js";
import { POLICY_EXPLANATION_SCHEMA, parsePolicyExplanation, policyExplanationPath } from "../src/policy-explanation.js";
import { runSlipwayApplicationExecutionShow, runSlipwayApplicationStatus, saveSlipwaySession } from "../src/index.js";

const TOKEN = "session-token-that-must-not-be-printed";

interface EffectOverrides {
  state?: string;
  effectKind?: string;
  receipts?: Record<string, unknown>;
  observationStatus?: string | null;
  closeoutOutcome?: string | null;
  jobId?: string | null;
  refusal?: { code: string } | null;
}

function effect(overrides: EffectOverrides = {}): Record<string, unknown> {
  return {
    operationId: "v5-attempt:app_1:slot-0:g1:r6:provider_deploy:job-0",
    operationRevision: 1,
    effectKind: overrides.effectKind ?? "provider_deploy",
    envelopeRevision: 3,
    state: overrides.state ?? "observation_pending",
    restartDirective: null,
    nextActionAtMs: null,
    receipts: overrides.receipts ?? { submission: null, observation: true, reconciliation: false, closeout: false },
    observationStatus: overrides.observationStatus === undefined ? "terminal" : overrides.observationStatus,
    closeoutOutcome: overrides.closeoutOutcome === undefined ? null : overrides.closeoutOutcome,
    jobId: overrides.jobId === undefined ? "155065" : overrides.jobId,
    traceId: "policy-trace:sha256:aa",
    lastTraceSequence: 2,
    traceTerminal: false,
    refusal: overrides.refusal ?? null
  };
}

function entry(sequence: number, decision: string, code: string): Record<string, unknown> {
  return {
    sequence,
    domain: "external_mutation",
    decision,
    code,
    pointer: null,
    summary: `entry ${sequence}`,
    evidenceDigests: [],
    recordedAtMs: sequence
  };
}

function typedSpineEnvelope(
  execution: Record<string, unknown> = {},
  spend: Record<string, unknown> = {}
): Record<string, unknown> {
  const executionProvenance = {
    source: "typed_spine",
    occurrenceId: "policy-occurrence:sha256:11",
    attemptId: "v5-attempt:app_1:slot-0:g1:r6",
    authorityRevision: 6,
    occurrenceAuthorityDigest: "sha256:22",
    domainsBound: true,
    stage: "effect_observed",
    effect: effect(),
    attempts: [{
      attemptId: "v5-attempt:app_1:slot-0:g1:r6",
      occurrenceId: "policy-occurrence:sha256:11",
      authorityRevision: 6,
      selected: true,
      effects: [{ effectKind: "provider_deploy", operationId: "op-1", operationRevision: 1, state: "observation_pending" }]
    }],
    attemptsTruncated: false,
    blocker: null,
    refusal: null,
    ...(execution.provenance as Record<string, unknown> | undefined ?? {})
  };
  const spendProvenance = {
    source: "typed_spine",
    reservationId: "v5-reserve:app_1:g1:r6",
    settlementEffect: null,
    lineages: [{
      linkedReservationId: "v5-reserve:app_1:g1:r6",
      exposureId: null,
      unit: "service_credit_micros",
      amount: "0",
      reservationAtMs: 10,
      exposureState: "open_reserve",
      settlementDisposition: null,
      closeoutId: null
    }],
    reserveCount: 1,
    settlementCount: 0,
    refusal: null,
    ...(spend.provenance as Record<string, unknown> | undefined ?? {})
  };
  return {
    ok: true,
    schema: POLICY_EXPLANATION_SCHEMA,
    generatedAtMs: 1,
    publication: {
      outcome: "satisfied",
      code: "publication_committed",
      pointer: "/release",
      provenance: { policyVersionId: "pv1" },
      completeThrough: 1,
      gaps: [],
      entries: []
    },
    execution: {
      outcome: execution.outcome ?? "satisfied",
      code: execution.code ?? "occurrence_in_progress",
      pointer: "/execution",
      provenance: executionProvenance,
      completeThrough: execution.completeThrough ?? 2,
      gaps: execution.gaps ?? [],
      entries: execution.entries ?? [entry(1, "intended", "intent_committed"), entry(2, "observed", "observed_terminal")]
    },
    spendCloseout: {
      outcome: spend.outcome ?? "satisfied",
      code: spend.code ?? "spend_reserved",
      pointer: "/deployment/spend",
      provenance: spendProvenance,
      completeThrough: spend.completeThrough ?? 0,
      gaps: [],
      entries: spend.entries ?? []
    },
    managedSsh: {
      outcome: "notApplicable",
      code: "access_ssh_not_authored",
      pointer: "/access/ssh",
      completeThrough: 0,
      gaps: [],
      entries: []
    }
  };
}

function rolloutEnvelope(): Record<string, unknown> {
  return {
    ok: true,
    schema: POLICY_EXPLANATION_SCHEMA,
    generatedAtMs: 1,
    publication: { outcome: "absent", code: "policy_not_published", pointer: "/", completeThrough: 0, gaps: [], entries: [] },
    execution: {
      outcome: "satisfied",
      code: "rollout_in_progress_or_ready",
      pointer: "/deployment/schedule",
      provenance: { itemCount: 1, statuses: ["ready"] },
      completeThrough: 1,
      gaps: [],
      entries: []
    },
    spendCloseout: {
      outcome: "satisfied",
      code: "rollout_spend_window",
      pointer: "/deployment/spend",
      provenance: { coverageGapMs: [0], ceaseAcknowledgedAtMs: [null] },
      completeThrough: 1,
      gaps: [],
      entries: []
    },
    managedSsh: { outcome: "notApplicable", code: "access_ssh_not_authored", pointer: "/access/ssh", completeThrough: 0, gaps: [], entries: [] }
  };
}

function parse(body: Record<string, unknown>) {
  const parsed = parsePolicyExplanation(body);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.explanation;
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
  const directory = await mkdtemp(path.join(tmpdir(), "proof-execution-show-"));
  const sessionFile = path.join(directory, "session.json");
  await saveSlipwaySession({ version: 1, slipwayUrl: "https://liskov.test", sessionToken: TOKEN, savedAtMs: 1 }, { config: sessionFile });
  try {
    await run(sessionFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("typed-spine execution view", () => {
  it("projects the server's facts and never invents a missing one", () => {
    const view = executionView(parse(typedSpineEnvelope()));
    assert.equal(view.source, "typed_spine");
    assert.equal(view.code, "occurrence_in_progress");
    assert.equal(view.attemptId, "v5-attempt:app_1:slot-0:g1:r6");
    assert.equal(view.stage, "effect_observed");
    assert.equal(view.effect?.jobId, "155065");
    assert.equal(view.effect?.receipts.submission, null, "candidate lane reports no submission leg");
    assert.equal(view.effect?.receipts.observation, true);
    assert.equal(view.attempts.length, 1);
    assert.equal(view.attempts[0]?.selected, true);
    assert.equal(view.blocker, null);
    assert.equal(view.entries.length, 2);

    const spend = spendView(parse(typedSpineEnvelope()));
    assert.equal(spend.reservationId, "v5-reserve:app_1:g1:r6");
    assert.equal(spend.lineages[0]?.amount, "0", "zero is a reported amount, not an absence");
    assert.equal(spend.lineages[0]?.exposureState, "open_reserve");
    assert.equal(spend.lineages[0]?.settlementDisposition, null);
  });

  it("renders unreported facts as 'not reported' rather than a guess", () => {
    const envelope = typedSpineEnvelope({
      provenance: {
        stage: null,
        effect: effect({ state: "intent_committed", observationStatus: null, jobId: null }),
        attempts: []
      }
    }, {
      provenance: { reservationId: null, lineages: [{ linkedReservationId: "r1", exposureId: null, unit: null, amount: null, reservationAtMs: null, exposureState: null, settlementDisposition: null, closeoutId: null }] }
    });
    const text = formatExecutionExplanation(parse(envelope));
    assert.match(text, /stage: not reported/);
    assert.match(text, /reservation not reported/);
    assert.match(text, /amount not reported/);
    assert.doesNotMatch(text, /undefined|null/);
  });

  it("reads the rollout-row path without claiming a typed-spine occurrence", () => {
    const explanation = parse(rolloutEnvelope());
    assert.equal(executionView(explanation).source, "rollout");
    assert.equal(formatExecutionStatusLine(explanation), undefined);
    assert.equal(executionTerminal(explanation).terminal, false);
    assert.equal(executionStableBlocker(explanation), null);
    const text = formatExecutionExplanation(explanation);
    assert.match(text, /no typed-spine occurrence/);
  });

  it("maps every closed code to a server-sourced next action", () => {
    const codes = [
      ["occurrence_in_progress", "satisfied"],
      ["occurrence_blocked", "refused"],
      ["effect_terminal_failed", "refused"],
      ["occurrence_complete", "satisfied"],
      ["spend_not_reserved", "absent"],
      ["spend_reserved", "satisfied"],
      ["settlement_in_progress", "satisfied"],
      ["spend_settled", "satisfied"],
      ["spend_reclaimed", "satisfied"],
      ["settlement_refused", "refused"],
      ["spend_unknown_review", "refused"],
      ["spine_checkpoint_locked", "refused"],
      ["effect_trace_gap", "refused"],
      ["execution_truth_unreadable", "refused"]
    ] as const;
    for (const [code, outcome] of codes) {
      const envelope = typedSpineEnvelope({ code, outcome });
      const text = formatExecutionExplanation(parse(envelope));
      assert.match(text, new RegExp(`execution: ${outcome} \\[${code}\\]`), code);
      assert.doesNotMatch(text, /next: Server refused \(unspecified\)/, code);
    }
    // An unknown future code still renders, through the outcome fallback.
    const future = formatExecutionExplanation(parse(typedSpineEnvelope({ code: "future_server_code", outcome: "refused" })));
    assert.match(future, /Server refused \(future_server_code\)/);
  });

  it("distinguishes a persisted blocker from one the producer never wrote", () => {
    const persisted = parse(typedSpineEnvelope({
      outcome: "refused",
      code: "occurrence_blocked",
      provenance: {
        blocker: { stage: "effect_observed", code: "deploy_submit_final_jit_authority_expired", provenance: "persisted", available: true, nextAction: "Read the persisted decision." }
      }
    }));
    assert.equal(executionStableBlocker(persisted), "deploy_submit_final_jit_authority_expired");
    assert.match(formatExecutionExplanation(persisted), /blocker: deploy_submit_final_jit_authority_expired \[persisted\]/);

    const absent = parse(typedSpineEnvelope({
      outcome: "refused",
      code: "occurrence_blocked",
      provenance: { blocker: { stage: "effect_observed", code: null, provenance: "not_persisted", available: false, nextAction: null } }
    }));
    assert.equal(executionStableBlocker(absent), null, "an unavailable blocker is not a stable stop");
    assert.match(formatExecutionExplanation(absent), /blocker: not reported \[not_persisted, unavailable\]/);
  });

  it("reports a trace gap without fabricating the missing entry", () => {
    const explanation = parse(typedSpineEnvelope({
      outcome: "refused",
      code: "effect_trace_gap",
      completeThrough: 1,
      gaps: [{ firstMissing: 2, lastMissing: 2 }],
      entries: [entry(1, "intended", "intent_committed"), entry(3, "observed", "observed_terminal")]
    }));
    const text = formatExecutionExplanation(explanation);
    assert.match(text, /complete through 1; 1 gap reported/);
    assert.doesNotMatch(text, /^ +2 external_mutation/mu);
  });

  it("names terminal success and terminal failure from the server's code", () => {
    const complete = parse(typedSpineEnvelope({ code: "occurrence_complete" }));
    assert.deepEqual(executionTerminal(complete), { terminal: true, success: true });
    const failed = parse(typedSpineEnvelope({ outcome: "refused", code: "effect_terminal_failed" }));
    assert.deepEqual(executionTerminal(failed), { terminal: true, success: false });
    const running = parse(typedSpineEnvelope());
    assert.deepEqual(executionTerminal(running), { terminal: false, success: false });
  });

  it("digests semantic facts only, and names the exact changed paths", () => {
    const before = parse(typedSpineEnvelope());
    const sameFactsLaterRead = parse({ ...typedSpineEnvelope(), generatedAtMs: 99 });
    assert.equal(executionDigest(before), executionDigest(sameFactsLaterRead), "a later read of identical facts is not a change");
    assert.deepEqual(executionChanges(before, sameFactsLaterRead), []);

    const after = parse(typedSpineEnvelope({
      code: "occurrence_complete",
      provenance: { stage: "effect_closed", effect: effect({ state: "closed", closeoutOutcome: "completed", receipts: { submission: null, observation: true, reconciliation: false, closeout: true } }) }
    }, { code: "spend_reclaimed", provenance: { lineages: [{ linkedReservationId: "v5-reserve:app_1:g1:r6", exposureId: null, unit: "service_credit_micros", amount: "0", reservationAtMs: 10, exposureState: null, settlementDisposition: "reclaim", closeoutId: "closeout-1" }] } }));
    assert.notEqual(executionDigest(before), executionDigest(after));
    const paths = executionChanges(before, after).map((change) => change.path);
    assert.ok(paths.includes("execution.code"));
    assert.ok(paths.includes("execution.stage"));
    assert.ok(paths.includes("execution.effectState"));
    assert.ok(paths.includes("spendCloseout.code"));
    assert.ok(paths.includes("spendCloseout.lineages[0].settlementDisposition"));
  });
});

describe("application execution show", () => {
  it("reads the canonical envelope once and prints the verbatim body with --json", async () => {
    await withSession(async (sessionFile) => {
      const requests: string[] = [];
      const out = writer();
      const body = typedSpineEnvelope();
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile, json: true }, {
        fetchImpl: async (url) => {
          requests.push(String(url));
          return Response.json(body);
        },
        stdout: out.write
      });
      assert.equal(code, 0);
      assert.deepEqual(requests, [`https://liskov.test${policyExplanationPath("app_1")}`]);
      assert.deepEqual(JSON.parse(out.text), body, "--json is the verbatim server envelope");
      assert.equal(out.text.includes(TOKEN), false);
    });
  });

  it("renders the human execution surface without recomputing anything", async () => {
    await withSession(async (sessionFile) => {
      const out = writer();
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile }, {
        fetchImpl: async () => Response.json(typedSpineEnvelope()),
        stdout: out.write
      });
      assert.equal(code, 0);
      assert.match(out.text, /execution: satisfied \[occurrence_in_progress\]/);
      assert.match(out.text, /occurrence policy-occurrence:sha256:11/);
      assert.match(out.text, /stage: .*\[effect_observed\]/);
      assert.match(out.text, /job 155065/);
      assert.match(out.text, /lineage v5-reserve:app_1:g1:r6: 0 service_credit_micros; open_reserve/);
      assert.equal(out.text.includes(TOKEN), false);
    });
  });

  it("refuses an unknown envelope schema instead of interpreting it", async () => {
    await withSession(async (sessionFile) => {
      const out = writer();
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile, json: true }, {
        fetchImpl: async () => Response.json({ ...typedSpineEnvelope(), schema: "proof.liskov.policy-explanation.v2" }),
        stdout: out.write
      });
      assert.equal(code, 1);
      assert.equal(JSON.parse(out.text).error, "POLICY_EXPLANATION_UNSUPPORTED_SCHEMA");
    });
  });

  it("rejects invalid watch flags with exit 2 before sending a request", async () => {
    await withSession(async (sessionFile) => {
      const out = writer();
      let requested = false;
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile, json: true, watch: true, pollMs: 100 }, {
        fetchImpl: async () => {
          requested = true;
          return Response.json(typedSpineEnvelope());
        },
        stdout: out.write
      });
      assert.equal(code, 2);
      assert.equal(requested, false);
      assert.equal(JSON.parse(out.text).error, "SLIPWAY_APPLICATION_EXECUTION_INPUT_INVALID");
    });
  });

  it("watches until the occurrence completes, emitting one record per semantic change", async () => {
    await withSession(async (sessionFile) => {
      const out = writer();
      const bodies = [
        typedSpineEnvelope(),
        typedSpineEnvelope(),
        typedSpineEnvelope({ provenance: { stage: "effect_closed", effect: effect({ state: "closeout_started" }) } }),
        typedSpineEnvelope({ code: "occurrence_complete", provenance: { stage: "effect_closed", effect: effect({ state: "closed", closeoutOutcome: "completed" }) } }, { code: "spend_reclaimed" })
      ];
      let index = 0;
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile, json: true, watch: true }, {
        fetchImpl: async () => Response.json(bodies[Math.min(index++, bodies.length - 1)]),
        sleepMs: async () => {},
        stdout: out.write,
        nowMs: () => 1_000
      });
      assert.equal(code, 0, "a completed occurrence exits zero");
      const records = out.text.trim().split("\n").map((line) => JSON.parse(line) as { sequence: number; changedPaths: { path: string }[] });
      assert.equal(records.length, 3, "record zero, the closeout_started change, and the completion");
      assert.equal(records[0]?.sequence, 0);
      assert.deepEqual(records[0]?.changedPaths, []);
      assert.ok(records[1]?.changedPaths.some((change) => change.path === "execution.effectState"));
      assert.ok(records[2]?.changedPaths.some((change) => change.path === "execution.code"));
      assert.equal(out.text.includes(TOKEN), false);
    });
  });

  it("stops on a persisted blocker unless --until-terminal keeps watching", async () => {
    const blocked = typedSpineEnvelope({
      outcome: "refused",
      code: "occurrence_blocked",
      provenance: { blocker: { stage: "effect_observed", code: "v5_settlement_intent_refused", provenance: "persisted", available: true, nextAction: "Read the persisted decision." } }
    });
    await withSession(async (sessionFile) => {
      const out = writer();
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile, watch: true }, {
        fetchImpl: async () => Response.json(blocked),
        sleepMs: async () => {},
        stdout: out.write,
        nowMs: () => 1_000
      });
      assert.equal(code, 1, "a stable persisted blocker is a non-zero stop");
      assert.match(out.text, /blocker: v5_settlement_intent_refused \[persisted\]/);
    });
    await withSession(async (sessionFile) => {
      const out = writer();
      let polls = 0;
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile, watch: true, untilTerminal: true }, {
        fetchImpl: async () => Response.json(blocked),
        sleepMs: async () => {},
        followContinue: () => polls++ < 3,
        stdout: out.write,
        nowMs: () => 1_000
      });
      assert.equal(code, 0);
      assert.ok(polls >= 3, "--until-terminal keeps polling through the blocker");
    });
  });

  it("times out non-zero with the last verified snapshot", async () => {
    await withSession(async (sessionFile) => {
      const out = writer();
      let now = 0;
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile, json: true, watch: true, timeoutSeconds: 1 }, {
        fetchImpl: async () => Response.json(typedSpineEnvelope()),
        sleepMs: async () => {},
        stdout: out.write,
        nowMs: () => (now += 2_000)
      });
      assert.equal(code, 1);
      const records = out.text.trim().split("\n").map((line) => JSON.parse(line) as { final?: string; explanation?: unknown });
      assert.equal(records.at(-1)?.final, "timeout");
      assert.ok(records.at(-1)?.explanation, "the timeout record carries the last verified envelope");
    });
  });

  it("retries a transient read failure and does not emit a change for it", async () => {
    await withSession(async (sessionFile) => {
      const out = writer();
      const errors: string[] = [];
      let call = 0;
      let polls = 0;
      const code = await runSlipwayApplicationExecutionShow({ applicationId: "app_1", config: sessionFile, json: true, watch: true }, {
        fetchImpl: async () => {
          call += 1;
          if (call === 2) return new Response("boom", { status: 503 });
          return Response.json(call >= 3
            ? typedSpineEnvelope({ code: "occurrence_complete", provenance: { stage: "effect_closed", effect: effect({ state: "closed", closeoutOutcome: "completed" }) } })
            : typedSpineEnvelope());
        },
        sleepMs: async () => {},
        followContinue: () => polls++ < 6,
        stdout: out.write,
        stderr: (line) => errors.push(line),
        nowMs: () => 1_000
      });
      assert.equal(code, 0);
      assert.ok(errors.some((line) => line.includes("retrying")), "a transient failure warns instead of failing");
      const records = out.text.trim().split("\n");
      assert.equal(records.length, 2, "the failed poll produced no record");
    });
  });
});

describe("shipped execution show command over a real HTTP server", () => {
  it("loads the oclif command and serves the typed-spine surface", async () => {
    assert.equal(typeof LiskovApplicationExecutionShow.run, "function");
    const requests: string[] = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(typedSpineEnvelope()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      await withSession(async (sessionFile) => {
        for (const pass of [1, 2]) {
          const out = writer();
          const code = await runSlipwayApplicationExecutionShow({
            applicationId: "app_1",
            config: sessionFile,
            slipwayUrl: `http://127.0.0.1:${port}`
          }, { stdout: out.write });
          assert.equal(code, 0, `pass ${pass}`);
          assert.match(out.text, /execution: satisfied \[occurrence_in_progress\]/);
          assert.equal(out.text.includes(TOKEN), false);
        }
      });
      assert.deepEqual(requests, [policyExplanationPath("app_1"), policyExplanationPath("app_1")]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("application status carries the execution line", () => {
  it("adds one execution line for a typed-spine application and none otherwise", async () => {
    await withSession(async (sessionFile) => {
      const out = writer();
      const code = await runSlipwayApplicationStatus({ applicationId: "app_1", config: sessionFile }, {
        fetchImpl: async (url) => String(url).includes("view=explanation")
          ? Response.json(typedSpineEnvelope())
          : Response.json({ ok: true, application: { applicationId: "app_1", status: "active" } }),
        stdout: out.write
      });
      assert.equal(code, 0);
      assert.match(out.text, /execution: satisfied \[occurrence_in_progress\]; stage effect_observed; effect observation_pending; job 155065/);
    });
    await withSession(async (sessionFile) => {
      const out = writer();
      const code = await runSlipwayApplicationStatus({ applicationId: "app_1", config: sessionFile }, {
        fetchImpl: async (url) => String(url).includes("view=explanation")
          ? Response.json(rolloutEnvelope())
          : Response.json({ ok: true, application: { applicationId: "app_1", status: "active" } }),
        stdout: out.write
      });
      assert.equal(code, 0);
      assert.doesNotMatch(out.text, /stage/, "a V4 application gains no execution line");
    });
  });
});
