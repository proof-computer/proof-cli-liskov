import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Command from "../src/commands/liskov/application/placement-refusals.js";
import { isApplicationPlacementRefusals, parsePlacementRefusalsQuery, placementRefusalsPath } from "../src/placement-refusals.js";
import { runSlipwayApplicationPlacementRefusals } from "../src/session.js";

// Byte-for-byte owner vector at liskov-rs 62844b0acad63509b32a1833f213a70488d86f6c,
// crates/liskov-control-plane-api/vectors/application_placement_refusals.json.
const { badRequests, ...envelopes } = JSON.parse(await readFile(new URL("./fixtures/application-placement-refusals.json", import.meta.url), "utf8"));
const token = "session-token-that-must-not-be-printed";
const window = { fromMs: "1757995200000", toMs: "1758002400000", limit: "25" };
const windowQuery = "fromMs=1757995200000&toMs=1758002400000&limit=25";

type Served = { status?: number; body?: unknown; raw?: string };

/** A real local server, so the route and query are the bytes sent on the wire. */
async function read(served: Served, input: Partial<Parameters<typeof runSlipwayApplicationPlacementRefusals>[0]> = {}) {
  const requests: { url: string | undefined; method: string | undefined; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, method: request.method, headers: request.headers });
    response.writeHead(served.status ?? 200, { "content-type": "application/json" });
    response.end(served.raw ?? JSON.stringify(served.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const slipwayUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await mkdtemp(path.join(tmpdir(), "placement-refusals-"));
  const config = path.join(dir, "session.json");
  await writeFile(config, JSON.stringify({ version: 1, slipwayUrl, sessionToken: token, savedAtMs: 1 }), { mode: 0o600 });
  const lines: string[] = [];
  try {
    const code = await runSlipwayApplicationPlacementRefusals({ applicationId: "app_canonical", ...window, config, ...input }, {
      env: {}, organization: "org_test", stdout: (line) => lines.push(line), stderr: (line) => lines.push(line)
    });
    const output = lines.join("\n");
    assert.ok(!output.includes(token), `bearer token printed: ${output}`);
    return { code, output, requests };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test("every owner envelope comes back unchanged as JSON, field order included", async () => {
  assert.ok(Object.keys(envelopes).length >= 6);
  for (const body of Object.values(envelopes)) {
    const result = await read({ body }, { json: true });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.output), body);
    assert.equal(result.output, JSON.stringify(body));
  }
});

test("the request is the exact route, the four named parameters and the organization context", async () => {
  const cursor = "a+b/c= d&limit=1#é";
  const result = await read({ body: envelopes.emptyHistory }, { applicationId: "my app/1?x", cursor, json: true });
  assert.equal(result.code, 0);
  assert.equal(result.requests.length, 1);
  const [request] = result.requests;
  assert.equal(request.method, "GET");
  const [pathname, search] = request.url!.split("?");
  assert.equal(pathname, "/api/applications/my%20app%2F1%3Fx/placement/refusals");
  const sent = new URLSearchParams(search);
  assert.deepEqual([...sent.keys()], ["fromMs", "toMs", "limit", "cursor"]);
  assert.equal(sent.get("fromMs"), window.fromMs);
  assert.equal(sent.get("toMs"), window.toMs);
  assert.equal(sent.get("limit"), window.limit);
  assert.equal(sent.get("cursor"), cursor);
  assert.equal(request.headers.authorization, `Liskov-Organization ${token}`);
  assert.equal(request.headers["x-liskov-organization"], "org_test");
});

test("no cursor flag sends no cursor; a served cursor passes back untouched; zero is a real bound", async () => {
  const first = await read({ body: envelopes.emptyHistory }, { json: true });
  assert.equal(first.requests[0].url, `/api/applications/app_canonical/placement/refusals?${windowQuery}`);
  const served: string = envelopes.truncatedPage.nextCursor;
  const second = await read({ body: envelopes.emptyHistory }, { cursor: served, json: true });
  assert.equal(second.requests[0].url, `/api/applications/app_canonical/placement/refusals?${windowQuery}&cursor=${served}`);
  const zero = await read({ body: envelopes.emptyHistory }, { fromMs: "0", toMs: "1", limit: "1", json: true });
  assert.equal(zero.code, 0);
  assert.equal(zero.requests[0].url, "/api/applications/app_canonical/placement/refusals?fromMs=0&toMs=1&limit=1");
  assert.equal(parsePlacementRefusalsQuery({ fromMs: "0", toMs: "1", limit: "100", cursor: "" }).ok, true);
  assert.equal(placementRefusalsPath("a", { fromMs: 0, toMs: 1, limit: 1, cursor: "" }), "/api/applications/a/placement/refusals?fromMs=0&toMs=1&limit=1&cursor=");
});

test("human output carries each typed reason and its server-owned next action", async () => {
  for (const body of Object.values(envelopes) as { observations: { windowStartMs: number; placementCode: string; launchReason: string; country: Record<string, string | number>[]; spread: Record<string, string | number | null>[] }[] }[]) {
    const { code, output } = await read({ body });
    assert.equal(code, 0);
    for (const row of body.observations) {
      assert.ok(output.includes(`Window ${row.windowStartMs}: ${row.placementCode} (launch reason ${row.launchReason})`));
      for (const reason of row.country) {
        assert.ok(output.includes(`Country: ${reason.reason} (predicate ${reason.predicate}, source ${reason.source}, recorded candidates ${reason.candidates})\n    Next action: ${reason.nextAction}`));
      }
      for (const reason of row.spread) {
        assert.ok(output.includes(`Spread: ${reason.reason} (key ${reason.key ?? "none"}, observations ${reason.observations})\n    Next action: ${reason.nextAction}`));
      }
    }
  }
});

test("an empty page says so and claims neither success nor a whole history", async () => {
  const { code, output } = await read({ body: envelopes.emptyHistory });
  assert.equal(code, 0);
  assert.match(output, /There are no recorded refusals in this page\./u);
  assert.match(output, /does not say placement succeeded, and it does not cover all Application history/u);
  assert.doesNotMatch(output, /^Window /mu);
});

test("incomplete is a page statement, and complete is never all refusals", async () => {
  const complete = (await read({ body: envelopes.countryRefusal })).output;
  assert.match(complete, /does not mean every refusal is present/u);
  assert.match(complete, /first refusal of each Application, code and hour/u);
  assert.match(complete, /a refusal whose write failed has no row/u);
  assert.match(complete, /count only what was recorded/u);

  const page = (await read({ body: envelopes.truncatedPage })).output;
  assert.match(page, /Page incomplete: .*whole page, not one row/u);
  assert.ok(page.includes(`--cursor ${envelopes.truncatedPage.nextCursor}`));

  const cut = (await read({ body: envelopes.truncatedCandidates })).output;
  assert.match(cut, /No country or spread reason is recorded for this refusal\./u);
  assert.match(cut, /a reason absent here may still have occurred/u);
  assert.doesNotMatch(cut, /--cursor/u);

  for (const output of [complete, page, cut]) assert.match(output, /does not say placement succeeded/u);
});

test("future tokens and additive fields keep the server's text", async () => {
  const body = structuredClone(envelopes.mixedHistory);
  const [spread, , , country] = body.observations;
  Object.assign(spread, { placementCode: "future_code", launchReason: "future_launch" });
  Object.assign(spread.spread[0], { reason: "future_spread_reason", key: "future_key", nextAction: "future spread action, with words" });
  Object.assign(country.country[0], { reason: "future_country_reason", predicate: "future_predicate", source: "future_source", nextAction: "future_country_action", candidates: 0 });
  body.future = { retained: true };
  const human = (await read({ body })).output;
  for (const text of ["future_code", "future_launch", "future_spread_reason", "key future_key", "future spread action, with words", "future_country_reason", "future_predicate", "future_source", "future_country_action", "recorded candidates 0"]) {
    assert.ok(human.includes(text), text);
  }
  const json = await read({ body }, { json: true });
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.output), body);
});

