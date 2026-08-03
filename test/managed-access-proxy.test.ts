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
