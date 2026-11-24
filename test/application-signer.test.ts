import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runSlipwayApplicationSigner,
  runSlipwayApplicationSignerPair,
  runSlipwayApplicationSignerUnpair,
  runSlipwayCustodyPair,
  type SlipwayApplicationSignerUnpairInput,
  type SlipwayCliOptions
} from "../src/index.js";

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
 *  `66c3f67fc5b6f3054cef8e093ec6f1df2dcae28e`,
 *  `crates/liskov-control-plane-api/vectors/application_custody_signer.json`. */
const vector = async (): Promise<Vector> =>
  JSON.parse(await readFile(new URL("./fixtures/application_custody_signer.json", import.meta.url), "utf8"));

const address = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const retiredAddress = "5GrwvaEF5zXb26Fz9rcQpDWS64pDqm7EV1Bp24hUjZf419ck";

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
      const printed = JSON.parse(out.stdout[0]!);
      assert.deepEqual(printed, body, name);
      if (name === "fundedHeld") {
        assert.deepEqual(printed.executedFunding.retiredSignerHolds, [{ signerAddress: retiredAddress, holds: 1 }]);
      }
    }
  });
});

const unavailableFunding = ["Observed funding: not reported (no_customer_funded_execution)."];
const retiredSignerHeading = "  Retired signers to reconnect:";
const fundingCases: Record<keyof Vector, string[]> = {
  unpaired: unavailableFunding,
  managed: unavailableFunding,
  live: unavailableFunding,
  stalled: unavailableFunding,
  oldProtocol: unavailableFunding,
  waiting: unavailableFunding,
  claimed: unavailableFunding,
  sent: unavailableFunding,
  ambiguous: unavailableFunding,
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
    "  Deregistration holds: 1 (deregister_signer_retired 1)",
    retiredSignerHeading,
    `    ${retiredAddress}  1 launch`
  ],
  fundedSettlementUnreadable: [
    "Observed funding (self_custody, acu_planck):",
    "  Admitted 1, open reserves 0, settled 0",
    "  Settled amount: not provable (a settled job has no settlement Liskov can prove)",
    "  Closed, amount unknown: 0",
    "  Unresolved holds: 1, oldest 600000 ms"
  ]
};

for (const name of Object.keys(fundingCases) as (keyof typeof fundingCases)[]) {
  test(`application signer renders observed funding for ${name}`, async () => {
    const bodies = await vector();
    await withSession(async (sessionFile) => {
      const out = await readSigner(sessionFile, {}, () => Response.json(bodies[name]));
      assert.equal(out.code, 0);
      const start = out.lines.findIndex((line) => line.startsWith("Observed funding"));
      assert.ok(start > 0);
      if (name.startsWith("funded")) {
        assert.equal(standing(out.lines), "Standing: online");
        assert.equal(out.lines[start - 1], "Last signature: none");
      }
      assert.deepEqual(out.lines.slice(start), fundingCases[name]);
    });
  });
}

test("application signer lists retired holds in served order and labels unprovable addresses", async () => {
  const { fundedHeld } = await vector();
  const secondAddress = "5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdy7dQPTK7ErGvbA";
  await withSession(async (sessionFile) => {
    const valid = await readSigner(sessionFile, {}, () => Response.json(fundedHeld));
    assert.equal(valid.code, 0);
    const holdSummary = valid.lines.slice(0, -2);
    const variants = [
      {
        holds: [{ signerAddress: secondAddress, holds: 2 }, { signerAddress: retiredAddress, holds: 1 }],
        lines: [retiredSignerHeading, `    ${secondAddress}  2 launches`, `    ${retiredAddress}  1 launch`]
      },
      {
        holds: [{ signerAddress: null, holds: 1 }],
        lines: [retiredSignerHeading, "    address not provable  1 launch"]
      },
      { holds: [], lines: [] },
      { holds: undefined, lines: [] }
    ];
    for (const { holds, lines } of variants) {
      const body = { ...fundedHeld, executedFunding: { ...fundedHeld.executedFunding, retiredSignerHolds: holds } };
      const out = await readSigner(sessionFile, {}, () => Response.json(body));
      assert.equal(out.code, 0);
      assert.deepEqual(out.lines, [...holdSummary, ...lines]);
      assert.notDeepEqual(out.lines, valid.lines);
    }
  });
});

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
      "  Deregistration holds: 1 (deregister_signer_retired 1)",
      retiredSignerHeading,
      `    ${retiredAddress}  1 launch`
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

const signerUrl = "https://liskov.test/api/applications/my-app/custody/signer";
const pairingReply = {
  ok: true,
  applicationId: "my-app",
  organizationId: "org-1",
  pairingToken: "lsk_pair_for_signer",
  expiresAtMs: 1_750_000_030_000,
  websocketPath: "/api/custody/signer?pairingToken=lsk_pair_for_signer",
  protocolVersion: 2
};
const pairingLines = [
  "Issued self-custody signer pairing token for my-app.",
  "Control plane: wss://liskov.test/api/custody/signer",
  "Expires at: 2025-06-15T15:07:10.000Z",
  "Run signer: liskov-self-custody-signer --control-plane-url 'wss://liskov.test/api/custody/signer' --pairing-token 'lsk_pair_for_signer'"
];

