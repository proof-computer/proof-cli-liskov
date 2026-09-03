import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile, chmod, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type WebSocket from "ws";

import {
  MAX_ACCESS_FRAME_BYTES,
  buildSessionEndpoint,
  readOperatorToken,
  runManagedAccessProxy,
  splitBinaryFrames,
  validateGatewayOrigin
} from "../src/managed-access-proxy.js";

test("managed proxy accepts only a credential-free WSS origin", () => {
  assert.equal(
    buildSessionEndpoint("wss://access.example/", "tunnel_123"),
    "wss://access.example/v1/sessions/tunnel_123"
  );
  for (const value of [
    "ws://access.example",
    "wss://user:pass@access.example",
    "wss://access.example/path",
    "wss://access.example?token=secret",
    "wss://access.example/#secret"
  ]) {
    assert.throws(() => validateGatewayOrigin(value), /access_proxy_invalid_gateway/);
  }
});

test("operator token file must be regular, mode 0600, bounded, and symlink-free", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liskov-access-token-"));
  const tokenFile = path.join(root, "operator.token");
  await writeFile(tokenFile, "operator-token\n", { mode: 0o600 });
  assert.equal(await readOperatorToken(tokenFile), "operator-token");
  await chmod(tokenFile, 0o640);
  await assert.rejects(readOperatorToken(tokenFile), /access_proxy_invalid_token_file/);
  await chmod(tokenFile, 0o600);
  const link = path.join(root, "token-link");
  await symlink(tokenFile, link);
  await assert.rejects(readOperatorToken(link), /access_proxy_invalid_token_file/);
});

test("stdin chunks split into bounded binary frames without changing bytes", () => {
  const original = Buffer.alloc(MAX_ACCESS_FRAME_BYTES * 2 + 17);
  for (let index = 0; index < original.length; index += 1) original[index] = index % 251;
  const frames = splitBinaryFrames(original);
  assert.deepEqual(frames.map((frame) => frame.length), [MAX_ACCESS_FRAME_BYTES, MAX_ACCESS_FRAME_BYTES, 17]);
  assert.deepEqual(Buffer.concat(frames), original);
});

test("proxy copies stdin and stdout bytes without framing text or diagnostics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liskov-access-bridge-"));
  const tokenFile = path.join(root, "operator.token");
  await writeFile(tokenFile, "one-time-token\n", { mode: 0o600 });
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
  const sent: Buffer[] = [];
  const emitter = new EventEmitter();
  const fake = Object.assign(emitter, {
    protocol: "liskov-access.v1",
    pause: () => undefined,
    resume: () => undefined,
    terminate: () => undefined,
    send: (data: Buffer, _options: unknown, callback: (error?: Error) => void) => {
      sent.push(Buffer.from(data));
      callback();
    },
    close: () => queueMicrotask(() => emitter.emit("close", 1000))
  }) as unknown as WebSocket;
  const proxy = runManagedAccessProxy(
    { gateway: "wss://access.example", tokenFile, tunnelId: "tunnel_test" },
    { stdin: input, stdout: output },
    {
      createSocket: (endpoint, token) => {
        assert.equal(endpoint, "wss://access.example/v1/sessions/tunnel_test");
        assert.equal(token, "one-time-token");
        queueMicrotask(() => emitter.emit("open"));
        return fake;
      }
    }
  );
  while (emitter.listenerCount("message") === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const outbound = Buffer.alloc(MAX_ACCESS_FRAME_BYTES + 13, 0xa5);
  input.write(outbound);
  const inbound = Buffer.from([0, 255, 1, 2, 3, 0]);
  emitter.emit("message", inbound, true);
  input.end();
  await proxy;
  assert.deepEqual(Buffer.concat(sent), outbound);
  assert.deepEqual(Buffer.concat(outputChunks), inbound);
});

