import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// Uses the npm payload and a loopback server; storage HTTPS is mapped to that
// server by the injected transport while production still requires HTTPS.
test("the packed CLI validates/exports dark V8 and finalizes a private member upload over HTTP", async () => {
  mkdirSync(".tmp", { recursive: true });
  const scratch = mkdtempSync(path.resolve(".tmp/payload-package-"));
  const bytes = Buffer.from("offline-native-package-bytes");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const artifact = { artifactVersionId: "payload-1", artifactDigest: digest, descriptorDigest: `sha256:${"e".repeat(64)}`, byteSize: bytes.length, ready: true };
  const token = "package-member-token-never-print";
  const signedUrl = "https://private.invalid/object?X-Amz-Signature=package-signature-never-print";
  let phase = 0;
  const requests: Array<{ url: string; body: Buffer; auth?: string }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    requests.push({ url: request.url!, body, auth: request.headers.authorization });
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/session") return response.end(JSON.stringify({ ok: true, session: { sessionId: "s" }, organization: { id: "org-member" } }));
    if (request.url?.endsWith("/artifact-upload-intents")) {
      assert.equal(JSON.parse(body.toString()).kind, "native_payload");
      return response.end(JSON.stringify({
        ok: true, kind: "native_payload", uploadId: `upl-${"a".repeat(32)}`,
        artifact: { ...artifact, ready: phase === 1 }, maxBytes: 8388608, expiresAtMs: Date.now() + 60000,
        upload: phase === 1 ? null : { url: signedUrl, method: "PUT", headers: {
          "content-length": String(bytes.length), "if-none-match": "*",
          "x-amz-checksum-sha256": Buffer.from(digest.slice(7), "hex").toString("base64")
        } }
      }));
    }
    if (request.url === "/storage") {
      assert.deepEqual(body, bytes);
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers["if-none-match"], "*");
      assert.equal(request.headers["x-amz-checksum-sha256"], Buffer.from(digest.slice(7), "hex").toString("base64"));
      response.end(); return;
    }
    assert.ok(request.url?.endsWith("/artifact-uploads"));
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const requestBody = JSON.parse(body.toString());
    assert.deepEqual(requestBody, { kind: "native_payload", uploadId: `upl-${"a".repeat(32)}`, artifactDigest: digest });
    if (phase === 0) { phase++; response.statusCode = 503; return response.end(JSON.stringify({ ok: false, error: "payload_verification_unavailable" })); }
    response.end(JSON.stringify({ ok: true, kind: "native_payload", artifact }));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const [packed] = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch, "--cache", path.join(scratch, "cache")], { encoding: "utf8" }));
    execFileSync("tar", ["-xzf", path.join(scratch, packed.filename), "-C", scratch]);
    const packageRoot = path.join(scratch, "package");
    const cli = await import(pathToFileURL(path.join(packageRoot, "dist/session.js")).href) as typeof import("../src/session.js");
    const file = path.join(scratch, "payload.tar.gz");
    const descriptor = path.join(scratch, "payload.json");
    const config = path.join(scratch, "session.json");
    writeFileSync(file, bytes);
    writeFileSync(descriptor, JSON.stringify({ artifactDigest: digest, artifactSizeBytes: bytes.length, encryption: "none" }));
    writeFileSync(config, JSON.stringify({ version: 1, slipwayUrl: origin, sessionToken: token, savedAtMs: 1 }), { mode: 0o600 });
    const input = { applicationRef: "member-only-app", kind: "native_payload", descriptor, file, config, json: true };
    let output = "";
    const options = { env: {}, stdout: (line: string) => { output = line; }, fetchImpl: ((url, init) => fetch(String(url) === signedUrl ? `${origin}/storage` : url, init)) as typeof fetch };
    assert.equal(await cli.runSlipwayApplicationArtifactUpload(input, options), 1);
    assert.equal(JSON.parse(output).reason, "payload_verification_unavailable");
    assert.equal(await cli.runSlipwayApplicationArtifactUpload(input, options), 0);
    assert.deepEqual(JSON.parse(output), { ok: true, kind: "native_payload", artifact });
    assert.equal(requests.filter((r) => r.url === "/storage").length, 1);
    assert.equal(requests.filter((r) => r.url.endsWith("/artifact-uploads")).length, 2);
    assert.equal(output.includes(token), false);
    assert.equal(output.includes("package-signature-never-print"), false);

    const uploadCommand = pathToFileURL(path.join(packageRoot, "dist/commands/liskov/application/artifact/upload.js")).href;
    const uploadScript = `import C from ${JSON.stringify(uploadCommand)}; await C.run(process.argv.slice(1), ${JSON.stringify(packageRoot)});`;
    const commandResult = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", uploadScript, "--", "member-only-app", "--kind", "native_payload", "--descriptor", descriptor, "--file", file, "--config", config, "--json", "--no-analytics"]);
    assert.deepEqual(JSON.parse(commandResult.stdout), { ok: true, kind: "native_payload", artifact });
    assert.equal((commandResult.stdout + commandResult.stderr).includes(token), false);
    assert.equal(requests.filter((r) => r.url === "/storage").length, 1);

    const manifest = path.join(scratch, "manifest.json");
    const exported = path.join(scratch, "exported.json");
    const document = JSON.parse(readFileSync("test/fixtures/payload-v8/payload-supervised-rollback.json", "utf8"));
    writeFileSync(manifest, JSON.stringify(document));
    const command = pathToFileURL(path.join(packageRoot, "dist/commands/liskov/application/manifest/validate.js")).href;
    const script = `import C from ${JSON.stringify(command)}; await C.run(process.argv.slice(1), ${JSON.stringify(packageRoot)});`;
    const args = ["--input-type=module", "-e", script, "--", "--file", manifest, "--export", exported, "--json", "--no-analytics"];
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).manifestValid, true);
    assert.equal(JSON.parse(result.stdout).firstPublicReady, false);
    assert.deepEqual(JSON.parse(readFileSync(exported, "utf8")), document);
    const overwrite = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(overwrite.status, 1);
    assert.equal(JSON.parse(overwrite.stdout).error, "manifest_export_failed");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(scratch, { recursive: true, force: true });
  }
});
