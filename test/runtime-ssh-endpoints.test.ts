import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runRuntimeSshAttachmentEndpoints } from "../src/runtime-ssh.js";

const token = "session-token-that-must-not-be-printed";

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

/** The owner's vector, copied byte for byte from `liskov-rs`
 *  `crates/liskov-control-plane-api/vectors/runtime_ssh_attachment_endpoints.json`:
 *  the bodies below are what the server sends, not what this side expects. */
const vector = async (): Promise<{ everyState: Record<string, unknown>; noEndpoints: Record<string, unknown> }> =>
  JSON.parse(await readFile(new URL("./fixtures/runtime_ssh_attachment_endpoints.json", import.meta.url), "utf8"));

async function readEndpoints(
  sessionFile: string,
  input: { applicationRef?: string; attachmentId?: string; json?: boolean },
  respond: () => Response
): Promise<{ code: number; stdout: string[]; stderr: string[]; requested: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const requested: string[] = [];
  const code = await runRuntimeSshAttachmentEndpoints(
    { applicationRef: input.applicationRef ?? "my-app", attachmentId: input.attachmentId, json: input.json, config: sessionFile },
    {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, "GET");
        requested.push(String(url));
        return respond();
      }
    }
  );
  return { code, stdout, stderr, requested };
}

test("attachment endpoints prints every observed state and never calls a published endpoint ready", async () => {
  const { everyState } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readEndpoints(
      sessionFile,
      { applicationRef: "my app/1", attachmentId: "att-endpoint/x" },
      () => Response.json(everyState)
    );
    assert.equal(out.code, 0);
    // Application-scoped, both segments encoded, as the ticket request is.
    assert.deepEqual(out.requested, [
      "https://liskov.test/api/applications/my%20app%2F1/runtime-ssh/attachments/att-endpoint%2Fx/endpoints"
    ]);
    const lines = out.stdout.join("\n").split("\n");
    const address = "liskov-prt-e22e799c1638.tail3b99c3.ts.net";
    assert.deepEqual(lines.slice(0, 5), [
      `/ingress/0/network/services/0/provider\tclickhouse\t8123\tready\t${address}\t-`,
      `/ingress/0/network/services/1/provider\tnative\t9000\tdegraded\t${address}\taccess_probe_failed`,
      `/ingress/0/network/services/2/provider\tmetrics\t9363\tpublished\t${address}\t-`,
      "/ingress/0/network/services/3/provider\tadmin\t8443\tpending\t-\t-",
      `/ingress/0/network/services/4/provider\treplica\t9009\twithdrawn\t${address}\t-`
    ]);
    // An address is not readiness: the published row says published, and the
    // line under the rows says it has not been observed ready.
    assert.doesNotMatch(lines[2]!, /\bready\b/u);
    assert.equal(lines[5], "A published endpoint has its address assigned but has not been observed ready yet.");
    assert.equal(lines.length, 6);
    assert.deepEqual(out.stderr, []);
  });
});

test("attachment endpoints --json prints the server's body unchanged", async () => {
  const { everyState } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readEndpoints(sessionFile, { attachmentId: "att-endpoint", json: true }, () => Response.json(everyState));
    assert.equal(out.code, 0);
    assert.deepEqual(JSON.parse(out.stdout.join("\n")), everyState);
  });
});

test("attachment endpoints says so when the attachment publishes nothing", async () => {
  const { noEndpoints } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readEndpoints(sessionFile, { attachmentId: "att-ssh-only" }, () => Response.json(noEndpoints));
    assert.equal(out.code, 0);
    assert.deepEqual(out.stdout, ["No private endpoints on this attachment."]);
  });
});

test("attachment endpoints reports an unknown attachment with the server's code", async () => {
  await withSession(async (sessionFile) => {
    const out = await readEndpoints(
      sessionFile,
      { attachmentId: "att-foreign" },
      () => Response.json({ ok: false, error: "runtime_ssh_attachment_not_found" }, { status: 404 })
    );
    assert.equal(out.code, 1);
    assert.deepEqual(out.stdout, []);
    assert.match(out.stderr.join("\n"), /runtime_ssh_attachment_not_found/u);
  });
});

test("attachment endpoints refuses locally without an attachment id", async () => {
  await withSession(async (sessionFile) => {
    const out = await readEndpoints(sessionFile, { attachmentId: "  " }, () => {
      throw new Error("no request should be made");
    });
    assert.equal(out.code, 1);
    // A missing id is a local mistake; it must not cost a round trip.
    assert.deepEqual(out.requested, []);
    assert.match(out.stderr.join("\n"), /RUNTIME_SSH_ATTACHMENT_ID_REQUIRED/u);
  });
});

test("attachment endpoints never prints the session token", async () => {
  const { everyState, noEndpoints } = await vector();
  await withSession(async (sessionFile) => {
    const runs = [
      await readEndpoints(sessionFile, { attachmentId: "att-endpoint" }, () => Response.json(everyState)),
      await readEndpoints(sessionFile, { attachmentId: "att-endpoint", json: true }, () => Response.json(everyState)),
      await readEndpoints(sessionFile, { attachmentId: "att-ssh-only" }, () => Response.json(noEndpoints)),
      await readEndpoints(
        sessionFile,
        { attachmentId: "att-foreign", json: true },
        () => Response.json({ ok: false, error: "runtime_ssh_attachment_not_found" }, { status: 404 })
      ),
      await readEndpoints(sessionFile, {}, () => Response.json(everyState))
    ];
    for (const run of runs) {
      for (const line of [...run.stdout, ...run.stderr]) {
        assert.doesNotMatch(line, new RegExp(token));
      }
    }
  });
});
