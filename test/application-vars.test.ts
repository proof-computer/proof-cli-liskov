import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  runSlipwayApplicationVarsList,
  runSlipwayApplicationVarsSet,
  runSlipwayApplicationVarsUnset,
  saveSlipwaySession
} from "../src/session.js";

const token = "application_vars_session_token_do_not_print";
const variablesUrl = "https://slipway.test/api/applications/proof-docs/variables";
const valuesUrl = "https://slipway.test/api/applications/proof-docs/variable-values";

const variablesBody = {
  ok: true,
  generatedAtMs: 1_790_000_000_000,
  activePolicyVersionId: "proof-docs-v7",
  activePolicyDigest: "sha256:abc",
  variables: {
    declarations: [
      { name: "RPC_URL", required: true, delivery: "slipway" },
      { name: "BANNER", required: false, delivery: "slipway" },
      { name: "TIMEOUT_MS", required: false, delivery: "slipway", default: "30000" },
      { name: "REGION", required: false, delivery: "slipway" }
    ],
    items: [
      {
        name: "RPC_URL",
        required: true,
        scope: "application",
        delivery: "slipway",
        status: "set",
        value: "wss://rpc.example",
        updatedAtMs: 1_789_000_000_000,
        updatedBy: "alice"
      },
      { name: "BANNER", required: false, scope: "application", delivery: "slipway", status: "set", value: "" },
      {
        name: "TIMEOUT_MS",
        required: false,
        scope: "application",
        delivery: "slipway",
        status: "default",
        value: "30000",
        default: "30000"
      },
      { name: "REGION", required: false, scope: "application", delivery: "slipway", status: "unset", value: null }
    ],
    counts: { declared: 4, set: 2, default: 1, unset: 1, missingRequired: 0 }
  }
};

