import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runSlipwayCustodyEnvironmentUpload, saveSlipwaySession } from "../src/index.js";

// The plaintext audit checks every declared variable with a non-empty value.
// It once exempted eight expanded `PROOF_LOCKBOX_*` job names whose values
// also appear in the handoff's own metadata; nothing declares them any more,
// so a name in that family is held to the same rule as any other (BKLG-20261002-4f44).
describe("environment handoff plaintext audit", () => {
  it("refuses a handoff that carries a PROOF_LOCKBOX_* value in plaintext", async () => {
    const variable = { name: "PROOF_LOCKBOX_APPLICATION_ID", source: "secret", required: true };
    const fixture = await uploadFixture(`${variable.name}=alpha\n`);
    const requests: string[] = [];
    const out = writer();

    const code = await runSlipwayCustodyEnvironmentUpload(fixture.input, {
      environmentHandoffBuilder: async (input: { variables: Array<{ key: string; value: string }> }) => {
        assert.deepEqual(input.variables, [{ key: variable.name, value: "alpha" }]);
        return encryptedHandoff() as never;
      },
      fetchImpl: planFetch([variable], requests),
      stdout: out.write
    });

    assert.equal(code, 1);
    const parsed = JSON.parse(out.text) as { ok: boolean; error: string; message: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "SLIPWAY_CUSTODY_ENVIRONMENT_HANDOFF_FAILED");
    assert.match(parsed.message, /PROOF_LOCKBOX_APPLICATION_ID/);
    assert.equal(requests.some((request) => request.endsWith("/environment-handoffs")), false);
  });

  it("uploads a handoff that does not carry the declared value", async () => {
    const variable = { name: "SECRET_VALUE", source: "secret", required: true };
    const secretValue = "local-secret-value-do-not-print";
    const fixture = await uploadFixture(`${variable.name}=${secretValue}\n`);
    const requests: string[] = [];
    const out = writer();

    const code = await runSlipwayCustodyEnvironmentUpload(fixture.input, {
      environmentHandoffBuilder: async () => encryptedHandoff() as never,
      fetchImpl: planFetch([variable], requests),
      stdout: out.write
    });

    assert.equal(code, 0);
    assert.deepEqual(requests, [
      "GET /api/applications/alpha/action-plan",
      "GET /api/applications/alpha",
      "POST /api/applications/alpha/live-custody/environment-handoffs"
    ]);
    assert.equal(out.text.includes(secretValue), false);
  });
});

async function uploadFixture(secrets: string): Promise<{
  input: { applicationRef: string; secretsFile: string; config: string; json: boolean; yes: boolean };
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "proof-slipway-handoff-plaintext-"));
  const sessionFile = path.join(dir, "session.json");
  const secretsFile = path.join(dir, ".env");
  await writeFile(secretsFile, secrets, "utf8");
  await saveSlipwaySession({
    version: 1,
    slipwayUrl: "https://slipway.test",
    sessionToken: "slipway_handoff_plaintext_token_do_not_print",
    savedAtMs: 0
  }, { config: sessionFile });
  return { input: { applicationRef: "alpha", secretsFile, config: sessionFile, json: true, yes: true } };
}

function planFetch(
  variables: Array<{ name: string; source: string; required: boolean }>,
  requests: string[]
): (url: URL | RequestInfo, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    requests.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
    if (String(url).endsWith("/api/applications/alpha/action-plan")) {
      return jsonResponse({ ok: true, items: [setEnvironmentPlanItem(variables)] });
    }
    if (String(url).endsWith("/api/applications/alpha")) {
      return jsonResponse({
        ok: true,
        application: { applicationId: "alpha", status: "active" },
        activePolicy: { policyDigest: "policy-digest-1", environment: { variables } }
      });
    }
    return jsonResponse({ ok: true, handoff: { handoffKey: "handoff-1" } });
  };
}

function setEnvironmentPlanItem(
  variables: Array<{ name: string; source: string; required: boolean }>
): Record<string, unknown> {
  const origin = { acurast: "5origin" };
  return {
    planItemId: "set-env-1",
    kind: "acurast.setEnvironment",
    applicationId: "alpha",
    policyDigest: "policy-digest-1",
    callSummary: {
      applicationId: "alpha",
      serviceId: "web",
      role: "web",
      policyDigest: "policy-digest-1",
      childSessionId: "child-1",
      jobId: "job-1",
      deploymentId: "deployment-1",
      acurastJobRef: {
        origin,
        sequence: 1,
        canonicalJobId: JSON.stringify([origin, 1])
      },
      expectedProcessors: ["processor-1"],
      envNames: variables.map((variable) => variable.name),
      variables
    }
  };
}

// Its metadata names the application in plaintext: `applicationId: "alpha"`.
function encryptedHandoff(): Record<string, unknown> {
  const origin = { acurast: "5origin" };
  return {
    domain: "proof.slipway.acurast-environment-handoff.v1",
    actionId: "set-env-1",
    applicationId: "alpha",
    policyDigest: "policy-digest-1",
    childSessionId: "child-1",
    jobId: "job-1",
    deploymentId: "deployment-1",
    acurastJobRef: {
      origin,
      sequence: 1,
      canonicalJobId: JSON.stringify([origin, 1])
    },
    envNames: ["SECRET_VALUE"],
    assignments: [{
      processor: "processor-1",
      publicKey: "client-public-key",
      variables: [{
        key: "SECRET_VALUE",
        encryptedValue: {
          iv: "iv",
          ciphertext: "ciphertext",
          authTag: "auth-tag"
        }
      }]
    }]
  };
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
