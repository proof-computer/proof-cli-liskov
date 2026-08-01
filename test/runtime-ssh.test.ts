import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    let requestBody = "";
    const code = await runRuntimeSshIntegrationCreate({
      organizationId: "org_1",
      name: "Production tailnet",
      tailnet: "example.com",
      tag: "tag:liskov-runtime",
      oauthClientId: "client-id",
      config: sessionFile
    }, {
      readSecret: async () => secret,
      stdout: (line) => output.push(line),
      stderr: (line) => output.push(line),
      fetchImpl: async (_url, init) => {
        requestBody = String(init?.body);
        assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
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
    assert.equal(JSON.parse(requestBody).oauthClientSecret, secret);
    assert.doesNotMatch(output.join("\n"), new RegExp(secret));
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
