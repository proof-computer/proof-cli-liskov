import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseIpfsHash } from "../src/artifact-upload.js";
import { runSlipwayApplicationArtifactUpload, type SlipwayApplicationArtifactUploadInput } from "../src/session.js";

const SESSION_TOKEN = "session-token-that-must-not-be-printed";
const UPLOAD_TOKEN = "upload-token-that-must-not-be-printed";
const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const UPLOAD_ID = `upl-${"a".repeat(32)}`;
const UPLOAD_URL = "https://upload.test/pinning/pinFileToIPFS";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function organization(id: string) {
  return { id, name: id, slug: id, isPersonal: false, role: "admin" };
}

function sessionBody(effective: string, sessionDefault = effective) {
  return {
    ok: true,
    session: { sessionId: "sess-1" },
    organization: organization(sessionDefault),
    organizationContext: {
      source: effective === sessionDefault ? "session" : "request",
      effective: organization(effective),
      sessionDefault: organization(sessionDefault)
    }
  };
}

function intentBody(encryptionMode = "none") {
  return {
    ok: true,
    uploadId: UPLOAD_ID,
    token: UPLOAD_TOKEN,
    upload: { url: UPLOAD_URL, method: "POST", field: "file" },
    gatewayUrlTemplate: "https://gateway.test/ipfs/{cid}",
    maxBytes: 8_388_608,
    encryptionMode,
    expiresAtMs: 1,
    cidVersion: 0
  };
}

function recordBody(bytes: Uint8Array, manifestDigest: string, alreadyRecorded = false) {
  return {
    ok: true,
    artifactVersionId: "member-abc",
    artifactDigest: `sha256:${sha256(bytes)}`,
    artifactCid: `ipfs://${CID}`,
    byteSize: bytes.byteLength,
    uploadedBy: "member-1",
    uploadedAtMs: 1,
    alreadyRecorded,
    manifestDigest
  };
}

interface Seen {
  url: string;
  method: string;
  authorization: string;
  contentType: string | null;
  organization: string | null;
  body: unknown;
}

