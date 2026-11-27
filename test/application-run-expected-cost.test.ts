import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runSlipwayApplicationRun, saveSlipwaySession } from "../src/index.js";

const token = "slipway_expected_cost_secret_token_do_not_print";

function writer(): { text: string; write: (line: string) => void } {
  const output = { text: "", write(line: string): void { output.text += `${line}\n`; } };
  return output;
}

function runBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    authorized: false,
    dryRun: true,
    settledGeneration: 1,
    jobs: 1,
    jobWindowMs: 45_000,
    perJobServiceCreditMicros: "50000",
    availableServiceCreditMicros: 24_950_038,
    refusal: null,
    ...overrides
  };
}

async function render(body: Record<string, unknown>, options: { json?: boolean; yes?: boolean } = {}): Promise<{ code: number; text: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "proof-expected-cost-"));
  try {
    const sessionFile = path.join(directory, "session.json");
    await saveSlipwaySession({
      version: 1,
      slipwayUrl: "https://slipway.test",
      sessionToken: token,
      savedAtMs: 0
    }, { config: sessionFile });
    const out = writer();
    const code = await runSlipwayApplicationRun({
      applicationRef: "proof-docs",
      config: sessionFile,
      json: options.json,
      yes: options.yes,
      reason: options.yes === true ? "rerun after data fix" : undefined
    }, {
      fetchImpl: async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      }),
      stdout: out.write
    });
    assert.equal(out.text.includes(token), false);
    return { code, text: out.text };
  } finally {
    await rm(directory, { recursive: true });
  }
}

function lineAfterReserve(text: string): string | undefined {
  const lines = text.trimEnd().split("\n");
  const reserve = lines.findIndex((line) => line.includes("reserve of up to"));
  return reserve === -1 ? undefined : lines[reserve + 1];
}

describe("application run expected cost", () => {
  it("prints the estimate after the reserve for a dry run and a confirm", async () => {
    const expectedCost = {
      available: true,
      perJobServiceCreditMicros: "40000",
      basis: "projected_placement",
      pricedCandidates: 2,
      projectedAtMs: 1_700_000_000_000,
      rateFetchedAtMs: 1_700_000_000_100,
      capped: false
    };
    const sentence = "Expected about $0.04 Service Credit per job ($0.04 for this run).";
    const preview = await render(runBody({ expectedCost }));
    const confirm = await render(runBody({
      expectedCost,
      authorized: true,
      dryRun: false
    }), { yes: true });

    assert.equal(preview.code, 0);
    assert.equal(confirm.code, 0);
    assert.match(preview.text, /^1 job over a 45s window; a reserve of up to \$0\.05 Service Credit would be opened\.$/mu);
    assert.match(confirm.text, /a reserve of up to \$0\.05 Service Credit will be opened\.$/mu);
    assert.equal(lineAfterReserve(preview.text), sentence);
    assert.equal(lineAfterReserve(confirm.text), sentence);
    assert.equal(preview.text.includes("cap bound"), false);
    assert.equal(/quote|ACU|planck/u.test(preview.text), false);
  });

  it("prices the run from the job count and omits a total it cannot compute", async () => {
    const many = await render(runBody({
      jobs: 2,
      expectedCost: {
        available: true,
        perJobServiceCreditMicros: "40000",
        capped: false
      }
    }));
    assert.equal(many.code, 0);
    assert.equal(
      lineAfterReserve(many.text),
      "Expected about $0.04 Service Credit per job ($0.08 for this run)."
    );
    assert.match(many.text, /a reserve of up to \$0\.10 Service Credit would be opened\.$/mu);
    assert.equal(many.text.includes("NaN"), false);

    const unpriced = await render(runBody({
      jobs: undefined,
      expectedCost: { available: true, perJobServiceCreditMicros: "40000", capped: false }
    }));
    assert.equal(unpriced.code, 0);
    assert.match(unpriced.text, /^Expected about \$0\.04 Service Credit per job\.$/mu);
    assert.equal(unpriced.text.includes("for this run"), false);
    assert.equal(unpriced.text.includes("NaN"), false);

    const broken = await render(runBody({
      expectedCost: { available: true, perJobServiceCreditMicros: "nope", capped: false }
    }));
    assert.equal(lineAfterReserve(broken.text), "Expected cost is not available.");
    assert.equal(broken.text.includes("NaN"), false);
  });

  it("says when the cap bound the estimate", async () => {
    const result = await render(runBody({
      expectedCost: {
        available: true,
        perJobServiceCreditMicros: "50000",
        basis: "projected_placement",
        pricedCandidates: 1,
        projectedAtMs: 1,
        rateFetchedAtMs: 1,
        capped: true
      }
    }));
    assert.equal(result.code, 0);
    assert.equal(
      lineAfterReserve(result.text),
      "Expected about $0.05 Service Credit per job ($0.05 for this run); the cap bound this estimate."
    );
  });

  it("maps each unavailable reason to one sentence and hides an unknown reason", async () => {
    const reasons: Array<[string, string]> = [
      ["not_v5_managed", "Expected cost is not available for an application that is not managed on V5."],
      ["constraints_not_estimated", "Expected cost is not available when the application limits which processors can run it."],
      ["rate_unavailable", "Expected cost is not available because the Service Credit rate is not available."],
      ["projection_stale", "Expected cost is not available because placement prices are out of date."],
      ["no_priced_candidates", "Expected cost is not available because no processor has a current price."],
      ["fewer_priced_candidates_than_jobs", "Expected cost is not available because fewer processors are priced than this run needs."],
      ["not_a_known_reason", "Expected cost is not available."]
    ];
    for (const [reason, sentence] of reasons) {
      const result = await render(runBody({ expectedCost: { available: false, reason } }));
      assert.equal(result.code, 0, reason);
      assert.equal(lineAfterReserve(result.text), sentence, reason);
      assert.equal(result.text.includes(reason), false, reason);
    }
  });

  it("keeps today's wording when the server omits expectedCost", async () => {
    const result = await render(runBody());
    assert.equal(result.code, 0);
    assert.match(result.text, /^Dry run: proof-docs would run again after settled generation 1\.$/mu);
    assert.match(result.text, /^1 job over a 45s window; a reserve of up to \$0\.05 Service Credit would be opened\.$/mu);
    assert.match(result.text, /^Available Service Credit: \$24\.950038\.$/mu);
    assert.equal(result.text.includes("Expected cost"), false);
    assert.equal(lineAfterReserve(result.text), "Available Service Credit: $24.950038.");
  });

  it("passes the server expectedCost object through --json unchanged", async () => {
    const expectedCost = {
      available: true,
      perJobServiceCreditMicros: "40000",
      basis: "projected_placement",
      pricedCandidates: 3,
      projectedAtMs: 10,
      rateFetchedAtMs: 11,
      capped: false,
      extra: "kept-for-the-consumer"
    };
    const body = runBody({ expectedCost });
    const result = await render(body, { json: true });
    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.text) as { expectedCost: unknown };
    assert.equal(JSON.stringify(parsed.expectedCost), JSON.stringify(expectedCost));
    assert.deepEqual(parsed, body);
  });
});
