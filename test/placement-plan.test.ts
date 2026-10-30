import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Command from "../src/commands/liskov/application/placement-plan.js";
import { isApplicationPlacementPlan, formatPlacementPlan, placementPlanPath } from "../src/placement-plan.js";
import { runSlipwayApplicationPlacementPlan } from "../src/session.js";

// Byte-for-byte owner vector at liskov-rs cb31baa346dbbb4649a8d61588e5a627916e451a,
// crates/liskov-control-plane-api/vectors/application_placement_plan.json.
const vectors = JSON.parse(await readFile(new URL("./fixtures/application-placement-plan.json", import.meta.url), "utf8"));
const token = "session-token-that-must-not-be-printed";

async function read(body: unknown, json = false, status = 200, fail = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "placement-plan-"));
  const config = path.join(dir, "session.json");
  await writeFile(config, JSON.stringify({ version: 1, slipwayUrl: "https://liskov.test", sessionToken: token, savedAtMs: 1 }), { mode: 0o600 });
  const lines: string[] = [];
  const requests: { url: string; headers: Headers }[] = [];
  try {
    const code = await runSlipwayApplicationPlacementPlan({ applicationId: "my app/1", occurrenceAuthorityDigest: "sha256:a/b ?#", config, json }, {
      env: {}, organization: "org_test", stdout: (line) => lines.push(line), stderr: (line) => lines.push(line),
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, "GET");
        requests.push({ url: String(url), headers: new Headers(init?.headers) });
        if (fail) throw new Error("unavailable");
        return Response.json(body, { status });
      }
    });
    assert.ok(!lines.join("\n").includes(token));
    return { code, lines, requests };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("placement plan preserves every owner vector as JSON", async () => {
  for (const body of Object.values(vectors)) {
    const result = await read(body, true);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.lines.join("\n")), body);
    assert.equal(result.requests[0].url, "https://liskov.test/api/applications/my%20app%2F1/placement/plans/sha256%3Aa%2Fb%20%3F%23");
    assert.equal(result.requests[0].headers.get("authorization"), `Liskov-Organization ${token}`);
    assert.equal(result.requests[0].headers.get("x-liskov-organization"), "org_test");
  }
});

test("placement plan renders seed and follower identity as immutable initial feasibility", async () => {
  for (const name of ["seed", "follower", "requiredSatisfied", "preferredDegraded"]) {
    const body = vectors[name];
    const result = await read(body);
    assert.equal(result.code, 0);
    const output = result.lines.join("\n");
    assert.match(output, /Initial feasibility snapshot \(immutable\)/u);
    assert.ok(output.includes(body.occurrenceAuthorityDigest));
    assert.ok(output.includes(body.plan.seedOccurrenceAuthorityDigest));
    assert.ok(output.includes(body.plan.planDigest));
    assert.match(output, /Members: 2/u);
    assert.match(output, /target distinct 2, planned distinct [12]/u);
    assert.match(output, name === "requiredSatisfied" ? /authored minimum 2/u : /authored minimum not specified/u);
    assert.match(output, name === "preferredDegraded" ? /preferred degradation recorded/u : /preferred degradation none recorded/u);
    assert.doesNotMatch(output, /registered|running|currently|spread succeeded/u);
  }
});

test("legacy null is an absent record; missing plan is malformed", async () => {
  const result = await read(vectors.legacyNull);
  assert.equal(result.code, 0);
  assert.match(result.lines.join("\n"), /no recorded spread plan/u);
  const body = { ...vectors.legacyNull }; delete body.plan;
  assert.equal((await read(body)).code, 1);
});

test("future rule tokens, counted zero, 256 members and additive fields survive unchanged", async () => {
  const body = structuredClone(vectors.seed);
  body.plan.memberCount = 256;
  Object.assign(body.plan.rules[0], { by: "future_dimension", strength: "future_strength", minimumDistinct: 0, plannedDistinct: 0 });
  body.future = { retained: true };
  const result = await read(body, true);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.lines.join("\n")), body);
  assert.ok(isApplicationPlacementPlan(body));
  assert.match(formatPlacementPlan(body), /Members: 256/u);
  assert.match(formatPlacementPlan(body), /future_dimension \(future_strength\).*planned distinct 0; authored minimum 0/u);
});

test("missing fields, unsupported schema or semantics, bad counts and invalid responses fail closed", async () => {
  const invalid: unknown[] = [null, {}, { ...vectors.seed, schema: "future_schema" }, { ...vectors.seed, semantics: "current_fulfillment" }];
  for (const key of ["seedOccurrenceAuthorityDigest", "planDigest", "policyDigest", "memberCount", "rules"]) {
    const body = structuredClone(vectors.seed); delete body.plan[key]; invalid.push(body);
  }
  for (const key of ["by", "strength", "minimumDistinct", "targetDistinct", "plannedDistinct", "preferredDegraded"]) {
    const body = structuredClone(vectors.seed); delete body.plan.rules[0][key]; invalid.push(body);
  }
  for (const body of invalid) assert.equal((await read(body, true)).code, 1);
  for (const value of [null, -1, 1.5, "2"]) {
    const body = structuredClone(vectors.seed); body.plan.rules[0].plannedDistinct = value;
    assert.equal((await read(body)).code, 1);
  }
  for (const status of [401, 403, 404, 503]) assert.equal((await read({ error: token }, true, status)).code, 1);
  assert.equal((await read(vectors.seed, false, 200, true)).code, 1);
});

test("command stays hidden and encodes both required identities independently", () => {
  assert.equal(Command.hidden, true);
  assert.equal(Command.args.application_id.required, true);
  assert.equal(Command.args.occurrence_authority_digest.required, true);
  assert.equal(placementPlanPath("a/b", "c/d"), "/api/applications/a%2Fb/placement/plans/c%2Fd");
});
