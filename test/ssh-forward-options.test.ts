import assert from "node:assert/strict";
import test from "node:test";

import { hasSshForwardOptions } from "./support/ssh-forward-options.js";

function managedPrintLine(identityPath: string): string {
  return `managed Runtime SSH root@app_1 (provider_dep_1/provider_job_1); identity ${identityPath} SHA256:fingerprint; one-time ticket not minted`;
}

const dynamicPath = managedPrintLine("/tmp/proof-runtime-ssh-test-D6f5su/customer-identity");
const localPath = managedPrintLine("/tmp/proof-runtime-ssh-test-Lx0abc/customer-identity");

test("managed print-command ignores option-like text in identity paths", () => {
  assert.match(dynamicPath, /-L|-D|ExitOnForwardFailure/u);
  assert.equal(hasSshForwardOptions(dynamicPath), false);
  assert.equal(hasSshForwardOptions(localPath), false);
  assert.equal(hasSshForwardOptions(managedPrintLine("/tmp/test -D keys/customer-identity")), false);
});

test("managed print-command detects forward option tokens", () => {
  for (const option of [
    "-L 8080:example.com:80",
    "-L8080:example.com:80",
    "-D 1080",
    "-D1080",
    "-o ExitOnForwardFailure=yes",
    "-oExitOnForwardFailure=yes"
  ]) {
    assert.equal(hasSshForwardOptions(`${localPath} ${option}`), true, option);
  }
  assert.equal(hasSshForwardOptions(`${localPath} -N`), false);
});