async function mutateSigner(
  run: (input: SlipwayApplicationSignerUnpairInput, options: SlipwayCliOptions) => Promise<number>,
  sessionFile: string,
  input: { yes?: boolean; json?: boolean; organization?: string },
  ...respond: (() => Response)[]
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const requests: { url: string; method: string | undefined; auth: string | null; organization: string | null; body: RequestInit["body"] }[] = [];
  const code = await run({ applicationRef: "my-app", config: sessionFile, json: input.json, yes: input.yes }, {
    env: {},
    organization: input.organization,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers);
      const response = respond[requests.length];
      requests.push({
        url: String(url),
        method: init?.method,
        auth: headers.get("authorization"),
        organization: headers.get("x-liskov-organization"),
        body: init?.body
      });
      if (!response) throw new Error("unexpected signer request");
      return response();
    }
  });
  assert.ok(![...stdout, ...stderr].join("\n").includes(token));
  return { code, requests, output: stdout.join("\n") };
}

function signerReadback(boundSignerAddress: string | null): Response {
  return Response.json({ ok: true, signerReadback: { boundSignerAddress } });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

test("application signer pair posts with the current session and prints the signer command", async () => {
  await withSession(async (sessionFile) => {
    const result = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, {}, () => Response.json(pairingReply));
    assert.equal(result.code, 0);
    assert.deepEqual(result.requests, [{
      url: `${signerUrl}/pairing-token`, method: "POST", auth: `Bearer ${token}`, organization: null, body: "{}"
    }]);
    assert.deepEqual(result.output.split("\n"), pairingLines);
  });
});

test("application signer pair adds the replacement warning only for a bound signer", async () => {
  await withSession(async (sessionFile) => {
    const unbound = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, {}, () => Response.json(pairingReply));
    const respond = () => Response.json({ ...pairingReply, boundAddress: address });
    const bound = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, {}, respond);
    const operator = await mutateSigner(runSlipwayCustodyPair, sessionFile, {}, respond);
    assert.equal(bound.code, 0);
    assert.equal(operator.code, 0);
    assert.deepEqual(bound.output.split("\n"), [
      ...unbound.output.split("\n"),
      `This replaces the paired signer ${address}. Jobs it registered still settle through it: keep it available, or run it again, until they finish.`
    ]);
    assert.equal(operator.output, unbound.output);
  });
});

test("application signer pair --json matches operator pairing output and honors organization selection", async () => {
  await withSession(async (sessionFile) => {
    const respond = () => Response.json({ ...pairingReply, boundAddress: address });
    const result = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, { json: true, organization: "my-org" }, respond);
    const operator = await mutateSigner(runSlipwayCustodyPair, sessionFile, { json: true }, respond);
    assert.equal(result.code, 0);
    assert.equal(operator.code, 0);
    assert.equal(result.requests[0].auth, `Liskov-Organization ${token}`);
    assert.equal(result.requests[0].organization, "my-org");
    assert.equal(result.output, operator.output);
    assert.deepEqual(JSON.parse(result.output), {
      ...pairingReply,
      boundAddress: address,
      controlPlaneUrl: "wss://liskov.test/api/custody/signer",
      websocketUrl: `wss://liskov.test${pairingReply.websocketPath}`,
      signerCommand: pairingLines[3].slice("Run signer: ".length)
    });
  });
});

test("application signer pair explains the plan refusal and never prints a refused pairing token", async () => {
  await withSession(async (sessionFile) => {
    const respond = () => Response.json({
      ok: false, error: "self_custody_plan_required", pairingToken: pairingReply.pairingToken
    }, { status: 403 });
    const result = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, {}, respond);
    assert.equal(result.code, 1);
    assert.equal(result.output, "Error (LISKOV_APPLICATION_SIGNER_PAIR_FAILED): This organisation's plan does not include self-custody signing (self_custody_plan_required).");
    const json = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, { json: true }, respond);
    assert.equal(json.code, 1);
    assert.equal(JSON.parse(json.output).reason, "self_custody_plan_required");
    assert.ok(!json.output.includes(pairingReply.pairingToken));
  });
});

test("application signer unpair requires confirmation before making a request", async () => {
  await withSession(async (sessionFile) => {
    const result = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, {});
    assert.equal(result.code, 1);
    assert.deepEqual(result.requests, []);
    assert.equal(result.output, "Error (LISKOV_APPLICATION_SIGNER_UNPAIR_CONFIRMATION_REQUIRED): Removing a self-custody signer requires --yes.");
  });
});

