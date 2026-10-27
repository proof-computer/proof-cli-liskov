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