async function withSession(run: (sessionFile: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proof-artifact-upload-"));
  const sessionFile = path.join(directory, "session.json");
  const saved = JSON.stringify({
    version: 1,
    slipwayUrl: "https://liskov.test",
    sessionToken: SESSION_TOKEN,
    savedAtMs: 1
  });
  await writeFile(sessionFile, saved, { mode: 0o600 });
  try {
    await run(sessionFile);
    assert.equal(await readFile(sessionFile, "utf8"), saved);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withBundle(
  bundle: Buffer,
  run: (file: string, manifest?: string) => Promise<void>,
  manifest?: Buffer
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proof-artifact-bundle-"));
  const file = path.join(directory, "bundle.zip");
  await writeFile(file, bundle);
  const manifestPath = manifest === undefined ? undefined : path.join(directory, "manifest.json");
  if (manifest && manifestPath) await writeFile(manifestPath, manifest);
  try {
    await run(file, manifestPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function assertNoSecrets(text: string, seen: readonly Seen[]): void {
  assert.equal(text.includes(SESSION_TOKEN), false, text);
  assert.equal(text.includes(UPLOAD_TOKEN), false, text);
  for (const request of seen) {
    assert.equal(request.url.includes(SESSION_TOKEN), false);
    assert.equal(request.url.includes(UPLOAD_TOKEN), false);
    assert.equal(request.url.includes("/api/applications/"), false, request.url);
  }
}

async function runUpload(
  sessionFile: string,
  input: SlipwayApplicationArtifactUploadInput,
  respond: (index: number, request: Seen) => Response | Promise<Response>,
  organization?: string
) {
  const seen: Seen[] = [];
  const stdout: string[] = [];
  const code = await runSlipwayApplicationArtifactUpload(input, {
    env: {},
    organization,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stdout.push(line),
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers);
      let body: unknown = init?.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body) as unknown;
        } catch {
          // Keep a non-JSON body as text.
        }
      }
      const request: Seen = {
        url: String(url),
        method: init?.method ?? "GET",
        authorization: headers.get("authorization") ?? "",
        contentType: headers.get("content-type"),
        organization: headers.get("x-liskov-organization"),
        body
      };
      seen.push(request);
      return respond(seen.length - 1, request);
    }
  });
  const text = stdout.join("\n");
  assertNoSecrets(text, seen);
  return { code, text, seen };
}

function successScript(record: ReturnType<typeof recordBody>, encryptionMode = "none") {
  return (index: number) => {
    if (index === 0) return Response.json(sessionBody("org 1"));
    if (index === 1) return Response.json(intentBody(encryptionMode));
    if (index === 2) return Response.json({ IpfsHash: CID, PinSize: 1, Timestamp: "2026-10-27T00:00:00.000Z" });
    if (index === 3) return Response.json(record);
    throw new Error(`unexpected request ${index}`);
  };
}

test("happy path requests session, intent, upload, and record in order", async () => {
  const bytes = Buffer.from("bundle-bytes");
  const record = recordBody(bytes, `sha256:${sha256(bytes)}`);
  await withBundle(bytes, async (file) => {
    await withSession(async (sessionFile) => {
      const human = await runUpload(sessionFile, {
        applicationRef: "my app",
        file,
        config: sessionFile
      }, successScript(record));
      assert.equal(human.code, 0);
      assert.equal(human.seen.length, 4);
      assert.equal(human.seen[0]?.method, "GET");
      assert.equal(new URL(human.seen[0]!.url).pathname, "/api/session");
      assert.equal(human.seen[0]?.authorization, `Bearer ${SESSION_TOKEN}`);
      assert.equal(human.seen[1]?.method, "POST");
      assert.equal(human.seen[1]?.contentType, "application/json");
      assert.equal(human.seen[1]?.authorization, `Bearer ${SESSION_TOKEN}`);
      assert.equal(
        new URL(human.seen[1]!.url).pathname,
        `/api/organizations/${encodeURIComponent("org 1")}/applications/${encodeURIComponent("my app")}/artifact-upload-intents`
      );
      assert.deepEqual(human.seen[1]?.body, {
        sha256: sha256(bytes),
        byteSize: bytes.byteLength,
        manifestDigest: `sha256:${sha256(bytes)}`,
        encryptionMode: "none"
      });
      assert.equal(human.seen[2]?.url, UPLOAD_URL);
      assert.equal(human.seen[2]?.method, "POST");
      assert.equal(human.seen[2]?.authorization, `Bearer ${UPLOAD_TOKEN}`);
      assert.equal(human.seen[2]?.contentType, null);
      const form = human.seen[2]?.body as FormData;
      assert.deepEqual([...form.keys()], ["file", "pinataOptions"]);
      const uploaded = form.get("file");
      assert.ok(uploaded instanceof File);
      assert.equal(uploaded.name, "bundle.zip");
      assert.equal(uploaded.type, "application/zip");
      assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), bytes);
      assert.equal(form.get("pinataOptions"), JSON.stringify({ cidVersion: 0 }));
      assert.equal(human.seen[3]?.method, "POST");
      assert.equal(human.seen[3]?.contentType, "application/json");
      assert.equal(
        new URL(human.seen[3]!.url).pathname,
        `/api/organizations/${encodeURIComponent("org 1")}/applications/${encodeURIComponent("my app")}/artifact-uploads`
      );
      assert.deepEqual(human.seen[3]?.body, {
        uploadId: UPLOAD_ID,
        cid: `ipfs://${CID}`,
        sha256: sha256(bytes),
        byteSize: bytes.byteLength,
        manifestDigest: `sha256:${sha256(bytes)}`,
        encryptionMode: "none"
      });
      assert.equal(
        human.text,
        `Uploaded ${file} for my app: member-abc (sha256:${sha256(bytes)}, ipfs://${CID})`
      );

      const json = await runUpload(sessionFile, {
        applicationRef: "my app",
        file,
        config: sessionFile,
        json: true
      }, successScript(record));
      assert.equal(json.code, 0);
      assert.deepEqual(JSON.parse(json.text), record);
    });
  });
});

