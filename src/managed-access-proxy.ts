import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";

import WebSocket, { type RawData } from "ws";

export const ACCESS_SUBPROTOCOL = "liskov-access.v1";
export const MAX_ACCESS_FRAME_BYTES = 64 * 1024;
const MAX_TOKEN_BYTES = 16 * 1024;

export class ManagedAccessProxyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ManagedAccessProxyError";
  }
}

export interface ManagedAccessProxyOptions {
  gateway: string;
  tunnelId: string;
  tokenFile: string;
}

interface ProxyStreams {
  stdin: Readable;
  stdout: Writable;
}

export interface ManagedAccessProxyDependencies {
  createSocket?: (endpoint: string, token: string) => WebSocket;
}

export function validateGatewayOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ManagedAccessProxyError("access_proxy_invalid_gateway");
  }
  if (
    url.protocol !== "wss:" ||
    !url.hostname ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new ManagedAccessProxyError("access_proxy_invalid_gateway");
  }
  return url;
}

export function validateTunnelId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    throw new ManagedAccessProxyError("access_proxy_invalid_tunnel");
  }
  return value;
}

export function buildSessionEndpoint(gateway: string, tunnelId: string): string {
  const origin = validateGatewayOrigin(gateway);
  const id = validateTunnelId(tunnelId);
  origin.pathname = `/v1/sessions/${id}`;
  return origin.toString();
}

export async function readOperatorToken(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.size > MAX_TOKEN_BYTES + 1) {
      throw new ManagedAccessProxyError("access_proxy_invalid_token_file");
    }
    const bytes = await handle.readFile();
    const token = bytes.toString("utf8").replace(/\n$/, "");
    bytes.fill(0);
    if (
      Buffer.byteLength(token) === 0 ||
      Buffer.byteLength(token) > MAX_TOKEN_BYTES ||
      !/^[\x21-\x7e]+$/.test(token)
    ) {
      throw new ManagedAccessProxyError("access_proxy_invalid_token_file");
    }
    return token;
  } catch (error) {
    if (error instanceof ManagedAccessProxyError) throw error;
    throw new ManagedAccessProxyError("access_proxy_invalid_token_file");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function splitBinaryFrames(chunk: Uint8Array): Buffer[] {
  const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const frames: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += MAX_ACCESS_FRAME_BYTES) {
    frames.push(bytes.subarray(offset, Math.min(offset + MAX_ACCESS_FRAME_BYTES, bytes.length)));
  }
  return frames;
}

function rawDataBuffer(data: RawData): Buffer {
  const value: unknown = data;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (Array.isArray(value) && value.every(Buffer.isBuffer)) return Buffer.concat(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new ManagedAccessProxyError("access_proxy_protocol_failed");
}

export async function runManagedAccessProxy(
  options: ManagedAccessProxyOptions,
  streams: ProxyStreams = { stdin: process.stdin, stdout: process.stdout },
  dependencies: ManagedAccessProxyDependencies = {}
): Promise<void> {
  const endpoint = buildSessionEndpoint(options.gateway, options.tunnelId);
  const token = await readOperatorToken(options.tokenFile);
  const socket = dependencies.createSocket?.(endpoint, token) ??
    new WebSocket(endpoint, ACCESS_SUBPROTOCOL, {
      followRedirects: false,
      handshakeTimeout: 15_000,
      headers: { Authorization: `Bearer ${token}` },
      maxPayload: MAX_ACCESS_FRAME_BYTES,
      perMessageDeflate: false
    });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let outbound = Promise.resolve();
    const fail = (code: string): void => {
      if (settled) return;
      settled = true;
      streams.stdin.pause();
      socket.terminate();
      reject(new ManagedAccessProxyError(code));
    };
    socket.once("unexpected-response", () => fail("access_proxy_rejected"));
    socket.once("error", () => fail("access_proxy_transport_failed"));
    socket.once("open", () => {
      if (socket.protocol !== ACCESS_SUBPROTOCOL) {
        fail("access_proxy_protocol_failed");
        return;
      }
      streams.stdin.on("data", (chunk: Buffer | string) => {
        streams.stdin.pause();
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        outbound = outbound
          .then(async () => {
            for (const frame of splitBinaryFrames(bytes)) {
              await new Promise<void>((sent, sendFailed) => {
                socket.send(frame, { binary: true, compress: false }, (error) =>
                  error ? sendFailed(error) : sent()
                );
              });
            }
          })
          .then(() => {
            streams.stdin.resume();
          })
          .catch(() => fail("access_proxy_transport_failed"));
      });
      streams.stdin.once("end", () => {
        void outbound.finally(() => socket.close(1000));
      });
      streams.stdin.once("error", () => fail("access_proxy_input_failed"));
      streams.stdin.resume();
    });
    socket.on("message", (data, isBinary) => {
      if (!isBinary) {
        fail("access_proxy_protocol_failed");
        return;
      }
      const bytes = rawDataBuffer(data);
      if (bytes.length > MAX_ACCESS_FRAME_BYTES) {
        fail("access_proxy_protocol_failed");
        return;
      }
      if (!streams.stdout.write(bytes)) {
        socket.pause();
        streams.stdout.once("drain", () => socket.resume());
      }
    });
    socket.once("close", (code) => {
      if (settled) return;
      settled = true;
      streams.stdin.pause();
      if (code === 1000) resolve();
      else reject(new ManagedAccessProxyError("access_proxy_closed"));
    });
  });
}