describe("application vars", () => {
  it("lists every item with its value in the clear and keeps \"\" distinct from not set", async () => {
    const sessionFile = await sessionPath();
    const { requests, fetchImpl } = recorder(() => jsonResponse(variablesBody));
    const out = writer();

    const code = await runSlipwayApplicationVarsList({ applicationRef: "proof-docs", config: sessionFile }, {
      fetchImpl,
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{ authorization: `Bearer ${token}`, body: undefined, method: "GET", url: variablesUrl }]);
    const lines = out.text.split("\n");
    assert.match(lines[0]!, /^Variables for proof-docs \(active policy proof-docs-v7\): 4 declared, 2 set, 1 default, 1 unset, 0 required missing\.$/);
    assert.ok(lines.some((line) => /^ {2}RPC_URL {2}set {2}"wss:\/\/rpc\.example" {2}\(required; updated 2026-\S+ by alice\)$/.test(line)));
    assert.ok(lines.includes("  BANNER  set  \"\""));
    assert.ok(lines.includes("  TIMEOUT_MS  default  \"30000\"  (default \"30000\")"));
    assert.ok(lines.includes("  REGION  unset  not set"));
    assert.ok(lines.includes("Values are plaintext by design; put credentials in Secrets."));
    assert.equal(out.text.includes(token), false);
  });

  it("list --json echoes the server body unchanged", async () => {
    const sessionFile = await sessionPath();
    const { fetchImpl } = recorder(() => jsonResponse(variablesBody));
    const out = writer();

    const code = await runSlipwayApplicationVarsList({ applicationRef: "proof-docs", config: sessionFile, json: true }, {
      fetchImpl,
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out.text), variablesBody);
    assert.equal(out.text.includes(token), false);
  });

  it("set without --yes reads once, writes nothing and prints the dry run", async () => {
    const sessionFile = await sessionPath();
    const { requests, fetchImpl } = recorder(() => jsonResponse(variablesBody));
    const out = writer();

    const code = await runSlipwayApplicationVarsSet({
      applicationRef: "proof-docs",
      config: sessionFile,
      name: "RPC_URL",
      value: "wss://rpc-b.example"
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => [request.method, request.url]), [["GET", variablesUrl]]);
    assert.match(out.text, /^Dry run: would set RPC_URL on proof-docs\.$/m);
    assert.match(out.text, /^ {2}current: set {2}"wss:\/\/rpc\.example"/m);
    assert.match(out.text, /^ {2}after: {3}set {2}"wss:\/\/rpc-b\.example"$/m);
    assert.match(out.text, /--yes/);
    assert.equal(out.text.includes(token), false);
  });

  it("set --json without --yes reports dryRun and the current row", async () => {
    const sessionFile = await sessionPath();
    const { requests, fetchImpl } = recorder(() => jsonResponse(variablesBody));
    const out = writer();

    const code = await runSlipwayApplicationVarsSet({
      applicationRef: "proof-docs",
      config: sessionFile,
      json: true,
      name: "BANNER",
      value: "hello"
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(out.text), {
      ok: true,
      dryRun: true,
      applicationRef: "proof-docs",
      name: "BANNER",
      current: variablesBody.variables.items[1],
      next: { status: "set", value: "hello" }
    });
  });

  it("set refuses a name the active policy does not declare, without writing", async () => {
    const sessionFile = await sessionPath();
    const { requests, fetchImpl } = recorder(() => jsonResponse(variablesBody));
    const out = writer();

    const code = await runSlipwayApplicationVarsSet({
      applicationRef: "proof-docs",
      config: sessionFile,
      name: "NOT_DECLARED",
      value: "x"
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 1);
    assert.equal(requests.length, 1);
    assert.equal(
      out.text.trim(),
      "Error (SLIPWAY_APPLICATION_VARIABLE_UNDECLARED): NOT_DECLARED is not a managed variable of proof-docs's active policy"
    );
  });

  it("set --yes POSTs exactly {name, value} and passes \"\" through verbatim", async () => {
    const sessionFile = await sessionPath();
    const { requests, fetchImpl } = recorder(() => jsonResponse({
      ok: true,
      generatedAtMs: 1_790_000_000_500,
      name: "BANNER",
      status: "set",
      updatedAtMs: 1_790_000_000_400,
      updatedBy: "alice"
    }));
    const out = writer();

    const code = await runSlipwayApplicationVarsSet({
      applicationRef: "proof-docs",
      config: sessionFile,
      name: "BANNER",
      value: "",
      yes: true
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      authorization: `Bearer ${token}`,
      body: { name: "BANNER", value: "" },
      method: "POST",
      url: valuesUrl
    }]);
    assert.match(out.text, /^Set BANNER on proof-docs: status set \(updated 2026-\S+ by alice\)\.$/m);
    assert.equal(out.text.includes(token), false);
  });

  it("set --yes keeps a leading-dash value and prints the server body under --json", async () => {
    const sessionFile = await sessionPath();
    const response = { ok: true, generatedAtMs: 1, name: "OFFSET", status: "set", updatedAtMs: 1, updatedBy: "alice" };
    const { requests, fetchImpl } = recorder(() => jsonResponse(response));
    const out = writer();

    const code = await runSlipwayApplicationVarsSet({
      applicationRef: "proof-docs",
      config: sessionFile,
      json: true,
      name: "OFFSET",
      value: " -5 ",
      yes: true
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 0);
    assert.deepEqual(requests[0]!.body, { name: "OFFSET", value: " -5 " });
    assert.deepEqual(JSON.parse(out.text), response);
  });

  it("unset --yes POSTs exactly {name, unset: true}", async () => {
    const sessionFile = await sessionPath();
    const { requests, fetchImpl } = recorder(() => jsonResponse({
      ok: true,
      generatedAtMs: 1,
      name: "RPC_URL",
      status: "unset",
      updatedAtMs: 1_790_000_000_400,
      updatedBy: "alice"
    }));
    const out = writer();

    const code = await runSlipwayApplicationVarsUnset({
      applicationRef: "proof-docs",
      config: sessionFile,
      name: "RPC_URL",
      yes: true
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      authorization: `Bearer ${token}`,
      body: { name: "RPC_URL", unset: true },
      method: "POST",
      url: valuesUrl
    }]);
    assert.match(out.text, /^Cleared RPC_URL on proof-docs: status unset/m);
  });

  it("unset without --yes writes nothing and shows what clearing leaves", async () => {
    const sessionFile = await sessionPath();
    const { requests, fetchImpl } = recorder(() => jsonResponse(variablesBody));
    const out = writer();

    const code = await runSlipwayApplicationVarsUnset({
      applicationRef: "proof-docs",
      config: sessionFile,
      name: "RPC_URL"
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 0);
    assert.deepEqual(requests.map((request) => request.method), ["GET"]);
    assert.match(out.text, /^Dry run: would unset RPC_URL on proof-docs\.$/m);
    assert.match(out.text, /^ {2}after: {3}unset {2}not set$/m);
  });

  it("unset without --yes says an already-unset variable has nothing to clear", async () => {
    const sessionFile = await sessionPath();
    const { requests, fetchImpl } = recorder(() => jsonResponse(variablesBody));
    const out = writer();

    const code = await runSlipwayApplicationVarsUnset({
      applicationRef: "proof-docs",
      config: sessionFile,
      name: "REGION"
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 0);
    assert.equal(requests.length, 1);
    assert.match(out.text, /^Dry run: REGION on proof-docs has no value set; nothing to clear\.$/m);
  });

  it("unset --json without --yes reports the declared default as what remains", async () => {
    const sessionFile = await sessionPath();
    const body = structuredClone(variablesBody);
    body.variables.items[2] = { ...body.variables.items[2]!, status: "set", value: "5000" };
    const { fetchImpl } = recorder(() => jsonResponse(body));
    const out = writer();

    const code = await runSlipwayApplicationVarsUnset({
      applicationRef: "proof-docs",
      config: sessionFile,
      json: true,
      name: "TIMEOUT_MS"
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 0);
    const output = JSON.parse(out.text) as { dryRun: boolean; next: unknown };
    assert.equal(output.dryRun, true);
    assert.deepEqual(output.next, { status: "default", value: "30000" });
  });

  it("a 400 refusal exits 1 with the server's error code as reason", async () => {
    const sessionFile = await sessionPath();
    const { fetchImpl } = recorder(() => jsonResponse({
      ok: false,
      error: "variable_value_too_large",
      reason: "value exceeds 4096 bytes"
    }, 400));
    const out = writer();

    const code = await runSlipwayApplicationVarsSet({
      applicationRef: "proof-docs",
      config: sessionFile,
      json: true,
      name: "RPC_URL",
      value: "x".repeat(4097),
      yes: true
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(out.text), {
      ok: false,
      error: "SLIPWAY_APPLICATION_VARIABLE_SET_FAILED",
      status: 400,
      reason: "variable_value_too_large",
      message: "value exceeds 4096 bytes",
      applicationRef: "proof-docs",
      name: "RPC_URL"
    });
  });

  it("an undeclared_variable refusal of unset --yes keeps its code in the human error", async () => {
    const sessionFile = await sessionPath();
    const { fetchImpl } = recorder(() => jsonResponse({
      ok: false,
      error: "undeclared_variable",
      reason: "name is not a managed variable declared by the active policy"
    }, 400));
    const out = writer();

    const code = await runSlipwayApplicationVarsUnset({
      applicationRef: "proof-docs",
      config: sessionFile,
      name: "GONE",
      yes: true
    }, { fetchImpl, stdout: out.write });

    assert.equal(code, 1);
    assert.equal(
      out.text.trim(),
      "Error (SLIPWAY_APPLICATION_VARIABLE_UNSET_FAILED): Liskov refused to unset GONE on Application proof-docs: " +
        "undeclared_variable (name is not a managed variable declared by the active policy)"
    );
  });

  it("a 401 exits 1 with SLIPWAY_SESSION_UNAUTHORIZED on every command", async () => {
    const sessionFile = await sessionPath();
    const { fetchImpl } = recorder(() => jsonResponse({ ok: false, error: "unauthorized" }, 401));
    const runs: Array<(out: ReturnType<typeof writer>) => Promise<number>> = [
      (out) => runSlipwayApplicationVarsList({ applicationRef: "proof-docs", config: sessionFile, json: true }, { fetchImpl, stdout: out.write }),
      (out) => runSlipwayApplicationVarsSet({ applicationRef: "proof-docs", config: sessionFile, json: true, name: "RPC_URL", value: "v" }, { fetchImpl, stdout: out.write }),
      (out) => runSlipwayApplicationVarsSet({ applicationRef: "proof-docs", config: sessionFile, json: true, name: "RPC_URL", value: "v", yes: true }, { fetchImpl, stdout: out.write }),
      (out) => runSlipwayApplicationVarsUnset({ applicationRef: "proof-docs", config: sessionFile, json: true, name: "RPC_URL", yes: true }, { fetchImpl, stdout: out.write })
    ];
    for (const run of runs) {
      const out = writer();
      assert.equal(await run(out), 1);
      const output = JSON.parse(out.text) as { error: string };
      assert.equal(output.error, "SLIPWAY_SESSION_UNAUTHORIZED");
      assert.equal(out.text.includes(token), false);
    }

    const human = writer();
    assert.equal(await runSlipwayApplicationVarsList({ applicationRef: "proof-docs", config: sessionFile }, { fetchImpl, stdout: human.write }), 1);
    assert.match(human.text, /^Error \(SLIPWAY_SESSION_UNAUTHORIZED\): .*proof liskov login/);
    assert.equal(human.text.includes(token), false);
  });

  it("a failed read exits 1 with SLIPWAY_APPLICATION_VARIABLES_FAILED", async () => {
    const sessionFile = await sessionPath();
    const { fetchImpl } = recorder(() => jsonResponse({ ok: false, error: "application_not_found", reason: "no such application" }, 404));
    const out = writer();

    const code = await runSlipwayApplicationVarsList({ applicationRef: "proof-docs", config: sessionFile }, { fetchImpl, stdout: out.write });

    assert.equal(code, 1);
    assert.equal(
      out.text.trim(),
      "Error (SLIPWAY_APPLICATION_VARIABLES_FAILED): Liskov could not read variables for Application proof-docs: " +
        "application_not_found (no such application)"
    );
  });
});

interface RecordedRequest {
  authorization?: string;
  body: unknown;
  method?: string;
  url: string;
}

function recorder(respond: () => Response): { requests: RecordedRequest[]; fetchImpl: typeof fetch } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      method: init?.method,
      url: String(url)
    });
    return respond();
  }) as typeof fetch;
  return { requests, fetchImpl };
}

async function sessionPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-application-vars-"));
  const sessionFile = path.join(dir, "session.json");
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://slipway.test",
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
