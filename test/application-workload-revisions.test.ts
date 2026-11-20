import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { runWorkloadRevisions } from "../src/workload-revisions.js";

// Synthesized from liskov-rs 4220c3d45d6b035e18e534efc2b8d22c86697f47,
// crates/liskov-control-plane-api/src/workload_revision.rs (WorkloadRevisionWire).
const { observed, unavailable } = JSON.parse(await readFile(
  new URL("./fixtures/workload-revisions.json", import.meta.url), "utf8"
));
const token = "workload-revisions-session-token";
const privateArgs = "./bin/private-app --key=argv-should-stay-private";
const sessionDefault = { id: "org-default" };
const selectedOrg = { id: "org-selected/?", slug: "other-team" };
const session = {
  ok: true,
  organization: sessionDefault,
  organizationContext: { source: "session", effective: sessionDefault }
};
const selectedSession = {
  ...session,
  organizationContext: { source: "request", effective: selectedOrg, sessionDefault }
};

function sessionFile(url: string) {
  return JSON.stringify({ version: 1, slipwayUrl: url, sessionToken: token, savedAtMs: 1 });
}

interface Served {
  body?: unknown;
  status?: number;
  raw?: string;
}

function response({ body, status, raw }: Served): Response {
  return new Response(raw ?? JSON.stringify(body), { status });
}

async function read(
  served: Served,
  options: { json?: boolean; applicationId?: string; organization?: string; session?: Served; url?: string; failFetch?: boolean } = {}
) {
  const directory = await mkdtemp(path.join(tmpdir(), "workload-revisions-"));
  const config = path.join(directory, "session.json");
  const saved = sessionFile("http://liskov.test");
  await writeFile(config, saved, { mode: 0o600 });
  const requests: { path: string; method: string | undefined; authorization: string | null; organization: string | null }[] = [];
  let stdout = "";
  let stderr = "";
  try {
    const status = await runWorkloadRevisions({
      config,
      applicationId: options.applicationId ?? "my app/1?x",
      json: options.json,
      slipwayUrl: options.url
    }, {
      env: {},
      organization: options.organization,
      stdout: (line) => { stdout += line; },
      stderr: (line) => { stderr += line; },
      fetchImpl: async (url, init) => {
        if (options.failFetch) throw new Error(`private details: ${token} ${privateArgs}`);
        const pathname = new URL(String(url)).pathname;
        const headers = new Headers(init?.headers);
        requests.push({ path: pathname, method: init?.method, authorization: headers.get("authorization"), organization: headers.get("x-liskov-organization") });
        assert.equal(init?.body, undefined);
        assert.equal(init?.redirect, "error");
        return response(pathname === "/api/session" ? options.session ?? { body: session } : served);
      }
    });
    assert.equal(await readFile(config, "utf8"), saved);
    for (const privateValue of [token, privateArgs]) {
      assert.ok(!(stdout + stderr).includes(privateValue));
      assert.ok(requests.every((request) => !request.path.includes(privateValue)));
    }
    return { status, stdout, stderr, requests };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertObserved(rendered: string) {
  const blocks = rendered.split("\n\n").slice(1);
  for (const [index, row] of observed.revisions.entries()) {
    const block = blocks[index];
    const { registration, desired, staged, serving, availability } = row;
    for (const line of [
      `Launch ${registration.launchId} (processor ${registration.processorId}, runtime ${registration.runtimeInstanceId})`,
      `Registered provider artifact: bootstrap ${registration.bootstrapDigest}, rootfs ${registration.rootfsDigest}, helper ${registration.helperDigest}`,
      `Desired payload: revision ${desired.targetRevisionDigest}, release ${desired.desiredReleaseDigest}, epoch ${desired.targetEpoch}, deadline ${desired.scheduleDeadlineMs}`,
      `Staged update: ${staged.stage}, request digest ${staged.stagedRequestDigest ?? "none reported"}`,
      `Serving payload: revision ${serving.currentRevisionDigest ?? "none reported"}, epoch ${serving.currentEpoch}, ready ${serving.servingReady}, converged ${serving.converged}, rolled back ${serving.rolledBack}`,
      `Observation: ${availability}`
    ]) {
      assert.ok(block.includes(line), line);
    }
  }
  assert.match(blocks[0], /Update failed\. Check the application logs/u);
  assert.match(blocks[1], /Update rolled back\. Check the reported serving revision/u);
  assert.match(blocks[2], /Observation is stale\. Check the execution status and schedule/u);
  assert.match(rendered, /The server truncated this list/u);
}

test("JSON and human output carry the same server facts without additive credentials or arguments", async () => {
  const injected = structuredClone(observed);
  injected.sessionToken = token;
  injected.revisions[0].staged.arguments = privateArgs;
  injected.revisions[0].registration.authorizationId = token;
  const json = await read({ body: injected }, { json: true });
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout), observed);
  assert.equal(json.stderr, "");
  const human = await read({ body: injected });
  assert.equal(human.status, 0);
  assertObserved(human.stdout);
  assert.equal(human.stderr, "");
});

