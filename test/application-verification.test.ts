import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { Command, Config } from "@oclif/core";

import Verification from "../src/commands/liskov/application/verification.js";
import Publish from "../src/commands/liskov/application/verification/publish.js";
import Show from "../src/commands/liskov/application/verification/show.js";
import Unpublish from "../src/commands/liskov/application/verification/unpublish.js";
import { saveSlipwaySession } from "../src/session.js";

const fixtures = JSON.parse(await readFile(new URL("fixtures/application-verification.json", import.meta.url), "utf8"));
const { published, unpublished, withoutLabel } = fixtures;
const publishedState = published.publicVerification;
const unpublishedState = unpublished.publicVerification;
const token = "application_verification_session_token_do_not_print";
const serviceUrl = "https://liskov.test";
const appRef = "example /?";
const endpoint = `${serviceUrl}/api/applications/${encodeURIComponent(appRef)}/public-verification`;

type VerificationCommand = new (argv: string[], config: Config) => Command;

test("verification topic lists the three commands with preview and admin guidance", async (t) => {
  const invoke = await harness(t);
  const result = await invoke(Verification, published, [], { topic: true });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.requests, []);
  for (const command of ["show", "publish", "unpublish"]) assert.ok(result.stdout.includes(`${command} APP_REF`));
  assert.match(result.stdout, /organization admin/);
  assert.match(result.stdout, /without --yes to preview/);
});

test("show prints the served handle, time, label, and path, and handles unpublished states", async (t) => {
  const invoke = await harness(t);
  const extra = {
    ...published,
    publicVerification: { ...publishedState, additiveField: "do not show me in human output" }
  };
  const result = await invoke(Show, extra, ["--organization", "org-test"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.requests, [{
    method: "GET",
    url: endpoint,
    authorization: `Liskov-Organization ${token}`,
    organization: "org-test",
    body: undefined
  }]);
  assert.match(result.stdout, /^Application verification is published\.$/mu);
  assert.ok(result.stdout.includes(`Handle: ${publishedState.handle}`));
  assert.ok(result.stdout.includes(`Public URL: ${serviceUrl}${publishedState.publicPath}`));
  assert.match(result.stdout, /^label set by publisher: pocket-confidential$/mu);
  assert.match(result.stdout, /1970-01-01T00:00:00\.125Z/);
  assert.doesNotMatch(result.stdout, /do not show me/);

  const withoutHandle = { publicVerification: { ...publishedState, handle: undefined } };
  const malformed = await invoke(Show, withoutHandle);
  assert.notEqual(malformed.code, 0);
  assert.notEqual(malformed.stdout + malformed.stderr, result.stdout);

  const noLabel = await invoke(Show, withoutLabel);
  assert.equal(noLabel.code, 0);
  assert.match(noLabel.stdout, /^no label$/mu);

  const inactive = await invoke(Show, unpublished);
  assert.equal(inactive.code, 0);
  assert.match(inactive.stdout, /not published/);
  assert.doesNotMatch(inactive.stdout, /lpv_|https?:\/\//u);

  const json = await invoke(Show, extra, ["--json"]);
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.stdout), extra);
});

test("publish and unpublish preview with one GET and explain the effect of confirmation", async (t) => {
  const invoke = await harness(t);
  const cases = [
    [Publish, unpublished, ["--label", " Acme "], /jobs, job keys, processor addresses, attestation facts, and chain coordinates without logging in/u],
    [Publish, published, ["--label", " Acme "], /the handle and link stay the same/u],
    [Unpublish, published, [], /the current public link stops working\. Publishing again gives a new handle and a new link/u],
    [Unpublish, unpublished, [], /Running with --yes leaves it unpublished/u]
  ] as const;
  for (const [command, body, flags, message] of cases) {
    const result = await invoke(command, body, [...flags]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.requests, [request("GET")]);
    assert.match(result.stdout, message);
    if (command === Publish) assert.ok(result.stdout.split("\n").includes("label set by publisher:  Acme "));
    if (body === published && command === Publish) assert.doesNotMatch(result.stdout, /anyone with the link/u);
  }

  const publishing = await invoke(Publish, unpublished, ["--label", "Acme", "--json"]);
  assert.equal(publishing.code, 0);
  assert.deepEqual(JSON.parse(publishing.stdout), {
    ok: true,
    dryRun: true,
    current: unpublishedState,
    next: { ...unpublishedState, published: true, publisherLabel: "Acme" }
  });
  const keep = await invoke(Publish, published, ["--json"]);
  assert.equal(keep.code, 0);
  assert.deepEqual(JSON.parse(keep.stdout), { ok: true, dryRun: true, current: publishedState, next: publishedState });

  const clearing = await invoke(Publish, published, ["--clear-label", "--json"]);
  assert.equal(clearing.code, 0);
  assert.deepEqual(JSON.parse(clearing.stdout).next, withoutLabel.publicVerification);
  const withdrawing = await invoke(Unpublish, published, ["--json"]);
  assert.equal(withdrawing.code, 0);
  assert.deepEqual(JSON.parse(withdrawing.stdout), {
    ok: true, dryRun: true, current: publishedState, next: unpublishedState
  });
});

