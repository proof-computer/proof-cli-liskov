import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runRuntimeSshConnection,
  runRuntimeSshIntegrationCreate,
  type RuntimeSshProcessRunner
} from "../src/runtime-ssh.js";

const token = "session-token-that-must-not-be-printed";
const secret = "oauth-secret-that-must-not-be-printed";

async function withSession(run: (sessionFile: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proof-runtime-ssh-test-"));
  const sessionFile = path.join(directory, "session.json");
  await writeFile(sessionFile, JSON.stringify({
    version: 1,
    slipwayUrl: "https://liskov.test",
    sessionToken: token,
    savedAtMs: 1
  }), { mode: 0o600 });
  try {
    await run(sessionFile);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("integration create reads its OAuth secret out of band and never prints it", async () => {
  await withSession(async (sessionFile) => {
    const output: string[] = [];
    const requestUrls: string[] = [];
    let requestBody = "";
    const code = await runRuntimeSshIntegrationCreate({
      organizationId: "organization-one",
      name: "Production tailnet",
      tailnet: "example.com",
      tag: "tag:liskov-runtime",
      oauthClientId: "client-id",
      config: sessionFile
    }, {
      readSecret: async () => secret,
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
      fetchImpl: async (url, init) => {
        requestUrls.push(String(url));
        assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
        if (String(url).endsWith("/api/organizations")) {
          return Response.json({
            ok: true,
            organizations: [{
              id: "org_1",
              name: "Organization One",
              slug: "organization-one",
              isPersonal: false,
              role: "owner"
            }]
          });
        }
        requestBody = String(init?.body);
        return Response.json({
          ok: true,
          integration: {
            integrationId: "int_1",
            kind: "tailscale",
            name: "Production tailnet",
            tailnet: "example.com",
            tag: "tag:liskov-runtime",
            credentialVersion: 1,
            lifecycle: "enabled",
            validation: "pending"
          }
        }, { status: 201 });
      }
    });
    assert.equal(code, 0);
    assert.deepEqual(requestUrls, [
      "https://liskov.test/api/organizations",
      "https://liskov.test/api/organizations/org_1/runtime-ssh/integrations"
    ]);
    assert.equal(JSON.parse(requestBody).oauthClientSecret, secret);
    assert.doesNotMatch(output.join("\n"), new RegExp(secret));
    assert.doesNotMatch(output.join("\n"), new RegExp(token));
  });
});

test("Runtime SSH connection requests propagate the request organization without leaking the token", async () => {
  await withSession(async (sessionFile) => {
    const output: string[] = [];
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      printCommand: true
    }, {
      fetchImpl: async (url, init) => {
        assert.match(String(url), /\/api\/applications\/app\/runtime-ssh\/connection-requests$/u);
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers.authorization, `Liskov-Organization ${token}`);
        assert.equal(headers["x-liskov-organization"], "Exact-Runtime");
        return Response.json({
          ok: true,
          connection: {
            provider: "tailscale",
            attachmentId: "att_1",
            deploymentId: "dep_1",
            jobId: "job_1",
            expectedTailnet: "example.com",
            hostname: "runtime.example.com",
            user: "root",
            port: 22,
            command: ["tailscale", "ssh", "root@runtime.example.com"]
          }
        });
      },
      organization: " Exact-Runtime ",
      runProcess: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ CurrentTailnet: { Name: "example.com" } }),
        stderr: ""
      }),
      stdout: (line) => output.push(line)
    });
    assert.equal(code, 0);
    assert.deepEqual(output, ["tailscale ssh root@runtime.example.com"]);
    assert.doesNotMatch(output.join("\n"), new RegExp(token));
  });
});

test("tailnet mismatch is actionable and never switches accounts", async () => {
  await withSession(async (sessionFile) => {
    const calls: Array<{ executable: string; args: readonly string[]; mode: string }> = [];
    const errors: string[] = [];
    const runner: RuntimeSshProcessRunner = async (executable, args, mode) => {
      calls.push({ executable, args, mode });
      return {
        exitCode: 0,
        stdout: JSON.stringify({ CurrentTailnet: { Name: "wrong.example" } }),
        stderr: ""
      };
    };
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile
    }, {
      fetchImpl: connectionFetch,
      runProcess: runner,
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.deepEqual(calls, [{ executable: "tailscale", args: ["status", "--json"], mode: "capture" }]);
    assert.match(errors.join("\n"), /TAILSCALE_TAILNET_MISMATCH/u);
    assert.match(errors.join("\n"), /never switch accounts or tailnets automatically/u);
  });
});

