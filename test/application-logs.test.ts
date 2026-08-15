import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runSlipwayApplicationLogs, saveSlipwaySession } from "../src/index.js";

describe("application logs", () => {
  it("maps filters exactly and passes the core JSON response through", async () => {
    const sessionFile = await savedSession("logs_json_token");
    const responseBody = availableResponse([
      { tsMs: 1_720_000_000_000, level: "warn", message: "ready", jobId: "job-1", origin: { kind: "runtime_ssh" } }
    ]);
    let requestedUrl = "";
    let authorization = "";
    const out = writer();
    const code = await runSlipwayApplicationLogs({
      applicationRef: "alpha/beta",
      config: sessionFile,
      deploymentId: "dep-1",
      jobId: "job-1",
      json: true,
      limit: 50,
      origin: "runtime-ssh"
    }, {
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        authorization = (init?.headers as Record<string, string>).authorization;
        return jsonResponse(responseBody);
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.equal(requestedUrl, "https://liskov.test/api/applications/alpha%2Fbeta/logs?limit=50&deploymentId=dep-1&jobId=job-1&origin=runtime_ssh");
    assert.equal(authorization, "Bearer logs_json_token");
    assert.deepEqual(JSON.parse(out.text), responseBody);
  });

  it("renders product origins and escapes terminal control sequences", async () => {
    const sessionFile = await savedSession("logs_human_token");
    const out = writer();
    const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile }, {
      fetchImpl: async () => jsonResponse(availableResponse([
        {
          timestamp: "2026-08-03T12:00:00.000Z",
          level: "warning",
          message: "customer\u001b[2J\nnext",
          jobId: "job-1",
          origin: { kind: "customer" }
        },
        {
          tsMs: 1_720_000_000_000,
          level: "fatal",
          message: "ssh",
          jobId: "job-2",
          origin: { kind: "runtime_ssh" }
        }
      ])),
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.match(out.text, /Application logs for alpha: 2 records\./u);
    assert.match(out.text, /TIMESTAMP LEVEL ORIGIN JOB_ID INSTANCE MESSAGE/u);
    assert.match(out.text, /WARN Application job-1 - customer\\u001b\[2J\\u000anext/u);
    assert.match(out.text, /ERROR Runtime SSH job-2 - ssh/u);
    assert.equal(out.text.includes("\u001b"), false);
  });

  it("renders the INSTANCE column and the origin-count footer", async () => {
    const sessionFile = await savedSession("logs_instance_token");
    const body = availableResponse([
      { tsMs: 1_720_000_000_000, level: "info", message: "boot", jobId: "job-1", runtimeInstanceId: "inst-aa11" },
      { tsMs: 1_720_000_001_000, level: "info", message: "later", jobId: "job-2" }
    ]);
    (body.summary as Record<string, unknown>).originCounts = { customer: 120, runtime_ssh: 4 };
    const out = writer();
    const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile }, {
      fetchImpl: async () => jsonResponse(body),
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.match(out.text, /TIMESTAMP LEVEL ORIGIN JOB_ID INSTANCE MESSAGE/u);
    assert.match(out.text, /INFO Application job-1 inst-aa11 boot/u);
    assert.match(out.text, /INFO Application job-2 - later/u);
    assert.match(out.text, /Origins: customer 120, runtime_ssh 4\./u);
  });

  it("accepts the runtime_ssh origin alias and keeps the wire value", async () => {
    const sessionFile = await savedSession("logs_alias_token");
    let requestedUrl = "";
    const out = writer();
    const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, origin: "runtime_ssh" }, {
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return jsonResponse(availableResponse([]));
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.equal(requestedUrl, "https://liskov.test/api/applications/alpha/logs?origin=runtime_ssh");
  });

  it("exits zero for an honest degraded response and for an empty result", async () => {
    const sessionFile = await savedSession("logs_degraded_token");
    const degraded = writer();
    assert.equal(await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile }, {
      fetchImpl: async () => jsonResponse({
        ok: true,
        generatedAtMs: 1,
        available: false,
        reason: "logging_key_unavailable",
        logs: [],
        summary: {}
      }),
      stdout: degraded.write
    }), 0);
    assert.equal(degraded.text.trim(), "Application logging is unavailable for alpha: logging_key_unavailable.");

    const empty = writer();
    assert.equal(await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile }, {
      fetchImpl: async () => jsonResponse(availableResponse([])),
      stdout: empty.write
    }), 0);
    assert.match(empty.text, /Application logs for alpha: 0 records\./u);
  });

  it("rejects bounds, empty filters, and invalid origins before network I/O", async () => {
    let calls = 0;
    const out = writer();
    const options = {
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(availableResponse([]));
      },
      stdout: out.write
    };
    const inputs = [
      { applicationRef: "alpha", limit: 0 },
      { applicationRef: "alpha", limit: 501 },
      { applicationRef: "alpha", limit: 1.5 },
      { applicationRef: "alpha", deploymentId: "  " },
      { applicationRef: "alpha", jobId: "" },
      { applicationRef: "alpha", origin: "bogus" as "runtime-ssh" },
      { applicationRef: "alpha", event: "  " },
      { applicationRef: "alpha", json: true, follow: true },
      { applicationRef: "alpha", json: true, fromStart: true },
      { applicationRef: "alpha", json: true, ndjson: true },
      { applicationRef: "alpha", json: true, event: "runtime.*" }
    ];
    for (const input of inputs) {
      assert.equal(await runSlipwayApplicationLogs(input, options), 1);
    }
    assert.equal(calls, 0);
    assert.equal((out.text.match(/SLIPWAY_APPLICATION_LOGS_INPUT_INVALID/gu) ?? []).length, inputs.length);
  });

  it("fails closed for auth, not-found, malformed, and transport responses without leaking internals", async () => {
    const token = "logs_secret_bearer";
    const sessionFile = await savedSession(token);
    const cases: Array<{ response?: Response; thrown?: Error; error: string }> = [
      { response: jsonResponse({ ok: false, error: "unauthorized", readError: "secret" }, 401), error: "SLIPWAY_SESSION_UNAUTHORIZED" },
      { response: jsonResponse({ ok: false, error: "application_not_found", readError: "secret" }, 404), error: "SLIPWAY_APPLICATION_NOT_FOUND" },
      { response: jsonResponse({ ok: true, available: true, logs: [], readError: "secret" }), error: "SLIPWAY_APPLICATION_LOGS_RESPONSE_INVALID" },
      { thrown: new Error(`transport exposed ${token} readError=secret`), error: "SLIPWAY_APPLICATION_LOGS_FAILED" }
    ];
    for (const testCase of cases) {
      const out = writer();
      const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, json: true }, {
        fetchImpl: async () => {
          if (testCase.thrown) throw testCase.thrown;
          return testCase.response!;
        },
        stdout: out.write
      });
      assert.equal(code, 1);
      assert.equal((JSON.parse(out.text) as { error: string }).error, testCase.error);
      assert.equal(out.text.includes(token), false);
      assert.equal(out.text.includes("readError"), false);
      assert.equal(out.text.includes("secret"), false);
    }
  });

  it("emits ndjson one-shot output as one raw parseable record per line", async () => {
    const sessionFile = await savedSession("logs_ndjson_token");
    const records = [
      { tsMs: 1_720_000_000_000, level: "warn", message: "escape\u001b[2J", jobId: "job-1", runtimeInstanceId: "inst-1" },
      { event: "runtime.access.granted", nested: { count: 1 } }
    ];
    const out = writer();
    const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, ndjson: true }, {
      fetchImpl: async () => jsonResponse(availableResponse(records)),
      stdout: out.write
    });

    assert.equal(code, 0);
    const lines = out.text.trim().split("\n");
    assert.equal(lines.length, records.length);
    assert.deepEqual(lines.map((line) => JSON.parse(line)), records);
    assert.equal(out.text.includes("TIMESTAMP"), false);
    assert.equal(out.text.includes("Origins:"), false);
    assert.equal(out.text.includes("\u001b"), false);
  });

  it("filters records with the --event glob in human and ndjson output", async () => {
    const sessionFile = await savedSession("logs_event_token");
    const records = [
      { tsMs: 1, event: "runtime.access.granted", jobId: "job-1" },
      { tsMs: 2, event: "runtime.access.denied", jobId: "job-1" },
      { tsMs: 3, event: "billing.charge", jobId: "job-1" },
      { tsMs: 4, message: "no event field", jobId: "job-1" }
    ];
    const human = writer();
    assert.equal(await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, event: "runtime.access.*" }, {
      fetchImpl: async () => jsonResponse(availableResponse(records)),
      stdout: human.write
    }), 0);
    assert.match(human.text, /Application logs for alpha: 2 records\./u);
    assert.equal(human.text.includes("runtime.access.granted"), true);
    assert.equal(human.text.includes("runtime.access.denied"), true);
    assert.equal(human.text.includes("billing.charge"), false);
    assert.equal(human.text.includes("no event field"), false);

    const ndjson = writer();
    assert.equal(await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, event: "runtime.access.*", ndjson: true }, {
      fetchImpl: async () => jsonResponse(availableResponse(records)),
      stdout: ndjson.write
    }), 0);
    assert.deepEqual(ndjson.text.trim().split("\n").map((line) => JSON.parse(line)), records.slice(0, 2));
  });

  it("drains the full history oldest-first with --from-start", async () => {
    const sessionFile = await savedSession("logs_drain_token");
    const requests: string[] = [];
    const pages = [
      cursorResponse([logRecord(1, "alpha"), logRecord(2, "bravo")], { nextCursor: "c1", latestCursor: "L", order: "asc" }),
      cursorResponse([logRecord(3, "charlie")], { nextCursor: "c2" }),
      cursorResponse([], { nextCursor: null })
    ];
    const out = writer();
    const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, fromStart: true, limit: 2 }, {
      fetchImpl: async (url) => {
        requests.push(String(url));
        return jsonResponse(pages[requests.length - 1]);
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [
      "https://liskov.test/api/applications/alpha/logs?limit=2&order=asc",
      "https://liskov.test/api/applications/alpha/logs?limit=2&order=asc&cursor=c1",
      "https://liskov.test/api/applications/alpha/logs?limit=2&order=asc&cursor=c2"
    ]);
    assert.equal((out.text.match(/TIMESTAMP LEVEL ORIGIN JOB_ID INSTANCE MESSAGE/gu) ?? []).length, 1);
    assert.equal(out.text.includes("records."), false);
    assert.equal(out.text.includes("Origins:"), false);
    for (const message of ["alpha", "bravo", "charlie"]) {
      assert.equal((out.text.match(new RegExp(` job-1 - ${message}`, "gu")) ?? []).length, 1);
    }
    assert.equal(out.text.indexOf("bravo") > out.text.indexOf("- alpha"), true);
    assert.equal(out.text.indexOf("charlie") > out.text.indexOf("bravo"), true);
  });

  it("streams with --follow: desc context oldest-first, asc polls, cursor kept on empty pages", async () => {
    const sessionFile = await savedSession("logs_follow_token");
    const requests: string[] = [];
    const sleeps: number[] = [];
    const pages = [
      cursorResponse([logRecord(2, "bravo"), logRecord(1, "alpha")], { nextCursor: "x0", latestCursor: "L0", order: "desc" }),
      cursorResponse([logRecord(3, "charlie")], { nextCursor: "L1" }),
      cursorResponse([], { nextCursor: null }),
      cursorResponse([logRecord(4, "delta")], { nextCursor: "L2" })
    ];
    let polls = 0;
    const out = writer();
    const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, follow: true }, {
      fetchImpl: async (url) => {
        requests.push(String(url));
        return jsonResponse(pages[requests.length - 1]);
      },
      followContinue: () => polls++ < 3,
      sleepMs: async (ms) => {
        sleeps.push(ms);
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [
      "https://liskov.test/api/applications/alpha/logs?order=desc",
      "https://liskov.test/api/applications/alpha/logs?order=asc&cursor=L0",
      "https://liskov.test/api/applications/alpha/logs?order=asc&cursor=L1",
      "https://liskov.test/api/applications/alpha/logs?order=asc&cursor=L1"
    ]);
    assert.deepEqual(sleeps, [2000, 2000, 2000]);
    assert.equal((out.text.match(/TIMESTAMP LEVEL ORIGIN JOB_ID INSTANCE MESSAGE/gu) ?? []).length, 1);
    for (const message of ["alpha", "bravo", "charlie", "delta"]) {
      assert.equal((out.text.match(new RegExp(` job-1 - ${message}`, "gu")) ?? []).length, 1);
    }
    assert.equal(out.text.indexOf("bravo") > out.text.indexOf("- alpha"), true);
    assert.equal(out.text.indexOf("charlie") > out.text.indexOf("bravo"), true);
    assert.equal(out.text.indexOf("delta") > out.text.indexOf("charlie"), true);
  });

  it("continues the follow loop from the drain's last cursor with --from-start --follow", async () => {
    const sessionFile = await savedSession("logs_drain_follow_token");
    const requests: string[] = [];
    const pages = [
      cursorResponse([logRecord(1, "alpha")], { nextCursor: "c1", latestCursor: "L", order: "asc" }),
      cursorResponse([logRecord(2, "bravo")], { nextCursor: "c2" }),
      cursorResponse([], { nextCursor: null }),
      cursorResponse([logRecord(3, "charlie")], { nextCursor: "c3" })
    ];
    let polls = 0;
    const out = writer();
    const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, fromStart: true, follow: true, ndjson: true }, {
      fetchImpl: async (url) => {
        requests.push(String(url));
        return jsonResponse(pages[requests.length - 1]);
      },
      followContinue: () => polls++ < 1,
      sleepMs: async () => {},
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [
      "https://liskov.test/api/applications/alpha/logs?order=asc",
      "https://liskov.test/api/applications/alpha/logs?order=asc&cursor=c1",
      "https://liskov.test/api/applications/alpha/logs?order=asc&cursor=c2",
      "https://liskov.test/api/applications/alpha/logs?order=asc&cursor=c2"
    ]);
    const messages = out.text.trim().split("\n").map((line) => (JSON.parse(line) as { message: string }).message);
    assert.deepEqual(messages, ["alpha", "bravo", "charlie"]);
  });

  it("fails with SLIPWAY_APPLICATION_LOGS_PAGINATION_UNSUPPORTED against an old server", async () => {
    const sessionFile = await savedSession("logs_old_server_token");
    for (const input of [
      { applicationRef: "alpha", config: sessionFile, follow: true },
      { applicationRef: "alpha", config: sessionFile, fromStart: true }
    ]) {
      let calls = 0;
      const out = writer();
      const code = await runSlipwayApplicationLogs(input, {
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse(availableResponse([logRecord(1, "alpha")]));
        },
        stdout: out.write
      });
      assert.equal(code, 1);
      assert.equal(calls, 1);
      assert.match(out.text, /SLIPWAY_APPLICATION_LOGS_PAGINATION_UNSUPPORTED/u);
      assert.match(out.text, /does not support log pagination yet/u);
    }
  });

  it("warns on transient follow failures, exits 1 after 30, and never leaks the token", async () => {
    const token = "logs_follow_secret_bearer";
    const sessionFile = await savedSession(token);
    let calls = 0;
    const out = writer();
    const err = writer();
    const code = await runSlipwayApplicationLogs({ applicationRef: "alpha", config: sessionFile, follow: true, ndjson: true }, {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return jsonResponse(cursorResponse([logRecord(1, "context")], { nextCursor: null, latestCursor: "L0", order: "desc" }));
        }
        throw new Error(`transport exposed ${token} readError=secret`);
      },
      sleepMs: async () => {},
      stderr: err.write,
      stdout: out.write
    });

    assert.equal(code, 1);
    assert.equal(calls, 31);
    assert.equal((err.text.match(/Warning: could not read Liskov Application logs/gu) ?? []).length, 29);
    assert.match(err.text, /after 30 consecutive attempts/u);
    assert.equal(out.text.includes(token), false);
    assert.equal(err.text.includes(token), false);
    assert.equal(err.text.includes("readError"), false);
    for (const line of out.text.trim().split("\n")) {
      assert.equal((JSON.parse(line) as { message: string }).message, "context");
    }
  });
});

function availableResponse(logs: unknown[]): Record<string, unknown> {
  return {
    ok: true,
    generatedAtMs: 1_720_000_000_000,
    available: true,
    logs,
    summary: {
      levels: {},
      levelsByOrigin: {},
      originCounts: {},
      sources: [
        { kind: "application", name: "Application", status: "ok", recordCount: logs.length },
        { kind: "runtime_ssh", name: "Runtime SSH", status: "ok", recordCount: 0 }
      ],
      retentionMs: 3_600_000
    }
  };
}

function cursorResponse(
  logs: unknown[],
  cursors: { nextCursor: string | null; latestCursor?: string; order?: string }
): Record<string, unknown> {
  return {
    ...availableResponse(logs),
    nextCursor: cursors.nextCursor,
    latestCursor: cursors.latestCursor ?? "latest-0",
    order: cursors.order ?? "asc"
  };
}

function logRecord(tsMs: number, message: string): Record<string, unknown> {
  return { tsMs, level: "info", message, jobId: "job-1" };
}

async function savedSession(token: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "proof-liskov-logs-"));
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
