import assert from "node:assert/strict";
import test from "node:test";

import { browserOpenCommand } from "../src/browser-open.js";

const loginUrl = "https://console.liskov.proof.computer/cli-login.html?pendingLoginId=pl-1&userCode=ABCD-EFGH";

test("Windows opens the whole login URL without passing it through cmd", () => {
  assert.deepEqual(browserOpenCommand("win32", loginUrl), {
    command: "rundll32",
    args: ["url.dll,FileProtocolHandler", loginUrl]
  });
});

test("macOS and Linux pass the login URL as one argument", () => {
  assert.deepEqual(browserOpenCommand("darwin", loginUrl), { command: "open", args: [loginUrl] });
  assert.deepEqual(browserOpenCommand("linux", loginUrl), { command: "xdg-open", args: [loginUrl] });
});