test("invalid flags exit before HTTP with the owner's reason tokens", async () => {
  const cases: [Partial<typeof window> & { applicationId?: string }, string][] = [
    ...["", " 1", "1 ", "-1", "+1", "1.5", "1e3", "0x10", "abc", "9007199254740992"].map((fromMs) => [{ fromMs }, "invalid_from_ms"] as [Partial<typeof window>, string]),
    ...["", "-1", "1.5", "1e13", "9007199254740992"].map((toMs) => [{ toMs }, "invalid_to_ms"] as [Partial<typeof window>, string]),
    [{ fromMs: "5", toMs: "5" }, "invalid_time_bounds"],
    [{ fromMs: "6", toMs: "5" }, "invalid_time_bounds"],
    ...["", "0", "101", "-1", "1.5", "1e1", "ten"].map((limit) => [{ limit }, "invalid_limit"] as [Partial<typeof window>, string]),
    [{ applicationId: " " }, "invalid_application_ref"],
    [{ applicationId: ".." }, "invalid_application_ref"]
  ];
  for (const [input, reason] of cases) {
    const result = await read({ body: envelopes.emptyHistory }, { ...input, json: true });
    assert.equal(result.code, 1, JSON.stringify(input));
    assert.equal(result.requests.length, 0, JSON.stringify(input));
    assert.equal(JSON.parse(result.output).reason, reason, JSON.stringify(input));
    const human = await read({ body: envelopes.emptyHistory }, input);
    assert.equal(human.code, 1);
    assert.equal(human.requests.length, 0);
  }
  for (const limit of ["1", "100"]) assert.equal((await read({ body: envelopes.emptyHistory }, { limit })).code, 0);
});