test("proxy reports only allowlisted gateway close categories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liskov-access-close-"));
  const tokenFile = path.join(root, "operator.token");
  await writeFile(tokenFile, "one-time-token\n", { mode: 0o600 });

  for (const [reason, expected] of [
    ["connector_closed", "access_proxy_closed_connector_closed"],
    ["secret bearer material", "access_proxy_closed"]
  ]) {
    const emitter = new EventEmitter();
    const fake = Object.assign(emitter, {
      protocol: "liskov-access.v1",
      pause: () => undefined,
      resume: () => undefined,
      terminate: () => undefined,
      send: () => undefined,
      close: () => undefined
    }) as unknown as WebSocket;
    const proxy = runManagedAccessProxy(
      { gateway: "wss://access.example", tokenFile, tunnelId: "tunnel_test" },
      { stdin: new PassThrough(), stdout: new PassThrough() },
      {
        createSocket: () => {
          queueMicrotask(() => {
            emitter.emit("open");
            emitter.emit("close", 1011, Buffer.from(reason));
          });
          return fake;
        }
      }
    );
    await assert.rejects(proxy, (error: unknown) =>
      error instanceof Error && error.message === expected
    );
  }
});

// `BKLG-20260805-rykk`. The gateway refuses an operator *before* the WebSocket
// upgrade, so `ws` reports `unexpected-response` rather than a close frame.
// That path used to discard the status and body and report the bare token
// `access_proxy_rejected`, which is why a second concurrent session was
// indistinguishable from a runtime that never dialled in — and why it was
// untested. The categories are read back through the same allowlist as close
// frames, so an unrecognised one still degrades rather than echoing upstream.
test("proxy names which refusal the gateway sent, and echoes nothing it does not recognise", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liskov-access-reject-"));
  const tokenFile = path.join(root, "operator.token");
  await writeFile(tokenFile, "one-time-token\n", { mode: 0o600 });

  for (const [body, expected] of [
    ["session_already_open", "access_proxy_rejected_session_already_open"],
    ["connector_not_registered", "access_proxy_rejected_connector_not_registered"],
    ["connector_unavailable", "access_proxy_rejected_connector_unavailable"],
    // The live failure mode between 2026-08-18 and 2026-09-03: a gateway that
    // could not deserialize the control plane's ticket claims answered 401
    // credential_rejected, and every operator saw only the bare token.
    ["credential_rejected", "access_proxy_rejected_credential_rejected"],
    // Not in the allowlist: the operator gets the bare token, never the
    // upstream's own words.
    ["secret bearer material", "access_proxy_rejected"]
  ]) {
    const emitter = new EventEmitter();
    const fake = Object.assign(emitter, {
      protocol: "liskov-access.v1",
      pause: () => undefined,
      resume: () => undefined,
      terminate: () => undefined,
      send: () => undefined,
      close: () => undefined
    }) as unknown as WebSocket;
    const proxy = runManagedAccessProxy(
      { gateway: "wss://access.example", tokenFile, tunnelId: "tunnel_test" },
      { stdin: new PassThrough(), stdout: new PassThrough() },
      {
        createSocket: () => {
          queueMicrotask(() => {
            const response = new PassThrough();
            emitter.emit("unexpected-response", {}, response);
            response.end(Buffer.from(body));
          });
          return fake;
        }
      }
    );
    await assert.rejects(proxy, (error: unknown) =>
      error instanceof Error && error.message === expected
    );
  }
});

// A refusal body large enough to be a payload rather than a category is cut
// off and reported as the bare token: the gateway is not a source of text this
// CLI will relay to a terminal.
test("proxy bounds the refusal body it will read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liskov-access-reject-bound-"));
  const tokenFile = path.join(root, "operator.token");
  await writeFile(tokenFile, "one-time-token\n", { mode: 0o600 });

  const emitter = new EventEmitter();
  const fake = Object.assign(emitter, {
    protocol: "liskov-access.v1",
    pause: () => undefined,
    resume: () => undefined,
    terminate: () => undefined,
    send: () => undefined,
    close: () => undefined
  }) as unknown as WebSocket;
  const proxy = runManagedAccessProxy(
    { gateway: "wss://access.example", tokenFile, tunnelId: "tunnel_test" },
    { stdin: new PassThrough(), stdout: new PassThrough() },
    {
      createSocket: () => {
        queueMicrotask(() => {
          const response = new PassThrough();
          emitter.emit("unexpected-response", {}, response);
          response.end(Buffer.alloc(4096, 0x61));
        });
        return fake;
      }
    }
  );
  await assert.rejects(proxy, (error: unknown) =>
    error instanceof Error && error.message === "access_proxy_rejected"
  );
});
