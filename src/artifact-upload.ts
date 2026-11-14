import { createHash } from "node:crypto";

/**
 * Flag options. Kept wider than the member allowlist so oclif does not refuse
 * the encrypted mode before the CLI can name its own reason.
 */
export const ARTIFACT_ENCRYPTION_MODES = ["none", "aes-256-gcm-payload-v1"] as const;

/** Postures a member CLI upload will send. Encrypted payloads are refused locally. */
export const MEMBER_UPLOAD_ENCRYPTION_MODES = ["none"] as const;

export type ArtifactEncryptionMode = (typeof ARTIFACT_ENCRYPTION_MODES)[number];
export type MemberUploadEncryptionMode = (typeof MEMBER_UPLOAD_ENCRYPTION_MODES)[number];

export interface ArtifactFileHash {
  sha256Hex: string;
  byteSize: number;
}

export interface ArtifactUploadIntentRequest {
  sha256: string;
  byteSize: number;
  manifestDigest: string;
  encryptionMode: ArtifactEncryptionMode;
}

export interface ArtifactUploadTarget {
  url: string;
  method: string;
  field: string;
}

export interface ArtifactUploadIntentResponse {
  ok: true;
  uploadId: string;
  token: string;
  upload: ArtifactUploadTarget;
  gatewayUrlTemplate: string;
  maxBytes: number;
  encryptionMode: ArtifactEncryptionMode;
  expiresAtMs: number;
  cidVersion: 0;
}

export interface ArtifactUploadRecordRequest {
  uploadId: string;
  cid: string;
  sha256: string;
  byteSize: number;
  manifestDigest: string;
  encryptionMode: ArtifactEncryptionMode;
}

export interface ArtifactUploadRecordResponse {
  ok: true;
  artifactVersionId: string;
  artifactDigest: string;
  artifactCid: string;
  byteSize: number;
  uploadedBy: string;
  uploadedAtMs: number;
  alreadyRecorded: boolean;
}

const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/u;

export function isArtifactEncryptionMode(value: string): value is ArtifactEncryptionMode {
  return (ARTIFACT_ENCRYPTION_MODES as readonly string[]).includes(value);
}

export function isMemberUploadEncryptionMode(value: string): value is MemberUploadEncryptionMode {
  return (MEMBER_UPLOAD_ENCRYPTION_MODES as readonly string[]).includes(value);
}

export function hashFile(bytes: Uint8Array): ArtifactFileHash {
  return {
    sha256Hex: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength
  };
}

/**
 * Exactly one `file` part. PROOF's upload service refuses any other multipart
 * field (LIA4010); the upload token already fixes CIDv0.
 */
export function buildUploadForm(bytes: Uint8Array): FormData {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const form = new FormData();
  form.append("file", new Blob([copy], { type: "application/zip" }), "bundle.zip");
  return form;
}

/** The upload service's `IpfsHash` is the CIDv0, without an `ipfs://` prefix. */
export function parseIpfsHash(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const hash = (body as { IpfsHash?: unknown }).IpfsHash;
  return typeof hash === "string" && CID_V0.test(hash) ? hash : undefined;
}

export interface NativePayloadIdentity {
  artifactVersionId: string;
  artifactDigest: string;
  descriptorDigest: string;
  byteSize: number;
  ready: boolean;
}

export interface PrivatePayloadUploadPlan {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export function nativePayloadIdentity(value: unknown, expected: ArtifactFileHash): NativePayloadIdentity | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.artifactVersionId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(v.artifactVersionId)
    || v.artifactDigest !== `sha256:${expected.sha256Hex}`
    || typeof v.descriptorDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(v.descriptorDigest)
    || v.byteSize !== expected.byteSize || typeof v.ready !== "boolean") return undefined;
  return {
    artifactVersionId: v.artifactVersionId, artifactDigest: v.artifactDigest,
    descriptorDigest: v.descriptorDigest, byteSize: v.byteSize, ready: v.ready
  };
}

/** Consume the owner's signed PUT as issued, without a session bearer or redirects. */
export function privatePayloadUploadPlan(value: unknown, expected: ArtifactFileHash): PrivatePayloadUploadPlan | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.method !== "PUT" || typeof v.url !== "string" || v.headers === null || typeof v.headers !== "object" || Array.isArray(v.headers)) return undefined;
  try {
    const url = new URL(v.url);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") return undefined;
    const headers = v.headers as Record<string, unknown>;
    if (Object.values(headers).some((entry) => typeof entry !== "string")) return undefined;
    const normalized = new Headers(headers as Record<string, string>);
    if (normalized.get("content-length") !== String(expected.byteSize)
      || normalized.get("x-amz-checksum-sha256") !== Buffer.from(expected.sha256Hex, "hex").toString("base64")
      || normalized.get("if-none-match") !== "*") return undefined;
    return { url: v.url, method: "PUT", headers: headers as Record<string, string> };
  } catch {
    return undefined;
  }
}
