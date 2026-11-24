import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runSlipwayApplicationSigner } from "../src/session.js";

const token = "session-token-that-must-not-be-printed";

async function withSession(run: (sessionFile: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proof-application-signer-test-"));
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

type Body = Record<string, unknown>;
type SignerBody = Body & { signerReadback: Body; executedFunding: Body };
type Vector = Record<
  "unpaired" | "managed" | "live" | "stalled" | "oldProtocol" | "waiting" | "claimed" | "sent" | "ambiguous" |
  "fundedNothingSettled" | "fundedSettled" | "fundedHeld" | "fundedSettlementUnreadable",
  SignerBody
>;

/** The owner's vector, copied byte for byte from `liskov-rs` main at
 *  `0a27c13319da46c5afeec25226665c2d75324a43`,
 *  `crates/liskov-control-plane-api/vectors/application_custody_signer.json`. */
const vector = async (): Promise<Vector> =>
  JSON.parse(await readFile(new URL("./fixtures/application_custody_signer.json", import.meta.url), "utf8"));

const address = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

async function readSigner(
  sessionFile: string,
  input: { applicationRef?: string; json?: boolean },
  respond: () => Response
): Promise<{ code: number; stdout: string[]; lines: string[]; requested: string[]; authorization: string[] }> {
  const stdout: string[] = [];
  const requested: string[] = [];
  const authorization: string[] = [];
  const code = await runSlipwayApplicationSigner(
    { applicationRef: input.applicationRef ?? "my-app", json: input.json, config: sessionFile },
    {
      env: {},
      stdout: (line) => stdout.push(line),
      stderr: (line) => stdout.push(line),
      fetchImpl: async (url, init) => {
        assert.equal(init?.method, "GET");
        requested.push(String(url));
        authorization.push(new Headers(init?.headers).get("authorization") ?? "");
        return respond();
      }
    }
  );
  return { code, stdout, lines: stdout.join("\n").split("\n"), requested, authorization };
}

const standing = (lines: string[]): string | undefined => lines.find((line) => line.startsWith("Standing: "));
const countsLine = (lines: string[]): string | undefined => lines.find((line) => line.startsWith("Counts: "));

test("application signer reads a live signer from the application-scoped route", async () => {
  const { live } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(live));
    assert.equal(out.code, 0);
    assert.deepEqual(out.requested, ["https://liskov.test/api/applications/my-app/custody/signer"]);
    assert.deepEqual(out.authorization, [`Bearer ${token}`]);
    assert.deepEqual(out.lines, [
      "Self-custody signer for app_01j8canonical",
      "Policy: sha256:5d41402abc4b2a76b9719d911017c592ae2f1c9e5d8b3a7c6e4f2a1b0c9d8e7f",
      "Standing: online",
      "Signers:",
      `${address}\tonline\tconnected\theartbeat 0 ms\tprotocol 2`,
      "No open sign requests.",
      "Counts: bound 1, online 1, open 0, pending 0, claimed 0, completed 3, signed 2, refused 1, expired 0, ambiguous 0",
      "Dispatch lag: oldest unclaimed -, oldest claimed -, last success 60000 ms ago",
      "Last signature: 2025-09-16T05:19:00.000Z",
      "Observed funding: not reported (no_customer_funded_execution)."
    ]);
  });
});

test("application signer encodes the application ref into one path segment", async () => {
  const { live } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, { applicationRef: "my app/1" }, () => Response.json(live));
    assert.equal(out.code, 0);
    assert.deepEqual(out.requested, ["https://liskov.test/api/applications/my%20app%2F1/custody/signer"]);
  });
});

test("application signer says an unpaired application has no policy and prints its zero counts", async () => {
  const { unpaired } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(unpaired));
    assert.equal(out.code, 0);
    assert.ok(out.lines.includes("Policy: none"));
    assert.equal(standing(out.lines), "Standing: unpaired");
    assert.ok(out.lines.includes("No signer is paired to this application."));
    assert.equal(
      countsLine(out.lines),
      "Counts: bound 0, online 0, open 0, pending 0, claimed 0, completed 0, signed 0, refused 0, expired 0, ambiguous 0"
    );
    assert.ok(out.lines.includes("Last signature: none"));
  });
});

