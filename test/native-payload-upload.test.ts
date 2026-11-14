import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { hashFile } from "../src/artifact-upload.js";
import { runSlipwayApplicationArtifactUpload, type SlipwayApplicationArtifactUploadInput, type SlipwayCliOptions } from "../src/session.js";

const token = "member-session-never-print";
const credential = "private-signature-never-print";
const url = `https://private.invalid/object?X-Amz-Signature=${credential}`;
const bytes = Buffer.from("prebuilt-cargo-archive");
const hash = hashFile(bytes);
const artifact = {
  artifactVersionId: "artifact-member-1", artifactDigest: `sha256:${hash.sha256Hex}`,
  descriptorDigest: `sha256:${"e".repeat(64)}`, byteSize: bytes.length, ready: false
};
const uploadId = `upl-${"a".repeat(32)}`;
const descriptor = {
  format: "liskov.cargo-payload.v1", artifactDigest: artifact.artifactDigest,
  artifactSizeBytes: bytes.length, encryption: "none",
  targetAbi: { os: "linux", architecture: "aarch64", environment: "musl" },
  entries: [{ kind: "regular_file", path: "bin/app", sizeBytes: 1, digest: `sha256:${"a".repeat(64)}`, executable: true }],
  entrypoints: ["bin/app"], producer: { kind: "member", subject: "member-1", sourceRevision: "local", buildId: "local-build" }
};
const plan = () => ({
  ok: true, kind: "native_payload", uploadId, artifact,
  upload: { url, method: "PUT", headers: {
    "content-length": String(bytes.length), "if-none-match": "*",
    "x-amz-checksum-sha256": Buffer.from(hash.sha256Hex, "hex").toString("base64")
  } }, maxBytes: 8388608, expiresAtMs: 10000
});
const ready = () => ({ ok: true, kind: "native_payload", artifact: { ...artifact, ready: true } });

