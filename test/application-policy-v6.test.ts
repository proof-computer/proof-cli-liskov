import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  evaluateApplicationManifestText,
  isRegisteredSourcePublicationPair
} from "../src/application-policy.js";

// Documents come from the owner's vendored corpus, never from this side: a
// fixture written by the reader proves nothing about what liskov-rs accepts.
interface CorpusRequest {
  encoding: "json" | "yaml";
  document: string;
}

interface CorpusCase {
  name: string;
  request: CorpusRequest;
  expected: {
    pair?: { schema: string; schemaVersion: number };
    authoredDigest?: string;
    releaseIntentDigest?: string;
  };
}

interface InvalidCorpusCase {
  name: string;
  request: CorpusRequest;
  expectedCode: string;
  expectedPointer: string;
}

const corpus = JSON.parse(readFileSync(
  path.resolve("src/policy-client-bundle/policy-client-conformance.json"),
  "utf8"
)) as { valid: CorpusCase[]; invalid: InvalidCorpusCase[]; unknown: { request: CorpusRequest } };

function corpusCase(name: string): CorpusCase {
  const found = corpus.valid.find((sample) => sample.name === name);
  assert.ok(found, `vendored corpus has no ${name} case`);
  return found;
}

function evaluate(sample: { request: CorpusRequest }) {
  return evaluateApplicationManifestText(sample.request.document, sample.request.encoding);
}

describe("V6 application-manifest validation through the vendored contract", () => {
  const processorChoices = [
    {
      name: "Android floors, an exact excluded build, and either JavaScript type",
      base: "v6/fetch",
      placement: [
        "    minimums: {acurastProcessorBuild: 131, androidMajor: 14}",
        "    exclude: [{by: acurast_processor_build, values: [\"130\"]}]",
        "    allow: [{by: processor_type, values: [core, lite]}]"
      ].join("\n"),
      expected: {
        minimums: { acurastProcessorBuild: 131, androidMajor: 14 },
        exclude: [{ by: "acurast_processor_build", values: ["130"] }],
        allow: [{ by: "processor_type", values: ["core", "lite"] }]
      }
    },
    { name: "JavaScript Core", base: "v6/fetch", placement: "    allow: [{by: processor_type, values: [core]}]", expected: { allow: [{ by: "processor_type", values: ["core"] }] } },
    { name: "JavaScript Lite", base: "v6/fetch", placement: "    allow: [{by: processor_type, values: [lite]}]", expected: { allow: [{ by: "processor_type", values: ["lite"] }] } },
    { name: "JavaScript either narrowed to Lite", base: "v6/fetch", placement: "    exclude: [{by: processor_type, values: [core]}]", expected: { exclude: [{ by: "processor_type", values: ["core"] }] } },
    { name: "native image Core", base: "v6/benchmark-cargo-native", placement: "    allow: [{by: processor_type, values: [core]}]", expected: { allow: [{ by: "processor_type", values: ["core"] }] } }
  ];

  for (const choice of processorChoices) {
    it(`accepts and reports ${choice.name} without enabling publication`, () => {
      const sample = corpusCase(choice.base);
      const document = sample.request.document.replace("  spend:", `  placement:\n${choice.placement}\n  spend:`);
      assert.notEqual(document, sample.request.document);
      const result = evaluateApplicationManifestText(document, sample.request.encoding);
      assert.equal(result.disposition, "supported");
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
      assert.equal(result.pair?.schemaVersion, 6);
      assert.deepEqual((result.document as { deployment?: { placement?: unknown } })?.deployment?.placement, choice.expected);
      assert.equal(isRegisteredSourcePublicationPair(result), false);
    });
  }

  for (const name of [
    "v6/invalid/processor-build-floor-is-nonzero",
    "v6/invalid/android-major-overflow-is-refused",
    "v6/invalid/processor-build-exclusion-is-exact",
    "v6/invalid/native-image-lite-is-refused",
    "v6/invalid/processor-type-leaves-no-type"
  ]) {
    it(`reports the owner's ${name} preparation error`, () => {
      const sample = corpus.invalid.find((entry) => entry.name === name);
      assert.ok(sample, `vendored corpus has no ${name} case`);
      const result = evaluate(sample);
      assert.equal(result.valid, false);
      assert.equal(result.errors[0]?.code, sample.expectedCode);
      assert.equal(result.errors[0]?.pointer || "/", sample.expectedPointer);
      assert.equal(isRegisteredSourcePublicationPair(result), false);
    });
  }

  for (const name of ["v6/fetch", "v6/clickhouse"]) {
    it(`${name} validates as a supported V6 document and is refused for publication`, () => {
      const sample = corpusCase(name);
      const result = evaluate(sample);
      assert.equal(result.disposition, "supported");
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
      assert.equal(result.pair?.schema, "proof.liskov.application-manifest");
      assert.equal(result.pair?.schemaVersion, 6);
      assert.equal(result.authoredDigest, sample.expected.authoredDigest);
      assert.equal(result.releaseIntentDigest, sample.expected.releaseIntentDigest);
      assert.equal(isRegisteredSourcePublicationPair(result), false);
    });
  }

  it("keeps a V5 corpus document publishable", () => {
    const result = evaluate(corpusCase("v5/benchmark-js"));
    assert.equal(result.disposition, "supported");
    assert.equal(result.valid, true);
    assert.equal(result.pair?.schemaVersion, 5);
    assert.equal(isRegisteredSourcePublicationPair(result), true);
  });

  it("treats a schemaVersion 8 document as unknown_opaque", () => {
    const declared = JSON.parse(corpus.unknown.request.document) as { schemaVersion: number };
    assert.equal(declared.schemaVersion, 8);
    const result = evaluate(corpus.unknown);
    assert.equal(result.disposition, "unknown_opaque");
    assert.equal(isRegisteredSourcePublicationPair(result), false);
  });
});