test("application signer shows the paired policy of a managed application with no signer rows", async () => {
  const { managed } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(managed));
    assert.equal(out.code, 0);
    assert.ok(out.lines.includes("Policy: sha256:5d41402abc4b2a76b9719d911017c592ae2f1c9e5d8b3a7c6e4f2a1b0c9d8e7f"));
    assert.equal(standing(out.lines), "Standing: unpaired");
    assert.ok(!out.lines.includes("Signers:"));
    assert.ok(out.lines.every((line) => !line.includes(address)));
  });
});

test("application signer takes liveness from the served online flag, not from connected", async () => {
  const { stalled } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(stalled));
    assert.equal(out.code, 0);
    assert.equal(
      standing(out.lines),
      "Standing: offline (connected, heartbeat 95000 ms ago; online after 90000 ms of silence is not assumed)"
    );
    assert.ok(out.lines.includes(`${address}\toffline\tconnected\theartbeat 95000 ms\tprotocol 2`));
  });
});

test("application signer flags a signer below protocol 2", async () => {
  const { oldProtocol } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(oldProtocol));
    assert.equal(out.code, 0);
    assert.equal(standing(out.lines), "Standing: signer protocol 1 is below 2");
  });
});

test("application signer shows a request waiting for a signer", async () => {
  const { waiting } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(waiting));
    assert.equal(out.code, 0);
    assert.equal(standing(out.lines), "Standing: 1 request(s) waiting 4000 ms for a signer");
    const at = out.lines.indexOf("Open requests:");
    assert.ok(at > 0);
    assert.equal(out.lines[at + 1], "op_sign_01\tpending\t-\tsent no\tattempt 0\tdeadline -");
    assert.ok(out.lines.includes("Dispatch lag: oldest unclaimed 4000 ms, oldest claimed -, last success -"));
  });
});

test("application signer shows a claimed request and whether it reached the signer", async () => {
  const { claimed, sent } = await vector();
  await withSession(async (sessionFile) => {
    for (const [body, reached] of [[claimed, "no"], [sent, "yes"]] as const) {
      const out = await readSigner(sessionFile, {}, () => Response.json(body));
      assert.equal(out.code, 0);
      assert.equal(standing(out.lines), "Standing: online");
      const at = out.lines.indexOf("Open requests:");
      assert.equal(
        out.lines[at + 1],
        `op_sign_01\trunning\t${address}\tsent ${reached}\tattempt 1\tdeadline 2025-09-16T05:20:56.000Z`
      );
    }
  });
});

test("application signer reports a sent request with no legible outcome", async () => {
  const { ambiguous } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(ambiguous));
    assert.equal(out.code, 0);
    assert.equal(standing(out.lines), "Standing: 1 sent request(s) with no legible outcome");
  });
});

test("application signer --json prints every served body unchanged", async () => {
  const bodies = await vector();
  await withSession(async (sessionFile) => {
    for (const [name, body] of Object.entries(bodies)) {
      const out = await readSigner(sessionFile, { json: true }, () => Response.json(body));
      assert.equal(out.code, 0, name);
      assert.equal(out.stdout.length, 1, name);
      assert.deepEqual(JSON.parse(out.stdout[0]!), body, name);
    }
  });
});

const fundingCases = {
  fundedNothingSettled: [
    "Observed funding (self_custody, acu_planck):",
    "  Admitted 1, open reserves 1, settled 0",
    "  Settled amount: 0 ACU (0 planck)",
    "  Closed, amount unknown: 0",
    "  Unresolved holds: 0"
  ],
  fundedSettled: [
    "Observed funding (self_custody, acu_planck):",
    "  Admitted 3, open reserves 1, settled 2",
    "  Settled amount: 340282366920938463463374607.431768211455 ACU (340282366920938463463374607431768211455 planck)",
    "  Closed, amount unknown: 0",
    "  Unresolved holds: 0"
  ],
  fundedHeld: [
    "Observed funding (self_custody, acu_planck):",
    "  Admitted 3, open reserves 1, settled 1",
    "  Settled amount: 0.00000075 ACU (750000 planck)",
    "  Closed, amount unknown: 1 (missing_execution_report 1)",
    "  Unresolved holds: 2, oldest 600000 ms",
    "  Deregistration holds: 1 (deregister_signer_retired 1)"
  ],
  fundedSettlementUnreadable: [
    "Observed funding (self_custody, acu_planck):",
    "  Admitted 1, open reserves 0, settled 0",
    "  Settled amount: not provable (a settled job has no settlement Liskov can prove)",
    "  Closed, amount unknown: 0",
    "  Unresolved holds: 1, oldest 600000 ms"
  ]
} satisfies Partial<Record<keyof Vector, string[]>>;

