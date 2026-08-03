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
    assert.match(out.text, /TIMESTAMP LEVEL ORIGIN JOB_ID MESSAGE/u);
    assert.match(out.text, /WARN Application job-1 customer\\u001b\[2J\\u000anext/u);
    assert.match(out.text, /ERROR Runtime SSH job-2 ssh/u);
    assert.equal(out.text.includes("\u001b"), false);
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
      { applicationRef: "alpha", origin: "runtime_ssh" as "runtime-ssh" }
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
