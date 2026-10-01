import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runSlipwayPlacementManagerFleet } from "../src/session.js";

const token = "session-token-that-must-not-be-printed";

async function withSession(run: (sessionFile: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proof-placement-test-"));
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
 *  `crates/liskov-control-plane-api/vectors/manager_fleet_readback.json`:
 *  the bodies below are what the server sends, not what this side expects. */
type FleetVector = {
  placeable: Record<string, unknown>;
  emptyFleet: Record<string, unknown>;
  unavailable: Record<string, unknown>;
};
const vector = async (): Promise<FleetVector> =>
  JSON.parse(await readFile(new URL("./fixtures/manager_fleet_readback.json", import.meta.url), "utf8"));

async function readFleet(
  sessionFile: string,
  input: { managerId?: string; json?: boolean },
  respond: () => Response
): Promise<{ code: number; stdout: string[]; stderr: string[]; requested: string[]; authorization: (string | null)[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const requested: string[] = [];
  const authorization: (string | null)[] = [];
  const code = await runSlipwayPlacementManagerFleet(
    { managerId: input.managerId ?? "9470", json: input.json, config: sessionFile },
    {
      env: {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, "GET");
        requested.push(String(url));
        authorization.push(new Headers(init?.headers).get("authorization"));
        return respond();
      }
    }
  );
  return { code, stdout, stderr, requested, authorization };
}

function assertNoToken(out: { stdout: string[]; stderr: string[] }): void {
  for (const line of [...out.stdout, ...out.stderr]) assert.doesNotMatch(line, new RegExp(token, "u"));
}

test("manager fleet prints the served placeable and eligible counts, the projection and the evidence range", async () => {
  const { placeable } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readFleet(sessionFile, {}, () => Response.json(placeable));
    assert.equal(out.code, 0);
    assert.deepEqual(out.requested, ["https://liskov.test/api/placement/managers/9470/fleet"]);
    assert.deepEqual(out.authorization, [`Bearer ${token}`]);
    const text = out.stdout.join("\n");
    assert.deepEqual(text.split("\n"), [
      "Manager 9470: 3 of 4 eligible processors are placeable now (projection 12).",
      "Manager evidence from 2025-07-31T21:56:40.000Z to 2025-07-31T22:11:40.000Z."
    ]);
    assert.doesNotMatch(text, /processorId/u);
    assertNoToken(out);
  });
});

test("manager fleet says an empty fleet reaches nobody and prints no evidence line", async () => {
  const { emptyFleet } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readFleet(sessionFile, {}, () => Response.json(emptyFleet));
    assert.equal(out.code, 0);
    const text = out.stdout.join("\n");
    assert.deepEqual(text.split("\n"), [
      "Manager 9470: no eligible processors in the served projection (projection 12).",
      "A placement rule naming only this manager reaches nobody."
    ]);
    assert.doesNotMatch(text, /evidence/u);
    assertNoToken(out);
  });
});

test("manager fleet prints an unavailable projection with the server's reason, never as zero or empty", async () => {
  const { unavailable } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readFleet(sessionFile, {}, () => Response.json(unavailable));
    assert.equal(out.code, 0);
    const text = out.stdout.join("\n");
    assert.match(text, /unavailable/u);
    assert.match(text, /placement_projection_unavailable/u);
    assert.doesNotMatch(text, /0 of/u);
    assert.doesNotMatch(text, / 0 /u);
    assert.doesNotMatch(text, /\bempty\b/u);
    assertNoToken(out);
  });
});

test("manager fleet --json prints each server body unchanged", async () => {
  const bodies = await vector();
  for (const name of ["placeable", "emptyFleet", "unavailable"] as const) {
    await withSession(async (sessionFile) => {
      const out = await readFleet(sessionFile, { json: true }, () => Response.json(bodies[name]));
      assert.equal(out.code, 0, name);
      assert.equal(out.stdout.length, 1, name);
      assert.deepEqual(JSON.parse(out.stdout[0]!), bodies[name], name);
      assertNoToken(out);
    });
  }
});

test("manager fleet reports the server's invalid_manager_id refusal", async () => {
  await withSession(async (sessionFile) => {
    const out = await readFleet(
      sessionFile,
      { json: true },
      () => Response.json({ ok: false, error: "invalid_manager_id" }, { status: 400 })
    );
    assert.equal(out.code, 1);
    const body = JSON.parse(out.stdout.join("\n")) as Record<string, unknown>;
    assert.equal(body.error, "SLIPWAY_PLACEMENT_MANAGER_FLEET_FAILED");
    assert.equal(body.reason, "invalid_manager_id");
    assert.equal(body.status, 400);
    assertNoToken(out);
  });
});

test("manager fleet reads a 401 as a rejected session", async () => {
  await withSession(async (sessionFile) => {
    const out = await readFleet(
      sessionFile,
      { json: true },
      () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
    );
    assert.equal(out.code, 1);
    const body = JSON.parse(out.stdout.join("\n")) as Record<string, unknown>;
    assert.equal(body.error, "SLIPWAY_SESSION_UNAUTHORIZED");
    assertNoToken(out);

    const human = await readFleet(
      sessionFile,
      {},
      () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
    );
    assert.equal(human.code, 1);
    assert.match(human.stdout.join("\n"), /SLIPWAY_SESSION_UNAUTHORIZED/u);
    assertNoToken(human);
  });
});

test("manager fleet refuses an id that is not 1 to 39 digits before any request", async () => {
  await withSession(async (sessionFile) => {
    for (const managerId of ["", "12ab", "1".repeat(40)]) {
      const out = await readFleet(sessionFile, { managerId, json: true }, () => {
        throw new Error("no request may be sent for a malformed manager id");
      });
      assert.equal(out.code, 1, managerId);
      assert.deepEqual(out.requested, [], managerId);
      assert.equal((JSON.parse(out.stdout.join("\n")) as { error?: string }).error, "SLIPWAY_PLACEMENT_MANAGER_ID_REQUIRED", managerId);
      assertNoToken(out);
    }
  });
});

test("manager fleet prints a null count in an available body as -, never as 0", async () => {
  const { placeable } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readFleet(sessionFile, {}, () => Response.json({ ...placeable, placeableMembers: null }));
    assert.equal(out.code, 0);
    assert.equal(out.stdout.join("\n").split("\n")[0], "Manager 9470: - of 4 eligible processors are placeable now (projection 12).");
  });
});
