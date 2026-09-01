import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const bundleDirectory = path.resolve("src/policy-client-bundle");
const { loadPolicyContract } = require(path.join(bundleDirectory, "policy-client.cjs")) as {
  loadPolicyContract(directory: string): { evaluate(request: Record<string, unknown>): Record<string, unknown> };
};
const contract = loadPolicyContract(bundleDirectory);
const corpus = JSON.parse(readFileSync(path.join(bundleDirectory, "policy-client-conformance.json"), "utf8")) as {
  valid: Array<{ name: string; request: Record<string, unknown>; expected: Record<string, unknown> }>;
  invalid: Array<{ name: string; request: Record<string, unknown>; expectedCode: string; expectedPointer: string }>;
};

test("vendored policy contract matches the complete shared corpus", () => {
  for (const sample of corpus.valid) {
    const result = contract.evaluate(sample.request);
    assert.equal(result.disposition, "supported", sample.name);
    assert.equal(result.valid, true, sample.name);
    for (const [field, expected] of Object.entries(sample.expected)) {
      assert.deepEqual(result[field], expected, `${sample.name} ${field}`);
    }
  }
  for (const sample of corpus.invalid) {
    const result = contract.evaluate(sample.request) as { valid: boolean; errors: Array<{ code: string; pointer: string }> };
    assert.equal(result.valid, false, sample.name);
    assert.equal(result.errors[0]?.code, sample.expectedCode, sample.name);
    assert.equal(result.errors[0]?.pointer || "/", sample.expectedPointer, sample.name);
  }
});