for (const name of Object.keys(fundingCases) as (keyof typeof fundingCases)[]) {
  test(`application signer renders observed funding for ${name}`, async () => {
    const bodies = await vector();
    await withSession(async (sessionFile) => {
      const out = await readSigner(sessionFile, {}, () => Response.json(bodies[name]));
      assert.equal(out.code, 0);
      assert.equal(standing(out.lines), "Standing: online");
      const start = out.lines.findIndex((line) => line.startsWith("Observed funding ("));
      assert.ok(start > 0);
      assert.equal(out.lines[start - 1], "Last signature: none");
      assert.deepEqual(out.lines.slice(start), fundingCases[name]);
    });
  });
}

test("application signer formats whole ACU without a decimal point", async () => {
  const { fundedSettled } = await vector();
  const body = { ...fundedSettled, executedFunding: { ...fundedSettled.executedFunding, settledPlanck: "1000000000000" } };
  await withSession(async (sessionFile) => {
    const original = await readSigner(sessionFile, {}, () => Response.json(fundedSettled));
    const whole = await readSigner(sessionFile, {}, () => Response.json(body));
    assert.equal(original.code, 0);
    assert.equal(whole.code, 0);
    const amount = whole.lines.find((line) => line.startsWith("  Settled amount:"));
    assert.equal(amount, "  Settled amount: 1 ACU (1000000000000 planck)");
    assert.notEqual(amount, original.lines.find((line) => line.startsWith("  Settled amount:")));
  });
});

test("application signer preserves other funding units, served reason order, and zero hold age", async () => {
  const { fundedHeld } = await vector();
  const body = {
    ...fundedHeld,
    executedFunding: {
      ...fundedHeld.executedFunding,
      unit: "other_unit",
      closedAmountUnknown: 3,
      closedAmountUnknownByReason: { second_reason: 1, first_reason: 2 },
      oldestUnresolvedHoldAgeMs: 0
    }
  };
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(body));
    assert.equal(out.code, 0);
    const start = out.lines.indexOf("Observed funding (self_custody, other_unit):");
    assert.ok(start > 0);
    assert.deepEqual(out.lines.slice(start), [
      "Observed funding (self_custody, other_unit):",
      "  Admitted 3, open reserves 1, settled 1",
      "  Settled amount: 750000 other_unit",
      "  Closed, amount unknown: 3 (second_reason 1, first_reason 2)",
      "  Unresolved holds: 2, oldest 0 ms",
      "  Deregistration holds: 1 (deregister_signer_retired 1)"
    ]);
  });
});

test("application signer reports unavailable funding with the server's reason", async () => {
  const { live } = await vector();
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(live));
    assert.equal(out.code, 0);
    assert.ok(out.lines.includes("Observed funding: not reported (no_customer_funded_execution)."));
    assert.ok(out.lines.every((line) => !line.startsWith("Observed funding (")));
  });
});

test("application signer reads settlement only from the contracted amount field", async () => {
  const { live } = await vector();
  const body = { ...live, executedFunding: { available: true, spent: "12345" } };
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, {}, () => Response.json(body));
    assert.equal(out.code, 0);
    assert.ok(out.lines.includes("  Settled amount: -"));
    assert.ok(!out.stdout.join("\n").includes("12345"));
  });
});

