import assert from "node:assert/strict";
import test from "node:test";

import { AnalyticsCommand, sendCliInvocation } from "../src/analytics-command.js";
import { cliAnalyticsHeaders, setCliAnalyticsContext } from "../src/analytics-context.js";

test("CLI analytics is default-on and carries only its bounded attribution headers", () => {
  setCliAnalyticsContext({ enabled: true, userAgent: "proof-cli-liskov/0.14.0" });
  assert.deepEqual(cliAnalyticsHeaders(), {
    "user-agent": "proof-cli-liskov/0.14.0",
    "x-liskov-analytics": "1"
  });
});

test("CLI analytics opt-out retains product user-agent but removes the enable marker", () => {
  setCliAnalyticsContext({ enabled: false, userAgent: "proof-cli-liskov/0.14.0" });
  assert.deepEqual(cliAnalyticsHeaders(), {
    "user-agent": "proof-cli-liskov/0.14.0"
  });
});

test("the inherited no-analytics flag is declared once", () => {
  assert.ok(AnalyticsCommand.baseFlags["no-analytics"]);
});

test("the completion beacon carries one closed command result and no arguments", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  await sendCliInvocation(
    { sessionToken: "secret-token", slipwayUrl: "https://api.liskov.proof.computer" },
    "liskov:application:list",
    "proof-cli-liskov/0.14.0",
    "success",
    (async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    }) as typeof fetch
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.liskov.proof.computer/api/telemetry/cli-invocation");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    commandId: "liskov:application:list",
    cliVersion: "0.14.0",
    exitClass: "success"
  });
  assert.doesNotMatch(String(requests[0]?.init?.body), /secret-token/);
});