test("a manifest digest replaces the bundle digest and encryption mode is forwarded unchanged", async () => {
  const bytes = Buffer.from("bundle-bytes");
  const manifest = Buffer.from("{\"name\":\"app\"}");
  const manifestDigest = `sha256:${sha256(manifest)}`;
  const record = recordBody(bytes, manifestDigest, true);
  await withBundle(bytes, async (file, manifestPath) => {
    await withSession(async (sessionFile) => {
      const out = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        manifest: manifestPath,
        encryptionMode: "aes-256-gcm-payload-v1",
        config: sessionFile
      }, successScript(record, "aes-256-gcm-payload-v1"));
      assert.equal(out.code, 0);
      assert.equal((out.seen[1]?.body as { manifestDigest: string }).manifestDigest, manifestDigest);
      assert.notEqual(manifestDigest, `sha256:${sha256(bytes)}`);
      assert.equal((out.seen[1]?.body as { encryptionMode: string }).encryptionMode, "aes-256-gcm-payload-v1");
      assert.equal((out.seen[3]?.body as { encryptionMode: string }).encryptionMode, "aes-256-gcm-payload-v1");
      assert.equal(
        out.text,
        `Uploaded ${file} for proof-docs: member-abc (sha256:${sha256(bytes)}, ipfs://${CID}), already recorded`
      );
    });
  }, manifest);
});

test("an explicit organization selector wins and a missing context uses organization.id", async () => {
  const bytes = Buffer.from("bundle");
  await withBundle(bytes, async (file) => {
    await withSession(async (sessionFile) => {
      const selected = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile
      }, (index) => {
        if (index === 0) return Response.json(sessionBody("org-canonical", "org-default"));
        if (index === 1) return Response.json(intentBody());
        if (index === 2) return Response.json({ IpfsHash: CID });
        return Response.json(recordBody(bytes, `sha256:${sha256(bytes)}`));
      }, "team-slug");
      assert.equal(selected.code, 0);
      assert.equal(selected.seen[0]?.organization, "team-slug");
      assert.equal(selected.seen[0]?.authorization, `Liskov-Organization ${SESSION_TOKEN}`);
      assert.equal(selected.seen[1]?.organization, "team-slug");
      assert.equal(selected.seen[2]?.organization, null);
      assert.equal(selected.seen[2]?.authorization, `Bearer ${UPLOAD_TOKEN}`);
      assert.match(selected.seen[1]!.url, /\/api\/organizations\/org-canonical\/applications\/proof-docs\/artifact-upload-intents$/u);
      assert.match(selected.seen[3]!.url, /\/api\/organizations\/org-canonical\/applications\/proof-docs\/artifact-uploads$/u);
      assert.equal(selected.seen.some((request) => request.url.includes("team-slug") || request.url.includes("org-default")), false);

      const plain = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile
      }, (index) => {
        if (index === 0) {
          return Response.json({ ok: true, session: { sessionId: "sess-1" }, organization: organization("org-plain") });
        }
        if (index === 1) return Response.json(intentBody());
        if (index === 2) return Response.json({ IpfsHash: CID });
        return Response.json(recordBody(bytes, `sha256:${sha256(bytes)}`));
      });
      assert.equal(plain.code, 0);
      assert.match(plain.seen[1]!.url, /\/api\/organizations\/org-plain\/applications\/proof-docs\/artifact-upload-intents$/u);
    });
  });
});