test("print-command resolves and verifies without opening SSH", async () => {
  await withSession(async (sessionFile) => {
    const calls: Array<{ executable: string; args: readonly string[]; mode: string }> = [];
    const output: string[] = [];
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      printCommand: true
    }, {
      fetchImpl: connectionFetch,
      runProcess: async (executable, args, mode) => {
        calls.push({ executable, args, mode });
        return { exitCode: 0, stdout: JSON.stringify({ CurrentTailnet: { Name: "example.com" } }), stderr: "" };
      },
      stdout: (line) => output.push(line)
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [{ executable: "tailscale", args: ["status", "--json"], mode: "capture" }]);
    assert.deepEqual(output, ["tailscale ssh root@runtime.example.com"]);
  });
});

test("connect launches the server-validated Tailscale argument array", async () => {
  await withSession(async (sessionFile) => {
    const calls: Array<{ executable: string; args: readonly string[]; mode: string }> = [];
    const code = await runRuntimeSshConnection({ applicationRef: "app", config: sessionFile }, {
      fetchImpl: connectionFetch,
      runProcess: async (executable, args, mode) => {
        calls.push({ executable, args, mode });
        if (mode === "capture") {
          return { exitCode: 0, stdout: JSON.stringify({ CurrentTailnet: { Name: "example.com" } }), stderr: "" };
        }
        return { exitCode: 17, stdout: "", stderr: "" };
      }
    });
    assert.equal(code, 17);
    assert.deepEqual(calls, [
      { executable: "tailscale", args: ["status", "--json"], mode: "capture" },
      { executable: "tailscale", args: ["ssh", "root@runtime.example.com"], mode: "inherit" }
    ]);
  });
});

function ed25519PublicKey(byte: number): string {
  const algorithm = Buffer.from("ssh-ed25519", "ascii");
  const blob = Buffer.alloc(4 + algorithm.length + 4 + 32);
  blob.writeUInt32BE(algorithm.length, 0);
  algorithm.copy(blob, 4);
  blob.writeUInt32BE(32, 4 + algorithm.length);
  blob.fill(byte, 4 + algorithm.length + 4);
  return `ssh-ed25519 ${blob.toString("base64")}`;
}