test("the owner's bad requests, refusals and outages fail with no fabricated rows", async () => {
  const refusals: [number, unknown, RegExp][] = [
    ...Object.values(badRequests).map((body) => [400, body, new RegExp(`invalid_request.*${(body as { reason: string }).reason}`, "u")] as [number, unknown, RegExp]),
    [401, { ok: false, error: "unauthorized" }, /proof liskov login/u],
    [403, { ok: false, error: "application_access_denied" }, /HTTP 403, application_access_denied/u],
    [403, { ok: false, error: "capability_not_granted", capability: "application.read" }, /SLIPWAY_ACCESS_DENIED/u],
    [404, { ok: false, error: "application_not_found", reason: "no application matches app_canonical" }, /HTTP 404, application_not_found, no application matches app_canonical/u],
    [409, { ok: false, error: "ambiguous_application", reason: "multiple", candidates: [] }, /HTTP 409, ambiguous_application, multiple/u],
    [500, { ok: false, error: "internal_error" }, /unavailable \(HTTP 500, internal_error\)/u],
    [503, undefined, /unavailable \(HTTP 503\)/u]
  ];
  for (const [status, body, message] of refusals) {
    const human = await read({ status, body });
    assert.equal(human.code, 1, `${status} ${JSON.stringify(body)}`);
    assert.match(human.output, message);
    assert.doesNotMatch(human.output, /^Window |no recorded refusals/mu);
    const json = await read({ status, body }, { json: true });
    assert.equal(json.code, 1);
    assert.equal(JSON.parse(json.output).observations, undefined);
    assert.equal(JSON.parse(json.output).ok, false);
  }
  // A valid envelope under an error status is still an error.
  assert.equal((await read({ status: 503, body: envelopes.countryRefusal })).code, 1);
});

test("a server that reflects the bearer token does not get it printed", async () => {
  for (const status of [400, 404, 500]) {
    for (const json of [false, true]) {
      const result = await read({ status, body: { ok: false, error: `Bearer ${token}`, reason: `saw ${token} here` } }, { json });
      assert.equal(result.code, 1);
      assert.match(result.output, /\[redacted\]/u);
    }
  }
});

test("an unreachable service says unavailable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "placement-refusals-down-"));
  const config = path.join(dir, "session.json");
  await writeFile(config, JSON.stringify({ version: 1, slipwayUrl: "http://liskov.test", sessionToken: token, savedAtMs: 1 }), { mode: 0o600 });
  const lines: string[] = [];
  try {
    const code = await runSlipwayApplicationPlacementRefusals({ applicationId: "a", ...window, config }, {
      env: {}, stdout: (line) => lines.push(line), stderr: (line) => lines.push(line),
      fetchImpl: async () => { throw new Error("connection refused"); }
    });
    assert.equal(code, 1);
    assert.match(lines.join("\n"), /placement refusals are unavailable/u);
    assert.doesNotMatch(lines.join("\n"), /no recorded refusals|^Window /mu);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a malformed envelope or unknown schema fails closed", async () => {
  const invalid: unknown[] = [null, [], {}, "ok", { ...envelopes.emptyHistory, ok: false }, { ...envelopes.emptyHistory, schema: "application_placement_refusals_v2" }];
  for (const key of ["ok", "schema", "applicationId", "generatedAtMs", "observations", "nextCursor", "incomplete"]) {
    const body = structuredClone(envelopes.emptyHistory); delete body[key]; invalid.push(body);
  }
  for (const key of ["windowStartMs", "placementCode", "launchReason", "country", "spread"]) {
    const body = structuredClone(envelopes.countryRefusal); delete body.observations[0][key]; invalid.push(body);
  }
  for (const key of ["reason", "predicate", "source", "nextAction", "candidates"]) {
    const body = structuredClone(envelopes.countryRefusal); delete body.observations[0].country[0][key]; invalid.push(body);
  }
  for (const key of ["reason", "key", "nextAction", "observations"]) {
    const body = structuredClone(envelopes.spreadRefusal); delete body.observations[0].spread[0][key]; invalid.push(body);
  }
  for (const value of [null, -1, 1.5, "2"]) {
    const body = structuredClone(envelopes.countryRefusal); body.observations[0].country[0].candidates = value; invalid.push(body);
  }
  invalid.push({ ...envelopes.truncatedPage, incomplete: false });
  invalid.push({ ...envelopes.emptyHistory, nextCursor: "" });
  invalid.push({ ...envelopes.emptyHistory, incomplete: "false" });
  for (const body of invalid) {
    assert.equal(isApplicationPlacementRefusals(body), false, JSON.stringify(body));
    for (const json of [false, true]) {
      const result = await read({ body }, { json });
      assert.equal(result.code, 1, JSON.stringify(body));
      assert.doesNotMatch(result.output, /^Window |no recorded refusals/mu);
    }
  }
  for (const raw of ["", "not json", "<html></html>"]) assert.equal((await read({ raw })).code, 1);
});

test("the command stays hidden, needs its bounds, and its help carries the semantics", () => {
  assert.equal(Command.hidden, true);
  assert.equal(Command.args.application_id.required, true);
  for (const flag of ["from-ms", "to-ms", "limit"]) assert.equal(Command.flags[flag].required, true, flag);
  assert.ok(!Command.flags.cursor.required);
  assert.match(Command.description, /Absent rows never mean placement succeeded/u);
  assert.match(Command.description, /`incomplete: false` does not mean every refusal is present/u);
  assert.match(Command.description, /one cut row marks all of it/u);
  assert.match(Command.description, /candidate counts cover only what was recorded/u);
});
