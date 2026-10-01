import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import SlipwayAdminDeploySpendResolve from "../src/commands/liskov/admin/deploy-spend/resolve.js";
import SlipwayAdminExecutorOperationReconcile from "../src/commands/liskov/admin/executor-operation/reconcile.js";
import SlipwayAdminExecutorOperationRecoverDeploySubmit from "../src/commands/liskov/admin/executor-operation/recover-deploy-submit.js";
import SlipwayAdminProcessorClearGreylist from "../src/commands/liskov/admin/processor/clear-greylist.js";
import SlipwayAdminProcessorList from "../src/commands/liskov/admin/processor/list.js";
import SlipwayAdminRetirementAdjudicateLineage from "../src/commands/liskov/admin/retirement/adjudicate-lineage.js";
import SlipwayAdminRetirementHistoricalCloseout from "../src/commands/liskov/admin/retirement/historical-closeout.js";
import { LISKOV_ADMIN_SERVICE_TOKEN_ENV, LISKOV_SESSION_FILE_ENV } from "../src/organization-context.js";
import {
  resolveAdminToken,
  resolveSlipwaySessionFile,
  runSlipwayAdminProcessorList,
  saveSlipwaySession
} from "../src/index.js";

const SESSION_TOKEN = "session-token-d1nc";
const ADMIN_TOKEN = "admin-token-d1nc";

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "proof-cli-env-names-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function listProcessorsWithEnv(env: NodeJS.ProcessEnv): Promise<{ code: number; authorization: string | null; stdout: string }> {
  let authorization: string | null = null;
  const lines: string[] = [];
  const fetchImpl = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({ ok: true, processors: [], greylistedCount: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  const code = await runSlipwayAdminProcessorList({ json: true }, {
    env,
    fetchImpl,
    stdout: (line) => lines.push(line),
    stderr: (line) => lines.push(line)
  });
  return { code, authorization, stdout: lines.join("\n") };
}

describe("CLI environment variable names", () => {
  it("names both overrides as LISKOV_ constants", () => {
    assert.equal(LISKOV_SESSION_FILE_ENV, "LISKOV_SESSION_FILE");
    assert.equal(LISKOV_ADMIN_SERVICE_TOKEN_ENV, "LISKOV_ADMIN_SERVICE_TOKEN");
  });

  it("reads the session file from LISKOV_SESSION_FILE, below --config, and ignores the old name", async () => {
    assert.equal(resolveSlipwaySessionFile({ env: { LISKOV_SESSION_FILE: "rel/s.json" } }), path.resolve("rel/s.json"));
    assert.equal(
      resolveSlipwaySessionFile({ config: "flag/s.json", env: { LISKOV_SESSION_FILE: "rel/s.json" } }),
      path.resolve("flag/s.json")
    );
    await withTempDir(async (directory) => {
      assert.equal(
        resolveSlipwaySessionFile({ env: { PROOF_SLIPWAY_SESSION_FILE: "/x/old.json", XDG_CONFIG_HOME: directory } }),
        path.join(directory, "proof", "liskov", "session.json")
      );
    });
  });

  it("reads the admin token from LISKOV_ADMIN_SERVICE_TOKEN, below --admin-token, and ignores the old name", () => {
    assert.equal(resolveAdminToken({ env: { LISKOV_ADMIN_SERVICE_TOKEN: "a" } }), "a");
    assert.equal(resolveAdminToken({ token: "flag", env: { LISKOV_ADMIN_SERVICE_TOKEN: "a" } }), "flag");
    assert.equal(resolveAdminToken({ env: { PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN: "old" } }), undefined);
    assert.equal(resolveAdminToken({ env: { LISKOV_ADMIN_SERVICE_TOKEN: "" } }), undefined);
  });

  it("sends the LISKOV_ADMIN_SERVICE_TOKEN bearer to an admin route from the LISKOV_SESSION_FILE session", async () => {
    await withTempDir(async (directory) => {
      const sessionFile = path.join(directory, "custom", "session.json");
      await saveSlipwaySession({
        version: 1,
        slipwayUrl: "https://liskov.test",
        sessionToken: SESSION_TOKEN,
        savedAtMs: 1
      }, { config: sessionFile });
      const xdg = path.join(directory, "xdg");

      const withNew = await listProcessorsWithEnv({
        LISKOV_SESSION_FILE: sessionFile,
        LISKOV_ADMIN_SERVICE_TOKEN: ADMIN_TOKEN,
        XDG_CONFIG_HOME: xdg
      });
      assert.equal(withNew.code, 0);
      assert.equal(withNew.authorization, `Bearer ${ADMIN_TOKEN}`);

      const withOld = await listProcessorsWithEnv({
        LISKOV_SESSION_FILE: sessionFile,
        PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN: ADMIN_TOKEN,
        XDG_CONFIG_HOME: xdg
      });
      assert.equal(withOld.code, 0);
      assert.equal(withOld.authorization, `Bearer ${SESSION_TOKEN}`);

      for (const output of [withNew.stdout, withOld.stdout]) {
        assert.equal(output.includes(ADMIN_TOKEN), false);
        assert.equal(output.includes(SESSION_TOKEN), false);
      }
    });
  });

  it("names LISKOV_ADMIN_SERVICE_TOKEN in every admin command's --admin-token help", () => {
    const commands = [
      SlipwayAdminDeploySpendResolve,
      SlipwayAdminExecutorOperationReconcile,
      SlipwayAdminExecutorOperationRecoverDeploySubmit,
      SlipwayAdminProcessorClearGreylist,
      SlipwayAdminProcessorList,
      SlipwayAdminRetirementAdjudicateLineage,
      SlipwayAdminRetirementHistoricalCloseout
    ];
    for (const command of commands) {
      const flag = command.flags["admin-token"] as unknown as { description?: string };
      assert.ok(flag.description?.includes("LISKOV_ADMIN_SERVICE_TOKEN"), `${command.name} names LISKOV_ADMIN_SERVICE_TOKEN`);
      assert.equal(flag.description?.includes("PROOF_SLIPWAY"), false, `${command.name} does not name PROOF_SLIPWAY`);
    }
  });
});