test("application signer unpair reads the bound address before DELETE", async () => {
  await withSession(async (sessionFile) => {
    const result = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true }, () => signerReadback(address), noContent);
    assert.equal(result.code, 0);
    assert.deepEqual(result.requests, ["GET", "DELETE"].map((method) => ({
      url: signerUrl, method, auth: `Bearer ${token}`, organization: null, body: undefined
    })));
    assert.equal(result.output, `Removed the self-custody signer ${address} from my-app.`);
  });
});

test("application signer unpair reports an idempotent success for an unbound application", async () => {
  await withSession(async (sessionFile) => {
    const result = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true }, () => signerReadback(null), noContent);
    assert.equal(result.code, 0);
    assert.deepEqual(result.requests.map(({ method }) => method), ["GET", "DELETE"]);
    assert.equal(result.output, "No self-custody signer was paired to my-app; nothing changed.");
  });
});

test("application signer unpair --json reports the observed address or null", async () => {
  await withSession(async (sessionFile) => {
    for (const removedAddress of [address, null]) {
      const result = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true, json: true },
        () => signerReadback(removedAddress), noContent);
      assert.equal(result.code, 0);
      assert.deepEqual(JSON.parse(result.output), { ok: true, applicationRef: "my-app", removedAddress, status: 204 });
    }
  });
});

test("application signer unpair lists open requests and can be retried when they finish", async () => {
  await withSession(async (sessionFile) => {
    const requestIds = ["sign_1", "sign_2"];
    const respond = () => Response.json({ ok: false, error: "self_custody_sign_request_open", requestIds }, { status: 409 });
    const result = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true }, () => signerReadback(address), respond);
    assert.equal(result.code, 1);
    assert.equal(result.output, "Error (LISKOV_APPLICATION_SIGNER_UNPAIR_FAILED): my-app has open sign requests: sign_1, sign_2. Run unpair again when they finish.");
    const json = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true, json: true }, () => signerReadback(address), respond);
    assert.equal(json.code, 1);
    assert.deepEqual(JSON.parse(json.output), {
      ok: false, error: "LISKOV_APPLICATION_SIGNER_UNPAIR_FAILED", status: 409,
      reason: "self_custody_sign_request_open", applicationRef: "my-app", requestIds
    });
  });
});

test("application signer unpair explains the plan refusal", async () => {
  await withSession(async (sessionFile) => {
    const result = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true }, () => signerReadback(address),
      () => Response.json({ ok: false, error: "self_custody_plan_required" }, { status: 403 }));
    assert.equal(result.code, 1);
    assert.equal(result.output, "Error (LISKOV_APPLICATION_SIGNER_UNPAIR_FAILED): This organisation's plan does not include self-custody signing (self_custody_plan_required).");
  });
});

test("signer mutations report other server codes and unpair stops on a refused read", async () => {
  await withSession(async (sessionFile) => {
    const respond = () => Response.json({ ok: false, error: "application_not_found" }, { status: 404 });
    const pair = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, {}, respond);
    const unpair = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true }, respond);
    assert.equal(pair.code, 1);
    assert.equal(unpair.code, 1);
    assert.equal(pair.output, "Error (LISKOV_APPLICATION_SIGNER_PAIR_FAILED): application_not_found");
    assert.equal(unpair.output, "Error (LISKOV_APPLICATION_SIGNER_UNPAIR_FAILED): application_not_found");
    assert.deepEqual(unpair.requests.map(({ method }) => method), ["GET"]);
  });
});

test("signer mutations keep the server code with actionable session and role refusals", async () => {
  await withSession(async (sessionFile) => {
    const unauthorized = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, {},
      () => Response.json({ ok: false, error: "unauthorized" }, { status: 401 }));
    assert.equal(unauthorized.code, 1);
    assert.match(unauthorized.output, /SLIPWAY_SESSION_UNAUTHORIZED.*proof liskov login.*\(unauthorized\)/u);

    const forbidden = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true }, () => signerReadback(address),
      () => Response.json({ ok: false, error: "forbidden", reasonCode: "capability_not_granted", capability: "custody.signer.pair" }, { status: 403 }));
    assert.equal(forbidden.code, 1);
    assert.match(forbidden.output, /SLIPWAY_ACCESS_DENIED.*custody\.signer\.pair.*Ask an organization admin.*\(forbidden\)/u);
  });
});

test("signer mutations suppress reflected session credentials and transport exceptions", async () => {
  await withSession(async (sessionFile) => {
    for (const json of [false, true]) {
      const pair = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, { json },
        () => Response.json({ ...pairingReply, reflected: token }));
      const unpair = await mutateSigner(runSlipwayApplicationSignerUnpair, sessionFile, { yes: true, json },
        () => signerReadback(token), noContent);
      const transportFailure = await mutateSigner(runSlipwayApplicationSignerPair, sessionFile, { json },
        () => { throw new Error(`transport failure: ${token}`); });
      assert.equal(pair.code, 1);
      assert.equal(unpair.code, 1);
      assert.deepEqual(unpair.requests.map(({ method }) => method), ["GET"]);
      assert.equal(transportFailure.code, 1);
    }
  });
});
