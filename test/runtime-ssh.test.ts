import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import LiskovSsh from "../src/commands/liskov/ssh.js";
import {
  runRuntimeSshConnection,
  runRuntimeSshIntegrationCreate,
  runRuntimeSshOperatorKeyAdd,
  runRuntimeSshOperatorKeyList,
  runRuntimeSshOperatorKeyRemove,
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

test("a numeric --job selects the V5 job by its provider sequence on both spines", async () => {
  await withSession(async (sessionFile) => {
    // BKLG-20260830-mobh: a V5 job has no Liskov deployment row; the number
    // an execution surface shows is the provider job sequence, which the
    // attachment's provider deployment column carries on both spines. A
    // structured job id must still pass through untouched.
    let posted: Record<string, unknown> = {};
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      jobId: "155468",
      printCommand: true,
      json: true
    }, {
      fetchImpl: async (_url, init) => {
        posted = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return Response.json({
          ok: true,
          connection: {
            provider: "tailscale",
            attachmentId: "att_v5",
            deploymentId: "155468",
            jobId: "155468",
            expectedTailnet: "example.com",
            hostname: "runtime.example.com",
            user: "root",
            port: 22,
            command: ["tailscale", "ssh", "root@runtime.example.com"]
          }
        });
      },
      runProcess: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ CurrentTailnet: { Name: "example.com" } }),
        stderr: ""
      }),
      stdout: () => {}
    });
    assert.equal(code, 0);
    assert.equal(posted.deploymentId, "155468");
    assert.equal(posted.jobId, "155468");

    let structured: Record<string, unknown> = {};
    await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      jobId: "job_123",
      printCommand: true,
      json: true
    }, {
      fetchImpl: async (_url, init) => {
        structured = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return Response.json({ ok: false, error: "runtime_ssh_attachment_not_found" });
      },
      stdout: () => {},
      stderr: () => {}
    });
    assert.equal(structured.deploymentId, undefined);
    assert.equal(structured.jobId, "job_123");
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

const v5TrustClaim = "Liskov-supplied runtime-contact and Dropbear binaries were digest verified; the customer runtime image is not attested";

// V5 access.ssh attachment on the frozen connection-request wire: provider stays
// "liskov". Fingerprints are org-registry snapshots (1–8), not inline policy keys.
function v5ManagedConnection(identityKey: string, hostKey: string, overrides: Record<string, unknown> = {}) {
  const registryCompanion = ed25519PublicKey(13);
  return {
    provider: "liskov",
    attachmentId: "att_v5_aabbccddeeff0011",
    applicationId: "v5-app",
    applicationUid: "app_v5",
    liskovDeploymentId: "ldep_1",
    deploymentId: "provider_dep_1",
    liskovJobId: "ljob_1",
    jobId: "provider_job_1",
    user: "root",
    port: 22,
    authorizedKeyFingerprints: [fingerprint(identityKey), fingerprint(registryCompanion)],
    host: {
      publicKey: hostKey,
      fingerprint: fingerprint(hostKey),
      signedEvidence: "header.claims.signature"
    },
    trust: {
      claim: v5TrustClaim,
      runtimeContactSha256: "1".repeat(64),
      dropbearVersion: "2026.94",
      dropbearSha256: "2".repeat(64),
      dropbearkeySha256: "3".repeat(64)
    },
    ...overrides
  };
}

function v5Ticket(bearerToken: string, expiresAtMs = Date.now() + 60_000) {
  return {
    gatewayUrl: "wss://gateway.example/",
    tunnelId: "tun_v5_aabbccddeeff0011",
    protocol: "liskov-access.v1",
    bearerToken,
    expiresAtMs,
    limits: {
      maxFrameBytes: 65_536,
      maxBytesPerDirection: 1_073_741_824,
      maxDurationMs: 7_200_000
    }
  };
}

async function leftoverTicketDirs(sessionFile: string): Promise<string[]> {
  const names = await readdir(path.dirname(sessionFile));
  return names.filter((name) => name.startsWith(".runtime-ssh-ticket-"));
}