test("a refused or malformed session stops before either write", async () => {
  const bytes = Buffer.from("bundle");
  await withBundle(bytes, async (file) => {
    await withSession(async (sessionFile) => {
      const refused = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile
      }, () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 }));
      assert.equal(refused.code, 1);
      assert.equal(refused.seen.length, 1);
      assert.match(refused.text, /SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_REFUSED/u);
      assert.match(refused.text, /401/u);

      const malformed = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile
      }, () => Response.json({
        ok: true,
        session: { sessionId: "sess-1" },
        organizationContext: { source: "session", effective: { id: "" }, sessionDefault: null }
      }));
      assert.equal(malformed.code, 1);
      assert.equal(malformed.seen.length, 1);
      assert.match(malformed.text, /malformed_organization/u);

      const missing = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile
      }, () => Response.json({ ok: true, session: { sessionId: "sess-1" } }));
      assert.equal(missing.code, 1);
      assert.equal(missing.seen.length, 1);
      assert.match(missing.text, /SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_REFUSED/u);
    });
  });
});

test("intent refusals keep the server code and do not upload", async () => {
  const bytes = Buffer.from("bundle");
  await withBundle(bytes, async (file) => {
    await withSession(async (sessionFile) => {
      const denied = {
        ok: false,
        error: "forbidden",
        reasonCode: "capability_not_granted",
        reason: "Session is not allowed to perform policy.publish",
        capability: "policy.publish"
      };
      const forbidden = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile,
        json: true
      }, (index) => index === 0
        ? Response.json(sessionBody("org-1"))
        : Response.json(denied, { status: 403 }));
      assert.equal(forbidden.code, 1);
      assert.equal(forbidden.seen.length, 2);
      assert.deepEqual(JSON.parse(forbidden.text), {
        ok: false,
        error: "SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_REFUSED",
        status: 403,
        reason: "Session is not allowed to perform policy.publish",
        reasonCode: "capability_not_granted",
        serverError: "forbidden"
      });
      assert.equal(forbidden.text.includes("forbidden"), true);
      assert.equal(forbidden.text.includes("capability_not_granted"), true);

      const human = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile
      }, (index) => index === 0
        ? Response.json(sessionBody("org-1"))
        : Response.json(denied, { status: 403 }));
      assert.equal(human.code, 1);
      assert.equal(human.seen.length, 2);
      assert.match(human.text, /SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_REFUSED/u);
      assert.match(human.text, /forbidden/u);
      assert.match(human.text, /capability_not_granted/u);

      const codedOnly = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile,
        json: true
      }, (index) => index === 0
        ? Response.json(sessionBody("org-1"))
        : Response.json({ ok: false, error: "forbidden", reasonCode: "capability_not_granted" }, { status: 403 }));
      assert.equal(codedOnly.code, 1);
      assert.equal(codedOnly.seen.length, 2);
      assert.deepEqual(JSON.parse(codedOnly.text), {
        ok: false,
        error: "SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_REFUSED",
        status: 403,
        reason: "forbidden",
        reasonCode: "capability_not_granted"
      });

      const tooLarge = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile
      }, (index) => index === 0
        ? Response.json(sessionBody("org-1"))
        : Response.json({ ok: false, error: "artifact_too_large", maxBytes: 8_388_608 }, { status: 413 }));
      assert.equal(tooLarge.code, 1);
      assert.equal(tooLarge.seen.length, 2);
      assert.match(tooLarge.text, /SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_REFUSED/u);
      assert.match(tooLarge.text, /maxBytes 8388608/u);
    });
  });
});

