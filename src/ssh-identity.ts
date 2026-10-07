import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { RuntimeSshProcessRunner } from "./runtime-ssh.js";

/** Read the public envelope in an actual private-key file, never a .pub hint.
 * OpenSSH leaves this envelope readable even when the private half is encrypted:
 * https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key
 * OpenSSH itself decrypts and authenticates the private half when connecting.
 */
export async function privateIdentityPublicKey(identity: string, runner: RuntimeSshProcessRunner): Promise<string> {
  const info = await stat(identity);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Expected a private-key file smaller than 1 MiB.");
  const value = await readFile(identity, "utf8");
  if (value.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")) {
    const encoded = value.match(/^-----BEGIN OPENSSH PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)-----END OPENSSH PRIVATE KEY-----\s*$/u)?.[1];
    if (!encoded) throw new Error("Invalid OpenSSH private-key envelope.");
    const blob = Buffer.from(encoded.replace(/\s/gu, ""), "base64");
    const magic = Buffer.from("openssh-key-v1\0", "ascii");
    if (!blob.subarray(0, magic.length).equals(magic)) throw new Error("Invalid OpenSSH private-key header.");
    let offset = magic.length;
    const uint32 = (): number => {
      if (offset + 4 > blob.length) throw new Error("Truncated OpenSSH private-key header.");
      const value = blob.readUInt32BE(offset);
      offset += 4;
      return value;
    };
    const string = (): Buffer => {
      const length = uint32();
      if (length > blob.length - offset) throw new Error("Truncated OpenSSH private-key field.");
      const value = blob.subarray(offset, offset + length);
      offset += length;
      return value;
    };
    string(); // cipher
    string(); // KDF
    string(); // KDF options
    if (uint32() !== 1) throw new Error("Expected one key in the OpenSSH private-key envelope.");
    const publicKey = string();
    if (string().length === 0 || offset !== blob.length) throw new Error("Invalid OpenSSH private-key payload.");
    return `ssh-ed25519 ${publicKey.toString("base64")}`;
  }
  if (!/^-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/u.test(value)) throw new Error("Expected a private-key file.");
  // No prompt during discovery. Encrypted OpenSSH keys use the public envelope
  // above; other formats can be converted to OpenSSH with ssh-keygen.
  const result = await runner("ssh-keygen", ["-y", "-P", "", "-f", identity], "capture");
  if (result.exitCode !== 0) throw new Error("Could not derive the public key. Use an OpenSSH Ed25519 private key.");
  return result.stdout;
}

export function localSshDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME ?? env.USERPROFILE ?? homedir(), ".ssh");
}

export async function localIdentityPaths(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && !entry.name.endsWith(".pub"))
      .map((entry) => path.join(directory, entry.name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