async function prepareV5Identity(sessionFile: string): Promise<{ identity: string; identityKey: string; hostKey: string }> {
  const identity = path.join(path.dirname(sessionFile), "customer-identity");
  const identityKey = ed25519PublicKey(7);
  const hostKey = ed25519PublicKey(9);
  await writeFile(`${identity}.pub`, `${identityKey} customer-comment\n`, { mode: 0o644 });
  return { identity, identityKey, hostKey };
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
        assert.deepEqual(args.slice(0, 18), [
          "-F", "/dev/null",
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

test("proof liskov ssh still exposes the exact-job flag surface", () => {
  for (const flag of ["job", "deployment", "identity", "accept-host-key", "print-command", "json"]) {
    assert.ok(LiskovSsh.flags[flag], flag);
  }
});

test("V5 managed ssh posts the exact job selector and consumes that attachment", async () => {
  const ticketSecret = "ticket.header.signature-that-must-not-be-printed";
  for (const selector of [
    { deploymentId: "ldep_1", jobId: "ljob_1" },
    { deploymentId: "provider_dep_1", jobId: "provider_job_1" }
  ]) {
    await withSession(async (sessionFile) => {
      const { identity, identityKey, hostKey } = await prepareV5Identity(sessionFile);
      const connection = v5ManagedConnection(identityKey, hostKey);
      const output: string[] = [];
      const calls: Array<{ executable: string; args: readonly string[]; mode: string }> = [];
      let connectionBody: unknown;
      const ticketUrls: string[] = [];
      let observedTicketFile = "";
      const code = await runRuntimeSshConnection({
        acceptHostKey: true,
        applicationRef: "app",
        cliBin: "proof",
        config: sessionFile,
        deploymentId: selector.deploymentId,
        identity,
        jobId: selector.jobId
      }, {
        fetchImpl: async (url, init) => {
          if (String(url).endsWith("/connection-requests")) {
            connectionBody = JSON.parse(String(init?.body));
            return Response.json({ ok: true, connection });
          }
          ticketUrls.push(String(url));
          assert.match(String(url), /\/runtime-ssh\/attachments\/att_v5_aabbccddeeff0011\/tickets$/u);
          return Response.json({ ok: true, ticket: v5Ticket(ticketSecret) });
        },
        runProcess: async (executable, args, mode) => {
          calls.push({ executable, args, mode });
          assert.equal(executable, "ssh");
          assert.equal(mode, "inherit");
          assert.ok(args.includes("StrictHostKeyChecking=yes"));
          assert.ok(args.includes("HostKeyAlias=liskov-runtime-ssh-att_v5_aabbccddeeff0011"));
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
      assert.deepEqual(connectionBody, { deploymentId: selector.deploymentId, jobId: selector.jobId });
      assert.equal(ticketUrls.length, 1);
      assert.equal(calls.length, 1);
      await assert.rejects(lstat(observedTicketFile), { code: "ENOENT" });
      assert.deepEqual(await leftoverTicketDirs(sessionFile), []);
      assert.doesNotMatch(output.join("\n"), new RegExp(ticketSecret));
      assert.doesNotMatch(output.join("\n"), new RegExp(token));
    });
  }
});

test("V5 managed ssh refuses a returned job that does not match --job and never mints", async () => {
  await withSession(async (sessionFile) => {
    const { identity, identityKey, hostKey } = await prepareV5Identity(sessionFile);
    let ticketPosts = 0;
    let spawned = 0;
    const errors: string[] = [];
    const code = await runRuntimeSshConnection({
      acceptHostKey: true,
      applicationRef: "app",
      config: sessionFile,
      identity,
      jobId: "ljob_1"
    }, {
      fetchImpl: async (url) => {
        if (String(url).endsWith("/connection-requests")) {
          return Response.json({
            ok: true,
            connection: v5ManagedConnection(identityKey, hostKey, {
              liskovJobId: "ljob_other",
              jobId: "provider_job_other"
            })
          });
        }
        ticketPosts += 1;
        throw new Error("ticket mint must not run for a job mismatch");
      },
      runProcess: async () => {
        spawned += 1;
        throw new Error("no subprocess expected");
      },
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.equal(ticketPosts, 0);
    assert.equal(spawned, 0);
    assert.deepEqual(await leftoverTicketDirs(sessionFile), []);
    assert.match(errors.join("\n"), /RUNTIME_SSH_JOB_MISMATCH/u);
  });
});

test("V5 managed ssh refuses a returned deployment that does not match --deployment and never mints", async () => {
  await withSession(async (sessionFile) => {
    const { identity, identityKey, hostKey } = await prepareV5Identity(sessionFile);
    let ticketPosts = 0;
    let spawned = 0;
    const errors: string[] = [];
    const code = await runRuntimeSshConnection({
      acceptHostKey: true,
      applicationRef: "app",
      config: sessionFile,
      deploymentId: "ldep_1",
      identity,
      jobId: "ljob_1"
    }, {
      fetchImpl: async (url) => {
        if (String(url).endsWith("/connection-requests")) {
          return Response.json({
            ok: true,
            connection: v5ManagedConnection(identityKey, hostKey, {
              liskovDeploymentId: "ldep_other",
              deploymentId: "provider_dep_other"
            })
          });
        }
        ticketPosts += 1;
        throw new Error("ticket mint must not run for a deployment mismatch");
      },
      runProcess: async () => {
        spawned += 1;
        throw new Error("no subprocess expected");
      },
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.equal(ticketPosts, 0);
    assert.equal(spawned, 0);
    assert.deepEqual(await leftoverTicketDirs(sessionFile), []);
    assert.match(errors.join("\n"), /RUNTIME_SSH_DEPLOYMENT_MISMATCH/u);
  });
});

test("V5 managed ssh refuses ambiguous attachments and names candidate job ids", async () => {
  const candidates = [
    { attachmentId: "att_a", deploymentId: "ldep_a", jobId: "job_a" },
    { attachmentId: "att_b", deploymentId: "ldep_b", jobId: "job_b" }
  ];
  const ambiguousBody = {
    ok: false,
    error: "runtime_ssh_attachment_ambiguous",
    candidates
  };

  await withSession(async (sessionFile) => {
    const { identity } = await prepareV5Identity(sessionFile);
    let ticketPosts = 0;
    let spawned = 0;
    const errors: string[] = [];
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      identity
    }, {
      fetchImpl: async (url) => {
        if (String(url).endsWith("/connection-requests")) {
          return Response.json(ambiguousBody, { status: 409 });
        }
        ticketPosts += 1;
        throw new Error("ticket mint must not run for an ambiguous attachment");
      },
      runProcess: async () => {
        spawned += 1;
        throw new Error("no subprocess expected");
      },
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.equal(ticketPosts, 0);
    assert.equal(spawned, 0);
    const human = errors.join("\n");
    assert.match(human, /runtime_ssh_attachment_ambiguous/u);
    assert.match(human, /job_a/u);
    assert.match(human, /job_b/u);
    assert.doesNotMatch(human, new RegExp(token));
  });

  await withSession(async (sessionFile) => {
    const output: string[] = [];
    let ticketPosts = 0;
    let spawned = 0;
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url) => {
        if (String(url).endsWith("/connection-requests")) {
          return Response.json(ambiguousBody, { status: 409 });
        }
        ticketPosts += 1;
        throw new Error("ticket mint must not run for an ambiguous attachment");
      },
      runProcess: async () => {
        spawned += 1;
        throw new Error("no subprocess expected");
      },
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line)
    });
    assert.equal(code, 1);
    assert.equal(ticketPosts, 0);
    assert.equal(spawned, 0);
    const parsed = JSON.parse(output.join("\n")) as { candidates?: unknown; error?: string };
    assert.equal(parsed.error, "runtime_ssh_attachment_ambiguous");
    assert.deepEqual(parsed.candidates, candidates);
    assert.doesNotMatch(output.join("\n"), new RegExp(token));
  });
});

test("V5 managed ssh first-use without a pin refuses and does not mint", async () => {
  await withSession(async (sessionFile) => {
    const { identity, identityKey, hostKey } = await prepareV5Identity(sessionFile);
    let requests = 0;
    let spawned = 0;
    const errors: string[] = [];
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      identity,
      json: true
    }, {
      fetchImpl: async (url) => {
        requests += 1;
        if (String(url).includes("/tickets")) throw new Error("ticket mint must not run without a host pin");
        return Response.json({ ok: true, connection: v5ManagedConnection(identityKey, hostKey) });
      },
      runProcess: async () => {
        spawned += 1;
        throw new Error("no subprocess expected");
      },
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.equal(requests, 1);
    assert.equal(spawned, 0);
    assert.match(errors.join("\n"), /RUNTIME_SSH_HOST_KEY_NOT_ACCEPTED/u);
    assert.deepEqual(await leftoverTicketDirs(sessionFile), []);
    await assert.rejects(lstat(path.join(path.dirname(sessionFile), "runtime-ssh-known-hosts")), { code: "ENOENT" });
  });

  await withSession(async (sessionFile) => {
    const { identity, identityKey, hostKey } = await prepareV5Identity(sessionFile);
    let requests = 0;
    let spawned = 0;
    const errors: string[] = [];
    const code = await runRuntimeSshConnection({
      applicationRef: "app",
      config: sessionFile,
      identity
    }, {
      confirmHostKey: async () => false,
      fetchImpl: async (url) => {
        requests += 1;
        if (String(url).includes("/tickets")) throw new Error("ticket mint must not run when host confirmation is declined");
        return Response.json({ ok: true, connection: v5ManagedConnection(identityKey, hostKey) });
      },
      runProcess: async () => {
        spawned += 1;
        throw new Error("no subprocess expected");
      },
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.equal(requests, 1);
    assert.equal(spawned, 0);
    assert.match(errors.join("\n"), /RUNTIME_SSH_HOST_KEY_NOT_ACCEPTED/u);
  });
});

test("V5 managed ssh refuses an expired ticket without spawning ssh or leaving a token file", async () => {
  await withSession(async (sessionFile) => {
    const { identity, identityKey, hostKey } = await prepareV5Identity(sessionFile);
    const expiredSecret = "expired-bearer-that-must-not-be-printed";
    const output: string[] = [];
    let spawned = 0;
    const code = await runRuntimeSshConnection({
      acceptHostKey: true,
      applicationRef: "app",
      config: sessionFile,
      identity,
      json: true
    }, {
      fetchImpl: async (url) => {
        if (String(url).endsWith("/connection-requests")) {
          return Response.json({ ok: true, connection: v5ManagedConnection(identityKey, hostKey) });
        }
        return Response.json({ ok: true, ticket: v5Ticket(expiredSecret, Date.now() - 1) });
      },
      runProcess: async () => {
        spawned += 1;
        throw new Error("no subprocess expected");
      },
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line)
    });
    assert.equal(code, 1);
    assert.equal(spawned, 0);
    assert.deepEqual(await leftoverTicketDirs(sessionFile), []);
    assert.doesNotMatch(output.join("\n"), new RegExp(expiredSecret));
    assert.doesNotMatch(output.join("\n"), /bearerToken/u);
  });
});

test("V5 managed ssh mint 409 never spawns ssh or leaks the ticket", async () => {
  const mintSecret = "mint-fail-bearer-that-must-not-be-printed";
  for (const error of ["runtime_ssh_host_fingerprint_mismatch", "runtime_ssh_attachment_not_ready"]) {
    for (const json of [false, true]) {
      await withSession(async (sessionFile) => {
        const { identity, identityKey, hostKey } = await prepareV5Identity(sessionFile);
        const output: string[] = [];
        let spawned = 0;
        const code = await runRuntimeSshConnection({
          acceptHostKey: true,
          applicationRef: "app",
          config: sessionFile,
          identity,
          json
        }, {
          fetchImpl: async (url) => {
            if (String(url).endsWith("/connection-requests")) {
              return Response.json({ ok: true, connection: v5ManagedConnection(identityKey, hostKey) });
            }
            return Response.json({
              ok: false,
              error,
              ticket: v5Ticket(mintSecret)
            }, { status: 409 });
          },
          runProcess: async () => {
            spawned += 1;
            throw new Error("no subprocess expected");
          },
          stdout: (line) => output.push(line),
          stderr: (line) => output.push(line)
        });
        assert.equal(code, 1);
        assert.equal(spawned, 0);
        assert.deepEqual(await leftoverTicketDirs(sessionFile), []);
        const text = output.join("\n");
        assert.match(text, new RegExp(error, "u"));
        assert.doesNotMatch(text, new RegExp(mintSecret));
        assert.doesNotMatch(text, /bearerToken/u);
      });
    }
  }
});

test("V5 managed ssh rejects provider liskov_managed as an invented connection-request word", async () => {
  await withSession(async (sessionFile) => {
    const { identity, identityKey, hostKey } = await prepareV5Identity(sessionFile);
    let ticketPosts = 0;
    let spawned = 0;
    const errors: string[] = [];
    const code = await runRuntimeSshConnection({
      acceptHostKey: true,
      applicationRef: "app",
      config: sessionFile,
      identity
    }, {
      fetchImpl: async (url) => {
        if (String(url).endsWith("/connection-requests")) {
          return Response.json({
            ok: true,
            connection: v5ManagedConnection(identityKey, hostKey, { provider: "liskov_managed" })
          });
        }
        ticketPosts += 1;
        throw new Error("ticket mint must not run for an invented provider word");
      },
      runProcess: async () => {
        spawned += 1;
        throw new Error("no subprocess expected");
      },
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.equal(ticketPosts, 0);
    assert.equal(spawned, 0);
    assert.match(errors.join("\n"), /RUNTIME_SSH_CONNECTION_INVALID/u);
  });
});

test("V5 managed ssh unauthorized identity names the attachment set, not only ingress.ssh", async () => {
  await withSession(async (sessionFile) => {
    const { identity, hostKey } = await prepareV5Identity(sessionFile);
    const errors: string[] = [];
    let ticketPosts = 0;
    const code = await runRuntimeSshConnection({
      acceptHostKey: true,
      applicationRef: "app",
      config: sessionFile,
      identity
    }, {
      fetchImpl: async (url) => {
        if (String(url).endsWith("/connection-requests")) {
          return Response.json({
            ok: true,
            connection: v5ManagedConnection(ed25519PublicKey(1), hostKey)
          });
        }
        ticketPosts += 1;
        throw new Error("ticket mint must not run for an unauthorized identity");
      },
      runProcess: async () => {
        throw new Error("no subprocess expected");
      },
      stderr: (line) => errors.push(line)
    });
    assert.equal(code, 1);
    assert.equal(ticketPosts, 0);
    const text = errors.join("\n");
    assert.match(text, /RUNTIME_SSH_IDENTITY_NOT_AUTHORIZED/u);
    assert.match(text, /not in this attachment's authorized set/u);
    assert.match(text, /proof liskov runtime-ssh operator-key add/u);
    assert.doesNotMatch(text, /add this key to the application policy's ingress\.ssh\.provider\.authorizedKeys/u);
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

const organizationListBody = {
  ok: true,
  organizations: [{ id: "org_1", name: "Organization One", slug: "organization-one", isPersonal: false, role: "owner" }]
};

function operatorKeyRow(publicKey: string) {
  return {
    keyId: "key_1",
    name: "patrick-mbp",
    publicKey,
    fingerprint: fingerprint(publicKey),
    addedBy: "principal-1",
    createdAtMs: 1_000
  };
}

test("operator-key add registers the public half of --identity and never prints the session token", async () => {
  await withSession(async (sessionFile) => {
    const publicKey = ed25519PublicKey(9);
    const output: string[] = [];
    const requestUrls: string[] = [];
    let requestBody = "";
    const code = await runRuntimeSshOperatorKeyAdd({
      organizationId: "organization-one",
      name: "patrick-mbp",
      identity: "/tmp/does-not-exist-id_ed25519",
      config: sessionFile
    }, {
      // No .pub companion on disk, so the ssh-keygen derivation path runs —
      // the same path `liskov ssh --identity` uses.
      runProcess: async (executable, args) => {
        assert.equal(executable, "ssh-keygen");
        assert.deepEqual([...args], ["-y", "-f", "/tmp/does-not-exist-id_ed25519"]);
        return { exitCode: 0, stdout: `${publicKey}\n`, stderr: "" };
      },
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
      fetchImpl: async (url, init) => {
        requestUrls.push(String(url));
        if (String(url).endsWith("/api/organizations")) return Response.json(organizationListBody);
        requestBody = String(init?.body);
        return Response.json({ ok: true, key: operatorKeyRow(publicKey) }, { status: 201 });
      }
    });
    assert.equal(code, 0);
    assert.deepEqual(requestUrls, [
      "https://liskov.test/api/organizations",
      "https://liskov.test/api/organizations/org_1/runtime-ssh/operator-keys"
    ]);
    const sent = JSON.parse(requestBody);
    assert.equal(sent.publicKey, publicKey);
    assert.equal(sent.name, "patrick-mbp");
    // Registering is not granting; the human path has to say so.
    assert.match(output.join("\n"), /does not grant access/u);
    assert.doesNotMatch(output.join("\n"), new RegExp(token));
  });
});

test("operator-key add accepts a public-key file and sends the identical body", async () => {
  await withSession(async (sessionFile) => {
    const publicKey = ed25519PublicKey(11);
    const keyFile = path.join(path.dirname(sessionFile), "operator.pub");
    await writeFile(keyFile, `${publicKey} patrick@laptop\n`);
    let requestBody = "";
    const code = await runRuntimeSshOperatorKeyAdd({
      organizationId: "organization-one",
      name: "patrick-mbp",
      publicKeyFile: keyFile,
      config: sessionFile
    }, {
      stdout: () => {},
      stderr: () => {},
      runProcess: async () => { throw new Error("no subprocess expected"); },
      fetchImpl: async (url, init) => {
        if (String(url).endsWith("/api/organizations")) return Response.json(organizationListBody);
        requestBody = String(init?.body);
        return Response.json({ ok: true, key: operatorKeyRow(publicKey) }, { status: 201 });
      }
    });
    assert.equal(code, 0);
    // The trailing comment is normalized away, so both input paths agree.
    assert.equal(JSON.parse(requestBody).publicKey, publicKey);
  });
});

test("operator-key add rejects a non-ed25519 key locally, before any request", async () => {
  await withSession(async (sessionFile) => {
    const keyFile = path.join(path.dirname(sessionFile), "rsa.pub");
    await writeFile(keyFile, "ssh-rsa AAAAB3NzaC1yc2E\n");
    const output: string[] = [];
    const code = await runRuntimeSshOperatorKeyAdd({
      organizationId: "organization-one",
      name: "bad",
      publicKeyFile: keyFile,
      config: sessionFile
    }, {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
      fetchImpl: async () => { throw new Error("no request expected for a malformed key"); }
    });
    assert.equal(code, 1);
    assert.match(output.join("\n"), /RUNTIME_SSH_OPERATOR_KEY_NOT_ED25519/u);
  });
});

test("operator-key add requires exactly one key source", async () => {
  await withSession(async (sessionFile) => {
    const noSource: string[] = [];
    assert.equal(await runRuntimeSshOperatorKeyAdd(
      { organizationId: "organization-one", name: "x", config: sessionFile },
      { stdout: (line) => noSource.push(line), stderr: (line) => noSource.push(line), fetchImpl: async () => { throw new Error("no request expected"); } }
    ), 1);
    assert.match(noSource.join("\n"), /RUNTIME_SSH_OPERATOR_KEY_SOURCE_REQUIRED/u);

    const bothSources: string[] = [];
    assert.equal(await runRuntimeSshOperatorKeyAdd(
      { organizationId: "organization-one", name: "x", identity: "/tmp/id", publicKeyFile: "/tmp/id.pub", config: sessionFile },
      { stdout: (line) => bothSources.push(line), stderr: (line) => bothSources.push(line), fetchImpl: async () => { throw new Error("no request expected"); } }
    ), 1);
    assert.match(bothSources.join("\n"), /RUNTIME_SSH_OPERATOR_KEY_SOURCE_CONFLICT/u);
  });
});

test("operator-key list renders one tab-separated row per key, and an empty state that points at the policy", async () => {
  await withSession(async (sessionFile) => {
    const publicKey = ed25519PublicKey(13);
    const rows: string[] = [];
    const listed = await runRuntimeSshOperatorKeyList({ organizationId: "organization-one", config: sessionFile }, {
      stdout: (line) => rows.push(line),
      stderr: (line) => rows.push(line),
      fetchImpl: async (url) => String(url).endsWith("/api/organizations")
        ? Response.json(organizationListBody)
        : Response.json({ ok: true, keys: [operatorKeyRow(publicKey)] })
    });
    assert.equal(listed, 0);
    assert.equal(rows.join("\n"), `key_1\tpatrick-mbp\t${fingerprint(publicKey)}\tprincipal-1\t1000`);

    const empty: string[] = [];
    const emptyCode = await runRuntimeSshOperatorKeyList({ organizationId: "organization-one", config: sessionFile }, {
      stdout: (line) => empty.push(line),
      stderr: (line) => empty.push(line),
      fetchImpl: async (url) => String(url).endsWith("/api/organizations")
        ? Response.json(organizationListBody)
        : Response.json({ ok: true, keys: [] })
    });
    assert.equal(emptyCode, 0);
    assert.match(empty.join("\n"), /list it in an application policy/u);
  });
});

test("operator-key remove surfaces the server's non-revocation note on both output paths", async () => {
  await withSession(async (sessionFile) => {
    const publicKey = ed25519PublicKey(17);
    const note = "Removal does not revoke access on deployed policies; update each policy's authorizedKeys and redeploy to do that.";
    const removal = async (json: boolean, sink: string[]) => runRuntimeSshOperatorKeyRemove(
      { organizationId: "organization-one", keyId: "key_1", json, config: sessionFile },
      {
        stdout: (line) => sink.push(line),
        stderr: (line) => sink.push(line),
        fetchImpl: async (url, init) => {
          if (String(url).endsWith("/api/organizations")) return Response.json(organizationListBody);
          assert.equal(init?.method, "DELETE");
          assert.equal(String(url), "https://liskov.test/api/organizations/org_1/runtime-ssh/operator-keys/key_1");
          return Response.json({ ok: true, removed: operatorKeyRow(publicKey), note });
        }
      }
    );

    const human: string[] = [];
    assert.equal(await removal(false, human), 0);
    assert.match(human.join("\n"), /removed from the registry/u);
    assert.match(human.join("\n"), /does not revoke/u);

    const machine: string[] = [];
    assert.equal(await removal(true, machine), 0);
    assert.equal(JSON.parse(machine.join("\n")).note, note);
    assert.doesNotMatch(machine.join("\n"), new RegExp(token));
  });
});

test("operator-key remove requires a key id", async () => {
  await withSession(async (sessionFile) => {
    const output: string[] = [];
    const code = await runRuntimeSshOperatorKeyRemove({ organizationId: "organization-one", config: sessionFile }, {
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
      fetchImpl: async () => { throw new Error("no request expected"); }
    });
    assert.equal(code, 1);
    assert.match(output.join("\n"), /RUNTIME_SSH_OPERATOR_KEY_ID_REQUIRED/u);
  });
});