test("confirmed changes send one mutation and distinguish omitted, verbatim, and null labels", async (t) => {
  const invoke = await harness(t);
  const cases = [
    { flags: ["--label", "Acme"], payload: { publisherLabel: "Acme" }, response: published },
    { flags: ["--label", " Acme "], payload: { publisherLabel: " Acme " }, response: published },
    { flags: ["--clear-label"], payload: { publisherLabel: null }, response: withoutLabel },
    { flags: [], payload: {}, response: published }
  ];
  for (const { flags, payload, response } of cases) {
    const result = await invoke(Publish, response, [...flags, "--yes", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.requests, [request("PUT", payload)]);
    assert.deepEqual(JSON.parse(result.stdout), response);
    if (flags.length === 0) assert.equal(Object.hasOwn(result.requests[0].body, "publisherLabel"), false);
  }

  const publishHuman = await invoke(Publish, published, ["--yes"]);
  assert.equal(publishHuman.code, 0);
  assert.ok(publishHuman.stdout.includes(publishedState.handle));
  assert.ok(publishHuman.stdout.includes(`${serviceUrl}${publishedState.publicPath}`));

  const unpublishHuman = await invoke(Unpublish, unpublished, ["--yes"]);
  assert.equal(unpublishHuman.code, 0);
  assert.deepEqual(unpublishHuman.requests, [request("DELETE")]);
  assert.match(unpublishHuman.stdout, /not published/u);

  const unpublishJson = await invoke(Unpublish, unpublished, ["--yes", "--json"]);
  assert.equal(unpublishJson.code, 0);
  assert.deepEqual(unpublishJson.requests, [request("DELETE")]);
  assert.deepEqual(JSON.parse(unpublishJson.stdout), unpublished);
});

test("publish refuses conflicting label flags before sending a request", async (t) => {
  const invoke = await harness(t);
  const result = await invoke(Publish, published, ["--label", "Acme", "--clear-label", "--yes"]);
  assert.notEqual(result.code, 0);
  assert.deepEqual(result.requests, []);
  assert.match(result.stderr, /--clear-label.*--label|--label.*--clear-label/u);
});

test("the owner refusals retain their codes and an absent route has its own error", async (t) => {
  const invoke = await harness(t);
  for (const refusal of [fixtures.forbidden, fixtures.invalidLabel, fixtures.foreignApplication]) {
    const result = await invoke(Publish, refusal.body, ["--yes"], { status: refusal.status });
    assert.notEqual(result.code, 0);
    assert.deepEqual(result.requests, [request("PUT", {})]);
    assert.ok(result.stderr.includes(refusal.body.error));

    const json = await invoke(Publish, refusal.body, ["--yes", "--json"], { status: refusal.status });
    assert.notEqual(json.code, 0);
    assert.equal(JSON.parse(json.stdout).error, refusal.body.error);
  }

  const emptyLabel = await invoke(Publish, fixtures.invalidLabel.body, ["--label=", "--yes"], { status: 400 });
  assert.notEqual(emptyLabel.code, 0);
  assert.deepEqual(emptyLabel.requests, [request("PUT", { publisherLabel: "" })]);
  assert.match(emptyLabel.stderr, /publisher_label_invalid/u);

  const result = await invoke(Show, { error: "not_found" }, [], { status: 404 });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /LISKOV_APPLICATION_VERIFICATION_ROUTE_NOT_FOUND/u);
});

test("verification never prints an echoed credential or accepts it as a label", async (t) => {
  const invoke = await harness(t);
  for (const flags of [[], ["--json"]]) {
    const result = await invoke(Show, { ...published, sessionToken: token }, flags);
    assert.notEqual(result.code, 0);
  }
  for (const flags of [[], ["--yes"]]) {
    const result = await invoke(Publish, published, ["--label", token, ...flags]);
    assert.notEqual(result.code, 0);
    assert.deepEqual(result.requests, []);
    assert.match(result.stderr, /UNSAFE_INPUT/u);
  }
});

function request(method: string, body?: unknown) {
  return { method, body, url: endpoint, authorization: `Bearer ${token}`, organization: null };
}

async function harness(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "liskov-application-verification-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "session.json");
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://configured.test",
    sessionToken: token,
    savedAtMs: 0
  }, { config: configPath });
  const config = await Config.load({ root: fileURLToPath(new URL("..", import.meta.url)) });
  const organization = process.env.LISKOV_ORGANIZATION;
  delete process.env.LISKOV_ORGANIZATION;
  t.after(() => {
    if (organization !== undefined) process.env.LISKOV_ORGANIZATION = organization;
  });
  return async function invoke(
    CommandClass: VerificationCommand,
    response: unknown,
    flags: string[] = [],
    { status = 200, topic = false } = {}
  ) {
    const output: string[] = [];
    const errors: string[] = [];
    const requests: ReturnType<typeof request>[] = [];
    const fetchMock = t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
      const headers = new Headers(init.headers);
      requests.push({
        method: init.method!,
        url: String(url),
        authorization: headers.get("authorization")!,
        organization: headers.get("x-liskov-organization"),
        body: init.body === undefined ? undefined : JSON.parse(String(init.body))
      });
      return Response.json(response, { status });
    });
    const stderrMock = t.mock.method(console, "error", (line: string) => errors.push(line));
    const argv = topic ? [] : [appRef, "--config", configPath, "--liskov-url", serviceUrl, ...flags];
    const command = new CommandClass(argv, config);
    command.id = "liskov:application:verification";
    t.mock.method(command, "log", (line: string) => output.push(line));
    t.mock.method(command, "catch", (error: unknown) => { throw error; });

    let code = 0;
    try {
      await command._run();
    } catch (error) {
      const failure = error as Error & { code?: string; oclif?: { exit?: number } };
      code = failure.oclif?.exit ?? 1;
      if (failure.code !== "EEXIT") errors.push(failure.message);
    } finally {
      fetchMock.mock.restore();
      stderrMock.mock.restore();
    }

    const stdout = output.join("\n");
    const stderr = errors.join("\n");
    assert.ok(!(stdout + stderr).includes(token), "session token reached command output");
    assert.doesNotMatch(stdout + stderr, /verified[^\n]*label|label[^\n]*verified/iu);
    return { code, requests, stdout, stderr };
  };
}