async function fixture(run: (input: SlipwayApplicationArtifactUploadInput, options: SlipwayCliOptions, directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "native-payload-"));
  const file = path.join(directory, "payload.tar.gz");
  const companion = path.join(directory, "payload.json");
  const config = path.join(directory, "session.json");
  await writeFile(file, bytes);
  await writeFile(companion, JSON.stringify(descriptor));
  await writeFile(config, JSON.stringify({ version: 1, slipwayUrl: "https://liskov.invalid", sessionToken: token, savedAtMs: 1 }), { mode: 0o600 });
  try {
    await run({ applicationRef: "app /", file, descriptor: companion, kind: "native_payload", config, json: true }, { env: {}, organization: "team", nowMs: () => 1 }, directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function invoke(input: SlipwayApplicationArtifactUploadInput, options: SlipwayCliOptions, respond: (index: number, url: string, init?: RequestInit) => Response | Promise<Response>) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const lines: string[] = [];
  const code = await runSlipwayApplicationArtifactUpload(input, {
    ...options, stdout: (s) => lines.push(s), stderr: (s) => lines.push(s),
    fetchImpl: async (request, init) => {
      const index = requests.length;
      requests.push({ url: String(request), init });
      if (index === 0) return Response.json({ ok: true, session: { sessionId: "sess" }, organizationContext: { effective: { id: "org-canonical" } } });
      return respond(index, String(request), init);
    }
  });
  const output = lines.join("\n");
  for (const secret of [token, credential, url]) assert.equal(output.includes(secret), false, output);
  return { code, output, requests };
}

test("native member upload sends the exact private plan and emits only finalized readiness", async () => fixture(async (input, options) => {
  for (const json of [true, false]) {
    const result = await invoke({ ...input, json }, options, (index, requestUrl, init) => {
      if (index === 1) {
        assert.match(requestUrl, /\/api\/organizations\/org-canonical\/applications\/app%20%2F\/artifact-upload-intents$/u);
        assert.deepEqual(JSON.parse(String(init?.body)), { kind: "native_payload", descriptor });
        assert.equal(new Headers(init?.headers).get("x-liskov-organization"), "team");
        return Response.json(plan());
      }
      if (index === 2) {
        assert.equal(requestUrl, url);
        assert.equal(init?.method, "PUT");
        assert.equal(init?.redirect, "error");
        assert.deepEqual(init?.headers, plan().upload.headers);
        assert.equal(new Headers(init?.headers).has("authorization"), false);
        assert.deepEqual(init?.body, bytes);
        return new Response(null, { status: 200 });
      }
      assert.equal(index, 3);
      assert.deepEqual(JSON.parse(String(init?.body)), { kind: "native_payload", uploadId, artifactDigest: artifact.artifactDigest });
      assert.match(requestUrl, /\/artifact-uploads$/u);
      // Even accidental remote reflection is excluded by the success allowlist.
      return Response.json({ ...ready(), upload: plan().upload, token });
    });
    assert.equal(result.code, 0, result.output);
    assert.equal(result.requests.length, 4);
    if (json) assert.deepEqual(JSON.parse(result.output), ready());
    else assert.match(result.output, /^Artifact ready:.*Publication, execution and encryption are separate\./u);
  }
}));

test("native digest, kind and encryption mistakes refuse before any request", async () => fixture(async (input, options) => {
  for (const mutation of [{ artifactDigest: `sha256:${"b".repeat(64)}` }, { artifactSizeBytes: 0 }, { encryption: "signer" }]) {
    await writeFile(input.descriptor!, JSON.stringify({ ...descriptor, ...mutation }));
    const out = await invoke(input, options, () => { throw new Error("no request"); });
    assert.equal(out.code, 1);
    assert.equal(out.requests.length, 0);
  }
  for (const mutation of [{ kind: "unknown" }, { descriptor: undefined }, { manifest: "manifest.json" }]) {
    const out = await invoke({ ...input, ...mutation }, options, () => { throw new Error("no request"); });
    assert.equal(out.code, 1);
    assert.equal(out.requests.length, 0);
  }
}));

test("native upload refuses wrong kind, wrong ABI and unknown capability without sending bytes", async () => fixture(async (input, options) => {
  for (const error of ["invalid_payload_descriptor", "invalid_payload_artifact", "capability_not_granted", "unknown_capability"]) {
    const out = await invoke(input, options, () => Response.json({ ok: false, error, reason: `${token} ${credential}` }, { status: 403 }));
    assert.equal(out.code, 1);
    assert.equal(out.requests.length, 2);
    assert.equal(JSON.parse(out.output).reason, error);
  }
  for (const change of [
    { kind: "runtime_image" }, { upload: { ...plan().upload, method: "POST" } },
    { upload: { ...plan().upload, url: "http://private.invalid/object" } },
    { upload: { ...plan().upload, headers: {} } },
    { artifact: { ...artifact, artifactDigest: `sha256:${"b".repeat(64)}` } },
    { maxBytes: 0 }, { expiresAtMs: 0 }
  ]) {
    const out = await invoke(input, options, () => Response.json({ ...plan(), ...change }));
    assert.equal(out.code, 1, JSON.stringify(change));
    assert.equal(out.requests.length, 2);
  }
}));

test("lost PUT and finalize responses can be retried without treating a partial upload as ready", async () => fixture(async (input, options) => {
  const lost = await invoke(input, options, (index) => {
    if (index === 1) return Response.json(plan());
    throw new Error(`${url} ${token}`);
  });
  assert.equal(lost.code, 1);
  assert.equal(lost.requests.length, 3);
  for (const error of ["payload_integrity_mismatch", "payload_readback_failed", "payload_session_expired"]) {
    const partial = await invoke(input, options, (index) => {
      if (index === 1) return Response.json(plan());
      if (index === 2) return new Response(null, { status: 412 });
      return Response.json({ ok: false, error }, { status: 409 });
    });
    assert.equal(partial.code, 1);
    assert.equal(JSON.parse(partial.output).reason, error);
  }
  const retry = await invoke(input, options, (index) => {
    if (index === 1) return Response.json(plan());
    if (index === 2) return new Response(null, { status: 412 });
    return Response.json(ready());
  });
  assert.equal(retry.code, 0);
  const complete = await invoke(input, options, (index) => index === 1
    ? Response.json({ ...plan(), artifact: { ...artifact, ready: true }, upload: null })
    : Response.json(ready()));
  assert.equal(complete.code, 0);
  assert.equal(complete.requests.length, 3);
  for (const artifactChange of [{ ready: false }, { descriptorDigest: `sha256:${"f".repeat(64)}` }]) {
    const malformed = await invoke(input, options, (index) => index === 1
      ? Response.json({ ...plan(), artifact: { ...artifact, ready: true }, upload: null })
      : Response.json({ ...ready(), artifact: { ...ready().artifact, ...artifactChange } }));
    assert.equal(malformed.code, 1);
  }
  const saved = JSON.parse(await readFile(input.config!, "utf8"));
  assert.equal(saved.sessionToken, token);
}));


test("wrong descriptor ABI is sent to the authoritative validator and its refusal prevents PUT", async () => fixture(async (input, options) => {
  const wrong = { ...descriptor, targetAbi: { ...descriptor.targetAbi, architecture: "unsupported-abi" } };
  await writeFile(input.descriptor!, JSON.stringify(wrong));
  const out = await invoke(input, options, (index, _url, init) => {
    assert.equal(index, 1);
    assert.deepEqual(JSON.parse(String(init?.body)).descriptor.targetAbi, wrong.targetAbi);
    return Response.json({ ok: false, error: "invalid_payload_descriptor" }, { status: 400 });
  });
  assert.equal(out.code, 1);
  assert.equal(out.requests.length, 2);
}));

test("native request exceptions and reflected identity credentials stay secret-safe", async () => fixture(async (input, options) => {
  for (const failureStage of [1, 2, 3]) {
    const out = await invoke(input, options, (index) => {
      if (index === failureStage) throw new Error(`${token} ${url}`);
      if (index === 1) return Response.json(plan());
      if (index === 2) return new Response(null, { status: 200 });
      return Response.json(ready());
    });
    assert.equal(out.code, 1);
  }
  const out = await invoke(input, options, (index) => {
    const identity = { ...artifact, artifactVersionId: token };
    if (index === 1) return Response.json({ ...plan(), artifact: identity });
    if (index === 2) return new Response(null, { status: 200 });
    return Response.json({ ...ready(), artifact: { ...identity, ready: true } });
  });
  assert.equal(out.code, 1);
}));