function fingerprint(publicKey: string): string {
  const blob = Buffer.from(publicKey.split(" ")[1], "base64");
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/u, "")}`;
}

function managedConnection(identityKey: string, hostKey: string) {
  return {
    provider: "liskov",
    attachmentId: "att_1234567890abcdef",
    applicationId: "diagnostic",
    applicationUid: "app_1",
    liskovDeploymentId: "ldep_1",
    deploymentId: "provider_dep_1",
    liskovJobId: "ljob_1",
    jobId: "provider_job_1",
    user: "root",
    port: 22,
    authorizedKeyFingerprints: [fingerprint(identityKey)],
    host: {
      publicKey: hostKey,
      fingerprint: fingerprint(hostKey),
      signedEvidence: "header.claims.signature"
    },
    trust: {
      claim: "Liskov-supplied runtime-contact and Dropbear binaries were digest verified; the customer runtime image is not attested",
      runtimeContactSha256: "1".repeat(64),
      dropbearVersion: "2026.94",
      dropbearSha256: "2".repeat(64),
      dropbearkeySha256: "3".repeat(64)
    }
  } as const;
}

test("managed access pins host trust, mints one ticket, launches strict OpenSSH, and erases the ticket", async () => {
  await withSession(async (sessionFile) => {
    const identity = path.join(path.dirname(sessionFile), "customer-identity");
    const identityKey = ed25519PublicKey(7);
    const hostKey = ed25519PublicKey(9);
    await writeFile(`${identity}.pub`, `${identityKey} customer-comment\n`, { mode: 0o644 });
    const connection = managedConnection(identityKey, hostKey);
    const ticketSecret = "ticket.header.signature-that-must-not-be-printed";
    const output: string[] = [];
    const calls: Array<{ executable: string; args: readonly string[]; mode: string }> = [];
    let requests = 0;
    let observedTicketFile = "";
    const code = await runRuntimeSshConnection({
      acceptHostKey: true,
      applicationRef: "app",
      cliBin: "proof",
      config: sessionFile,
      identity
    }, {
      fetchImpl: async (url, init) => {
        requests += 1;
        if (String(url).endsWith("/connection-requests")) {
          return Response.json({ ok: true, connection });
        }
        assert.match(String(url), /\/runtime-ssh\/attachments\/att_1234567890abcdef\/tickets$/u);
        assert.deepEqual(JSON.parse(String(init?.body)), {
          selectedPublicKey: identityKey,
          confirmedHostFingerprint: fingerprint(hostKey)
        });
        return Response.json({
          ok: true,
          ticket: {
            gatewayUrl: "wss://gateway.example",
            tunnelId: "tun_1234567890abcdef",
            protocol: "liskov-access.v1",
            bearerToken: ticketSecret,
            expiresAtMs: Date.now() + 60_000,
            limits: {
              maxFrameBytes: 65_536,
              maxBytesPerDirection: 1_073_741_824,
              maxDurationMs: 7_200_000
            }
          }
        });
      },
      runProcess: async (executable, args, mode) => {
        calls.push({ executable, args, mode });
        assert.equal(executable, "ssh");
        assert.equal(mode, "inherit");
        assert.deepEqual(args.slice(0, 16), [
          "-i", identity,
          "-o", "IdentitiesOnly=yes",
          "-o", "StrictHostKeyChecking=yes",
          "-o", `UserKnownHostsFile=${path.join(path.dirname(sessionFile), "runtime-ssh-known-hosts")}`,
          "-o", "GlobalKnownHostsFile=/dev/null",
          "-o", "HostKeyAlias=liskov-runtime-ssh-att_1234567890abcdef",
          "-o", "ClearAllForwardings=yes",
          "-o", "ForwardAgent=no"
        ]);
        const proxy = args.find((arg) => arg.startsWith("ProxyCommand="));
        assert.ok(proxy);
        assert.doesNotMatch(proxy, new RegExp(ticketSecret));
        const tokenPath = proxy.match(/'--token-file' '([^']+)'/u)?.[1];
        assert.ok(tokenPath);
        observedTicketFile = tokenPath;
        assert.equal(await readFile(tokenPath, "utf8"), ticketSecret);
        assert.equal((await lstat(tokenPath)).mode & 0o777, 0o600);
        return { exitCode: 23, stdout: "", stderr: "" };
      },
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line)
    });
    assert.equal(code, 23);
    assert.equal(requests, 2);
    assert.equal(calls.length, 1);
    await assert.rejects(lstat(observedTicketFile), { code: "ENOENT" });
    const knownHosts = path.join(path.dirname(sessionFile), "runtime-ssh-known-hosts");
    assert.equal((await lstat(knownHosts)).mode & 0o777, 0o600);
    assert.equal(await readFile(knownHosts, "utf8"), `liskov-runtime-ssh-att_1234567890abcdef ${hostKey}\n`);
    assert.doesNotMatch(output.join("\n"), new RegExp(ticketSecret));
    assert.match(output.join("\n"), /application: diagnostic \(app_1\)/u);
  });
});

test("managed print-command is redacted and never mints a ticket", async () => {
  await withSession(async (sessionFile) => {
    const identity = path.join(path.dirname(sessionFile), "customer-identity");
    const identityKey = ed25519PublicKey(7);
    await writeFile(`${identity}.pub`, identityKey, { mode: 0o644 });
    let requests = 0;
    const output: string[] = [];
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      identity,
      printCommand: true
    }, {
      fetchImpl: async () => {
        requests += 1;
        return Response.json({ ok: true, connection: managedConnection(identityKey, ed25519PublicKey(9)) });
      },
      runProcess: async () => {
        throw new Error("no subprocess expected");
      },
      stdout: (line) => output.push(line)
    });
    assert.equal(code, 0);
    assert.equal(requests, 1);
    assert.match(output[0], /one-time ticket not minted/u);
  });
});

test("managed access fails closed on a substituted pinned host key before ticket issuance", async () => {
  await withSession(async (sessionFile) => {
    const identity = path.join(path.dirname(sessionFile), "customer-identity");
    const identityKey = ed25519PublicKey(7);
    await writeFile(`${identity}.pub`, identityKey, { mode: 0o644 });
    await writeFile(
      path.join(path.dirname(sessionFile), "runtime-ssh-known-hosts"),
      `liskov-runtime-ssh-att_1234567890abcdef ${ed25519PublicKey(8)}\n`,
      { mode: 0o600 }
    );
    let requests = 0;
    const errors: string[] = [];
    const code = await runRuntimeSshConnection({ applicationRef: "app", config: sessionFile, identity }, {
      fetchImpl: async () => {
        requests += 1;
        return Response.json({ ok: true, connection: managedConnection(identityKey, ed25519PublicKey(9)) });
      },
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.equal(requests, 1);
    assert.match(errors.join("\n"), /RUNTIME_SSH_HOST_KEY_MISMATCH/u);
  });
});

async function connectionFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  assert.match(String(url), /\/api\/applications\/app\/runtime-ssh\/connection-requests$/u);
  assert.equal(init?.method, "POST");
  assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
  return Response.json({
    ok: true,
    connection: {
      provider: "tailscale",
      attachmentId: "att_1",
      deploymentId: "dep_1",
      jobId: "job_1",
      expectedTailnet: "example.com",
      hostname: "runtime.example.com",
      user: "root",
      port: 22,
      command: ["tailscale", "ssh", "root@runtime.example.com"]
    }
  });
}