test("the request uses the server-resolved organization ID and encodes both route segments", async () => {
  const defaultRead = await read({ body: observed });
  const selectedRead = await read({ body: observed }, { organization: selectedOrg.slug, session: { body: selectedSession } });
  assert.equal(defaultRead.status, 0);
  assert.equal(selectedRead.status, 0);
  const bearer = `Bearer ${token}`;
  assert.deepEqual(defaultRead.requests, [
    { path: "/api/session", method: "GET", authorization: bearer, organization: null },
    { path: "/api/organizations/org-default/applications/my%20app%2F1%3Fx/workload-revisions", method: "GET", authorization: bearer, organization: null }
  ]);
  assert.deepEqual(selectedRead.requests, [
    { path: "/api/session", method: "GET", authorization: `Liskov-Organization ${token}`, organization: selectedOrg.slug },
    { path: "/api/organizations/org-selected%2F%3F/applications/my%20app%2F1%3Fx/workload-revisions", method: "GET", authorization: bearer, organization: null }
  ]);

  const ignoredSelection = await read({ body: observed }, { organization: selectedOrg.slug, json: true });
  assert.equal(ignoredSelection.status, 1);
  assert.equal(JSON.parse(ignoredSelection.stdout).error, "workload_revisions_organization_unavailable");
  assert.equal(ignoredSelection.requests.length, 1);
});

test("empty observations, an uninstalled route, a missing app, and a 503 remain distinct", async () => {
  const empty = { revisions: [], truncated: false };
  assert.deepEqual(JSON.parse((await read({ body: empty }, { json: true })).stdout), empty);
  assert.match((await read({ body: empty })).stdout, /No workload revisions were reported/u);
  const failures = [
    { wire: { status: 404, body: { ok: false, error: "application_not_found", reason: privateArgs } }, error: "application_not_found", guidance: /Check the application ID/u },
    { wire: { status: 404, raw: `<html>${token}</html>` }, error: "workload_revisions_route_not_found", guidance: /Check the Liskov service URL and server version/u, availability: "unavailable" },
    { wire: { status: 503, body: unavailable }, error: "workload_revisions_unavailable", guidance: /retry later/u, availability: "unavailable" },
    { wire: { status: 401, body: { error: token, reason: privateArgs } }, error: "SLIPWAY_SESSION_UNAUTHORIZED", guidance: /proof liskov login/u }
  ];
  for (const { wire, error, guidance, availability } of failures) {
    const json = await read(wire, { json: true });
    assert.equal(json.status, 1);
    const body = JSON.parse(json.stdout);
    assert.equal(body.error, error);
    assert.equal(body.status, wire.status);
    assert.equal(body.availability, availability);
    assert.equal(body.revisions, undefined);
    assert.match(body.message, guidance);
    const human = await read(wire);
    assert.equal(human.status, 1);
    assert.equal(human.stdout, "");
    assert.match(human.stderr, guidance);
  }
});

