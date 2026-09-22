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

const corpus = JSON.parse(readFileSync(
  path.resolve("src/policy-client-bundle/policy-client-conformance.json"),
  "utf8"
)) as { valid: CorpusCase[]; unknown: { request: CorpusRequest } };

function corpusCase(name: string): CorpusCase {
  const found = corpus.valid.find((sample) => sample.name === name);
  assert.ok(found, `vendored corpus has no ${name} case`);
  return found;
}

function evaluate(sample: { request: CorpusRequest }) {
  return evaluateApplicationManifestText(sample.request.document, sample.request.encoding);
}

describe("V6 application-manifest validation through the vendored contract", () => {
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

  it("treats a schemaVersion 7 document as unknown_opaque", () => {
    const declared = JSON.parse(corpus.unknown.request.document) as { schemaVersion: number };
    assert.equal(declared.schemaVersion, 7);
    const result = evaluate(corpus.unknown);
    assert.equal(result.disposition, "unknown_opaque");
    assert.equal(isRegisteredSourcePublicationPair(result), false);
  });
});
