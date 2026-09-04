import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  runSlipwayApplicationSourceBindingRevoke,
  runSlipwayApplicationSourceBindingSet,
  runSlipwayApplicationSourceBindingShow,
  saveSlipwaySession
} from "../src/session.js";

const token = "source_binding_session_token_do_not_print";
const createdBinding = {
  binding: {
    organizationId: "org-1",
    applicationUid: "app-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    revision: 1,
    repository: "proof-computer/proof-docs",
    allowedRefs: ["refs/heads/main"],
    workflowIdentity: "proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main",
    manifestPath: ".liskov/proof-docs-v5.json",
    revocationEpoch: 0
  },
  revoked: false,
  operation: "created",
  actor: { login: "admin", principalId: "principal-admin" },
  reason: "initial authority",
  createdAtMs: 10_000
};

describe("application source-binding", () => {
  it("creates a binding with PUT and omits expectedRevision", async () => {
    const sessionFile = await sessionPath();
    const requests: Array<{ authorization?: string; body: unknown; method?: string; url: string }> = [];
    const out = writer();
    const code = await runSlipwayApplicationSourceBindingSet({
      allowedRefs: ["refs/heads/main"],
      applicationRef: "proof-docs",
      config: sessionFile,
      json: true,
      manifestPath: ".liskov/proof-docs-v5.json",
      reason: "initial authority",
      repository: "proof-computer/proof-docs",
      workflowIdentity: "proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main",
      yes: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body)),
          method: init?.method,
          url: String(url)
        });
        return jsonResponse({ ok: true, sourceBinding: createdBinding });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      authorization: `Bearer ${token}`,
      body: {
        binding: {
          repository: "proof-computer/proof-docs",
          allowedRefs: ["refs/heads/main"],
          workflowIdentity: "proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main",
          manifestPath: ".liskov/proof-docs-v5.json"
        },
        reason: "initial authority"
      },
      method: "PUT",
      url: "https://slipway.test/api/applications/proof-docs/source-binding"
    }]);
    assert.equal(Object.hasOwn(requests[0]!.body as object, "expectedRevision"), false);
    assert.equal(out.text.includes(token), false);
    const output = JSON.parse(out.text) as { ok: boolean; sourceBinding: { operation: string } };
    assert.equal(output.ok, true);
    assert.equal(output.sourceBinding.operation, "created");
  });

  it("sends expectedRevision on rotate, including an explicit 0", async () => {
    const sessionFile = await sessionPath();
    const bodies: unknown[] = [];
    const rotate = {
      ...createdBinding,
      operation: "rotated",
      binding: { ...createdBinding.binding, revision: 2, allowedRefs: ["refs/heads/release"] }
    };
    const out = writer();

    assert.equal(await runSlipwayApplicationSourceBindingSet({
      ...setBase(),
      config: sessionFile,
      expectedRevision: 1,
      json: true,
      yes: true
    }, {
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ok: true, sourceBinding: rotate });
      },
      stdout: out.write
    }), 0);
    assert.equal(await runSlipwayApplicationSourceBindingSet({
      ...setBase(),
      config: sessionFile,
      expectedRevision: 0,
      json: true,
      yes: true
    }, {
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({
          ok: false,
          error: "source_binding_revision_conflict",
          reason: "source binding does not exist at the expected revision"
        }, 409);
      },
      stdout: out.write
    }), 1);

    assert.equal((bodies[0] as { expectedRevision: number }).expectedRevision, 1);
    assert.equal((bodies[1] as { expectedRevision: number }).expectedRevision, 0);
    const conflict = JSON.parse(out.text.trim().split("\n")[1]!) as { error: string };
    assert.equal(conflict.error, "SLIPWAY_APPLICATION_SOURCE_BINDING_REVISION_CONFLICT");
  });

  it("refuses set and revoke without confirmation before network I/O", async () => {
    const out = writer();
    const options = {
      fetchImpl: async () => {
        throw new Error("network should not be called");
      },
      stdout: out.write
    };

    assert.equal(await runSlipwayApplicationSourceBindingSet({
      ...setBase(),
      json: true
    }, options), 1);
    assert.equal(await runSlipwayApplicationSourceBindingRevoke({
      applicationRef: "proof-docs",
      expectedRevision: 1,
      json: true,
      reason: "credential exposure"
    }, options), 1);

    const outputs = out.text.trim().split("\n").map((line) => JSON.parse(line) as { error: string });
    assert.equal(outputs[0]?.error, "SLIPWAY_APPLICATION_SOURCE_BINDING_SET_CONFIRMATION_REQUIRED");
    assert.equal(outputs[1]?.error, "SLIPWAY_APPLICATION_SOURCE_BINDING_REVOKE_CONFIRMATION_REQUIRED");
  });

  it("reads the current binding and reports an unbound application as not bound yet", async () => {
    const sessionFile = await sessionPath();
    const requests: Array<{ method?: string; url: string }> = [];
    const out = writer();

    assert.equal(await runSlipwayApplicationSourceBindingShow({
      applicationRef: "proof-docs",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({ method: init?.method ?? "GET", url: String(url) });
        return jsonResponse({ ok: true, sourceBinding: createdBinding });
      },
      stdout: out.write
    }), 0);
    assert.equal(await runSlipwayApplicationSourceBindingShow({
      applicationRef: "proof-docs",
      config: sessionFile,
      json: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({ method: init?.method ?? "GET", url: String(url) });
        return jsonResponse({ ok: false, error: "source_binding_not_found" }, 404);
      },
      stdout: out.write
    }), 1);

    assert.deepEqual(requests, [
      { method: "GET", url: "https://slipway.test/api/applications/proof-docs/source-binding" },
      { method: "GET", url: "https://slipway.test/api/applications/proof-docs/source-binding" }
    ]);
    const lines = out.text.trim().split("\n").map((line) => JSON.parse(line) as {
      error?: string;
      ok: boolean;
      sourceBinding?: { operation: string };
    });
    assert.equal(lines[0]?.ok, true);
    assert.equal(lines[0]?.sourceBinding?.operation, "created");
    assert.equal(lines[1]?.ok, false);
    assert.equal(lines[1]?.error, "SLIPWAY_APPLICATION_SOURCE_BINDING_NOT_FOUND");
    assert.match(out.text, /not bound yet/);
    assert.equal(out.text.includes(token), false);
  });

  it("revokes with DELETE, expectedRevision, reason, and --yes", async () => {
    const sessionFile = await sessionPath();
    const requests: Array<{ body: unknown; method?: string; url: string }> = [];
    const out = writer();
    const revoked = {
      ...createdBinding,
      operation: "revoked",
      revoked: true,
      binding: { ...createdBinding.binding, revision: 2, revocationEpoch: 1 }
    };
    const code = await runSlipwayApplicationSourceBindingRevoke({
      applicationRef: "proof-docs",
      config: sessionFile,
      expectedRevision: 1,
      json: true,
      reason: "credential exposure",
      yes: true
    }, {
      fetchImpl: async (url, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          method: init?.method,
          url: String(url)
        });
        return jsonResponse({ ok: true, sourceBinding: revoked });
      },
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [{
      body: { expectedRevision: 1, reason: "credential exposure" },
      method: "DELETE",
      url: "https://slipway.test/api/applications/proof-docs/source-binding"
    }]);
    const output = JSON.parse(out.text) as { sourceBinding: { operation: string; revoked: boolean } };
    assert.equal(output.sourceBinding.operation, "revoked");
    assert.equal(output.sourceBinding.revoked, true);
  });

  it("refuses an empty revoke reason locally", async () => {
    const out = writer();
    assert.equal(await runSlipwayApplicationSourceBindingRevoke({
      applicationRef: "proof-docs",
      expectedRevision: 1,
      json: true,
      reason: "   ",
      yes: true
    }, {
      fetchImpl: async () => {
        throw new Error("network should not be called");
      },
      stdout: out.write
    }), 1);
    assert.equal(JSON.parse(out.text).error, "SLIPWAY_APPLICATION_SOURCE_BINDING_REVOKE_INVALID");
  });

  it("wording maps admin, repository, revision-conflict, and revoked refusals", async () => {
    const sessionFile = await sessionPath();
    const out = writer();
    const cases: Array<{ body: unknown; status: number; error: string; human: RegExp }> = [
      {
        body: {
          ok: false,
          error: "forbidden",
          reasonCode: "organization_admin_required",
          capability: "application.source_binding.manage"
        },
        status: 403,
        error: "SLIPWAY_APPLICATION_SOURCE_BINDING_ADMIN_REQUIRED",
        human: /organization admin with application\.source_binding\.manage/
      },
      {
        body: {
          ok: false,
          error: "forbidden",
          reasonCode: "capability_not_granted",
          capability: "application.source_binding.manage"
        },
        status: 403,
        error: "SLIPWAY_APPLICATION_SOURCE_BINDING_ADMIN_REQUIRED",
        human: /maintainer or an application-scoped grant cannot retarget source/
      },
      {
        body: {
          ok: false,
          error: "forbidden",
          reasonCode: "github_repository_required",
          capability: "application.source_binding.manage"
        },
        status: 403,
        error: "SLIPWAY_APPLICATION_SOURCE_BINDING_REPOSITORY_REQUIRED",
        human: /create the Application with --repository first/
      },
      {
        body: { ok: false, error: "source_binding_revision_conflict" },
        status: 409,
        error: "SLIPWAY_APPLICATION_SOURCE_BINDING_REVISION_CONFLICT",
        human: /source-binding show/
      },
      {
        body: { ok: false, error: "source_binding_revoked" },
        status: 409,
        error: "SLIPWAY_APPLICATION_SOURCE_BINDING_REVOKED",
        human: /revocation epoch moved/
      }
    ];

    for (const trial of cases) {
      const trialOut = writer();
      assert.equal(await runSlipwayApplicationSourceBindingSet({
        ...setBase(),
        config: sessionFile,
        json: true,
        yes: true
      }, {
        fetchImpl: async () => jsonResponse(trial.body, trial.status),
        stdout: trialOut.write
      }), 1);
      const parsed = JSON.parse(trialOut.text) as { error: string };
      assert.equal(parsed.error, trial.error);
      assert.match(trialOut.text, trial.human);
      out.write(trialOut.text.trim());
    }
    assert.equal(out.text.includes(token), false);
  });

  it("does not call the V4 publish routes", async () => {
    const sessionFile = await sessionPath();
    const urls: string[] = [];
    await runSlipwayApplicationSourceBindingSet({
      ...setBase(),
      config: sessionFile,
      json: true,
      yes: true
    }, {
      fetchImpl: async (url) => {
        urls.push(String(url));
        return jsonResponse({ ok: true, sourceBinding: createdBinding });
      },
      stdout: writer().write
    });
    assert.equal(urls.some((url) => url.includes("/publish")), false);
    assert.equal(urls[0]?.endsWith("/source-binding"), true);
  });
});

function setBase(): {
  allowedRefs: string[];
  applicationRef: string;
  manifestPath: string;
  repository: string;
  workflowIdentity: string;
} {
  return {
    allowedRefs: ["refs/heads/main"],
    applicationRef: "proof-docs",
    manifestPath: ".liskov/proof-docs-v5.json",
    repository: "proof-computer/proof-docs",
    workflowIdentity: "proof-computer/proof-docs/.github/workflows/release.yml@refs/heads/main"
  };
}

async function sessionPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "proof-liskov-source-binding-"));
  const sessionFile = path.join(dir, "session.json");
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://slipway.test",
    sessionToken: token,
    savedAtMs: 0
  }, { config: sessionFile });
  return sessionFile;
}

function writer(): { text: string; write: (line: string) => void } {
  const output = {
    text: "",
    write(line: string): void {
      output.text += `${line}\n`;
    }
  };
  return output;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