test("application signer shows the bound address and any replaced signer rows", async () => {
  const { live } = await vector();
  const replacedAddress = "5GrwvaEF5zXb26Fz9rcQpDWS64yFKWzjH4PPev67wCMFJL42";
  const body = {
    ...live,
    signerReadback: {
      ...live.signerReadback,
      boundSignerAddress: address,
      replacedSigners: [{ signerAddress: replacedAddress, online: false, connected: true, heartbeatAgeMs: 95000, protocolVersion: 2 }]
    }
  };
  await withSession(async (sessionFile) => {
    const original = await readSigner(sessionFile, {}, () => Response.json(live));
    const out = await readSigner(sessionFile, {}, () => Response.json(body));
    assert.equal(original.code, 0);
    assert.equal(out.code, 0);
    assert.ok(original.lines.every((line) => !line.startsWith("Bound address:") && !line.startsWith("Replaced signers")));
    const at = out.lines.indexOf("Standing: online");
    assert.ok(at > 0);
    assert.deepEqual(out.lines.slice(at, at + 7), [
      "Standing: online",
      `Bound address: ${address}`,
      "Signers:",
      `${address}\tonline\tconnected\theartbeat 0 ms\tprotocol 2`,
      "Replaced signers (connected to settle jobs they registered):",
      `${replacedAddress}\toffline\tconnected\theartbeat 95000 ms\tprotocol 2`,
      "No open sign requests."
    ]);
  });
});

test("application signer maps a rejected session to SLIPWAY_SESSION_UNAUTHORIZED", async () => {
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, { json: true }, () =>
      Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
    );
    assert.equal(out.code, 1);
    const result = JSON.parse(out.stdout[0]!);
    assert.equal(result.error, "SLIPWAY_SESSION_UNAUTHORIZED");
    assert.equal(result.status, 401);
  });
});

test("application signer keeps the server's refusal as its reason", async () => {
  const refusals: [number, Body][] = [
    [404, { ok: false, error: "application_not_found", reason: "no_match" }],
    [409, { ok: false, error: "ambiguous_application", reason: "multiple", candidates: [{ id: "a" }] }]
  ];
  await withSession(async (sessionFile) => {
    for (const [status, body] of refusals) {
      const out = await readSigner(sessionFile, { json: true }, () => Response.json(body, { status }));
      assert.equal(out.code, 1, String(status));
      const result = JSON.parse(out.stdout[0]!);
      assert.equal(result.error, "SLIPWAY_APPLICATION_SIGNER_FAILED");
      assert.equal(result.status, status);
      assert.equal(result.reason, body.error);

      const human = await readSigner(sessionFile, {}, () => Response.json(body, { status }));
      assert.equal(human.code, 1);
      assert.ok(human.stdout.join("\n").includes(`(${String(body.error)})`));
      assert.ok(!human.stdout.join("\n").includes("Standing: online"));
    }
  });
});

test("application signer words a missing application.read grant as the CLI's access refusal", async () => {
  // The owner's access-denied body (`slipway-tenancy` `AccessDecision::public_denied`).
  const denied = { ok: false, error: "forbidden", reasonCode: "capability_not_granted", reason: null, capability: "application.read" };
  await withSession(async (sessionFile) => {
    const out = await readSigner(sessionFile, { json: true }, () => Response.json(denied, { status: 403 }));
    assert.equal(out.code, 1);
    const result = JSON.parse(out.stdout[0]!);
    assert.equal(result.error, "SLIPWAY_ACCESS_DENIED");
    assert.equal(result.status, 403);
    assert.equal(result.reasonCode, "capability_not_granted");
    assert.equal(result.capability, "application.read");
  });
});

test("application signer never prints the session token", async () => {
  const bodies = await vector();
  const responses: (() => Response)[] = [
    ...Object.values(bodies).map((body) => () => Response.json(body)),
    () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 }),
    () => Response.json({ ok: false, error: "application_not_found", reason: "no_match" }, { status: 404 })
  ];
  await withSession(async (sessionFile) => {
    for (const respond of responses) {
      for (const json of [false, true]) {
        const out = await readSigner(sessionFile, { json }, respond);
        assert.ok(out.stdout.every((line) => !line.includes(token)));
      }
    }
  });
});