test("a failed upload is redacted and does not record", async () => {
  const bytes = Buffer.from("bundle");
  const leaked = `failed ${UPLOAD_TOKEN} ${SESSION_TOKEN} ${"x".repeat(400)}`;
  await withBundle(bytes, async (file) => {
    await withSession(async (sessionFile) => {
      const failed = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile,
        json: true
      }, (index) => {
        if (index === 0) return Response.json(sessionBody("org-1"));
        if (index === 1) return Response.json(intentBody());
        return new Response(leaked, { status: 502 });
      });
      assert.equal(failed.code, 1);
      assert.equal(failed.seen.length, 3);
      assert.match(failed.text, /SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_FAILED/u);
      const parsed = JSON.parse(failed.text) as { status?: number; body?: string };
      assert.equal(parsed.status, 502);
      assert.equal(parsed.body?.includes(UPLOAD_TOKEN), false);
      assert.equal(parsed.body?.includes(SESSION_TOKEN), false);
      assert.ok((parsed.body?.length ?? 0) <= 200);

      const missingHash = await runUpload(sessionFile, {
        applicationRef: "proof-docs",
        file,
        config: sessionFile
      }, (index) => {
        if (index === 0) return Response.json(sessionBody("org-1"));
        if (index === 1) return Response.json(intentBody());
        return Response.json({ IpfsHash: "not-a-cid" });
      });
      assert.equal(missingHash.code, 1);
      assert.equal(missingHash.seen.length, 3);
      assert.match(missingHash.text, /SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_FAILED/u);
    });
  });
});

test("record conflicts keep the server code", async () => {
  const bytes = Buffer.from("bundle");
  await withBundle(bytes, async (file) => {
    await withSession(async (sessionFile) => {
      for (const code of ["artifact_readback_mismatch", "artifact_digest_conflict"]) {
        const out = await runUpload(sessionFile, {
          applicationRef: "proof-docs",
          file,
          config: sessionFile,
          json: true
        }, (index) => {
          if (index === 0) return Response.json(sessionBody("org-1"));
          if (index === 1) return Response.json(intentBody());
          if (index === 2) return Response.json({ IpfsHash: CID });
          return Response.json({ ok: false, error: code }, { status: 409 });
        });
        assert.equal(out.code, 1);
        assert.equal(out.seen.length, 4);
        assert.deepEqual(JSON.parse(out.text), {
          ok: false,
          error: "SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_RECORD_FAILED",
          status: 409,
          reason: code,
          reasonCode: code
        });
      }
    });
  });
});

test("an unreadable bundle and a missing session do not upload", async () => {
  await withSession(async (sessionFile) => {
    const stdout: string[] = [];
    const code = await runSlipwayApplicationArtifactUpload({
      applicationRef: "proof-docs",
      file: path.join(sessionFile, "missing-bundle.zip"),
      config: sessionFile
    }, {
      env: {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stdout.push(line),
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      }
    });
    const text = stdout.join("\n");
    assert.equal(code, 1);
    assert.match(text, /SLIPWAY_APPLICATION_ARTIFACT_UPLOAD_FILE_UNREADABLE/u);
    assert.equal(text.includes(SESSION_TOKEN), false);
    assert.equal(text.includes(UPLOAD_TOKEN), false);
  });

  const bytes = Buffer.from("bundle");
  await withBundle(bytes, async (file) => {
    const stdout: string[] = [];
    const code = await runSlipwayApplicationArtifactUpload({
      applicationRef: "proof-docs",
      file,
      config: path.join(os.tmpdir(), `missing-session-${process.pid}.json`)
    }, {
      env: {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stdout.push(line),
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      }
    });
    const text = stdout.join("\n");
    assert.equal(code, 1);
    assert.match(text, /SLIPWAY_SESSION_NOT_FOUND/u);
    assert.equal(text.includes(SESSION_TOKEN), false);
    assert.equal(text.includes(UPLOAD_TOKEN), false);
  });
});

test("parseIpfsHash accepts only a CIDv0", () => {
  assert.equal(parseIpfsHash({ IpfsHash: CID }), CID);
  assert.equal(parseIpfsHash({ IpfsHash: "bafyrei" }), undefined);
  assert.equal(parseIpfsHash({ Hash: CID }), undefined);
  assert.equal(parseIpfsHash(null), undefined);
});