test("malformed observations and transport failures cannot imply serving state", async () => {
  const echoed = structuredClone(observed);
  echoed.revisions[0].registration.launchId = token;
  const malformed = structuredClone(observed);
  malformed.revisions[0].serving.servingReady = "false";
  for (const body of [echoed, malformed, { ok: true, revisions: [] }, unavailable]) {
    const result = await read({ body }, { json: true });
    assert.equal(result.status, 1);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.error, "workload_revisions_invalid_response");
    assert.equal(failure.revisions, undefined);
  }
  const transport = await read({}, { json: true, failFetch: true });
  assert.equal(transport.status, 1);
  assert.equal(JSON.parse(transport.stdout).availability, "unavailable");
  for (const applicationId of [token, "", ".", ".."]) {
    const result = await read({ body: observed }, { applicationId });
    assert.equal(result.status, 1);
    assert.equal(result.requests.length, 0);
  }
});

test("the packed oclif command resolves organization flags, emits both views, and sends only GETs by default", async () => {
  await mkdir(".tmp", { recursive: true });
  const scratch = await mkdtemp(path.resolve(".tmp/workload-revisions-package-"));
  const requests: { method?: string; url?: string; organization?: string | string[] }[] = [];
  let served: Served = { body: observed };
  const server = createServer((request, reply) => {
    const organization = request.headers["x-liskov-organization"];
    requests.push({ method: request.method, url: request.url, organization });
    reply.setHeader("content-type", "application/json");
    if (request.url === "/api/session") {
      reply.end(JSON.stringify(organization ? selectedSession : session));
      return;
    }
    reply.statusCode = served.status ?? 200;
    reply.end(JSON.stringify(served.body));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const config = path.join(scratch, "session.json");
    await writeFile(config, sessionFile(url), { mode: 0o600 });
    const [packed] = JSON.parse(execFileSync("npm", [
      "pack", "--json", "--ignore-scripts", "--pack-destination", scratch, "--cache", path.join(scratch, "cache")
    ], { encoding: "utf8" }));
    execFileSync("tar", ["-xzf", path.join(scratch, packed.filename), "-C", scratch]);
    const packageRoot = path.join(scratch, "package");
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "oclif.manifest.json"), "utf8"));
    const command = "liskov:application:workload-revisions";
    assert.ok(manifest.commands[command]);
    const entrypoint = `import { run } from "@oclif/core"; await run(process.argv.slice(1), ${JSON.stringify(packageRoot)});`;
    const invoke = (flags: string[]) => promisify(execFile)(process.execPath, [
      "--input-type=module", "-e", entrypoint, "--", command, "my-app", "--config", config, ...flags
    ], { env: { ...process.env, LISKOV_ORGANIZATION: "environment-team", LISKOV_URL: url } });
    const json = await invoke(["--organization", selectedOrg.slug, "--json"]);
    assert.deepEqual(JSON.parse(json.stdout), observed);
    const human = await invoke([]);
    assertObserved(human.stdout);
    served = { status: 503, body: unavailable };
    await assert.rejects(invoke(["--json"]), (error: { code?: number; stdout?: string; stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout ?? "").availability, "unavailable");
      assert.ok(!(error.stdout + error.stderr).includes(token));
      return true;
    });
    assert.deepEqual(requests.map(({ method, url, organization }) => [method, url, organization]), [
      ["GET", "/api/session", selectedOrg.slug],
      ["GET", "/api/organizations/org-selected%2F%3F/applications/my-app/workload-revisions", undefined],
      ["GET", "/api/session", "environment-team"],
      ["GET", "/api/organizations/org-selected%2F%3F/applications/my-app/workload-revisions", undefined],
      ["GET", "/api/session", "environment-team"],
      ["GET", "/api/organizations/org-selected%2F%3F/applications/my-app/workload-revisions", undefined]
    ]);
    assert.ok(!(json.stdout + json.stderr + human.stdout + human.stderr).includes(token));
    assert.equal(await readFile(config, "utf8"), sessionFile(url));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(scratch, { recursive: true, force: true });
  }
});
