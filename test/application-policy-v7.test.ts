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

describe("V7 application-manifest validation through the vendored contract", () => {
  for (const name of ["v7/acurast-public-http", "v7/cloudflare-provider-gated"]) {
    it(`${name} validates as a supported V7 document and is refused for publication`, () => {
      const sample = corpusCase(name);
      const result = evaluate(sample);
      assert.equal(result.disposition, "supported");
      assert.equal(result.valid, true);
      assert.deepEqual(result.errors, []);
      assert.equal(result.pair?.schema, "proof.liskov.application-manifest");
      assert.equal(result.pair?.schemaVersion, 7);
      assert.equal(result.authoredDigest, sample.expected.authoredDigest);
      assert.equal(result.releaseIntentDigest, sample.expected.releaseIntentDigest);
      assert.equal(isRegisteredSourcePublicationPair(result), false);
    });
  }

  for (const name of [
    "v7/invalid/public-endpoint-without-protection",
    "v7/invalid/acurast-tunnel-is-never-provider-gated",
    "v7/invalid/cloudflare-tunnel-on-javascript",
    "v7/invalid/ingress-tcp-is-refused"
  ]) {
    it(`reports the owner's ${name} error`, () => {
      const sample = corpus.invalid.find((entry) => entry.name === name);
      assert.ok(sample, `vendored corpus has no ${name} case`);
      const result = evaluate(sample);
      assert.equal(result.valid, false);
      assert.equal(result.errors[0]?.code, sample.expectedCode);
      assert.equal(result.errors[0]?.pointer || "/", sample.expectedPointer);
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

  it("keeps a V6 corpus document supported and refused for publication", () => {
    const result = evaluate(corpusCase("v6/fetch"));
    assert.equal(result.disposition, "supported");
    assert.equal(result.valid, true);
    assert.equal(result.pair?.schemaVersion, 6);
    assert.equal(isRegisteredSourcePublicationPair(result), false);
  });

  it("treats a schemaVersion 8 document as unknown_opaque", () => {
    const declared = JSON.parse(corpus.unknown.request.document) as { schemaVersion: number };
    assert.equal(declared.schemaVersion, 8);
    const result = evaluate(corpus.unknown);
    assert.equal(result.disposition, "unknown_opaque");
    assert.equal(isRegisteredSourcePublicationPair(result), false);
  });
});
