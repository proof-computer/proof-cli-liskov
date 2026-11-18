import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import type { PolicyContractEvaluation } from "../src/application-policy.js";

interface ManifestDocument {
  schemaVersion: number;
  deployment: { booking?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

interface CorpusSample {
  name: string;
  request: Record<string, unknown>;
}

// liskov-rs 4473cf26b26f4ed6d2960b086506254fe4d7dea3 (BKLG-20261118-pztg).
// Each base is that version's own corpus document. A V6 document redeclared
// as V4 is refused at /release/mode with or without booking.
const OWNER_COMMIT = "4473cf26b26f4ed6d2960b086506254fe4d7dea3";
const BOOKING = { mode: "ahead_of_time", horizon: "1h" };
const BASES: ReadonlyArray<readonly [string, number]> = [
  ["v4/golden", 4],
  ["v5/telegram-bot", 5],
  ["v6/telegram-bot", 6],
  ["v7/acurast-public-http", 7],
  ["v8/materialize/payload-replace", 8],
];

// Run after install/build, as in AGENTS.md. Exercise the shipped files from
// an actual tarball, with installed dependencies resolved from this checkout.
test("the npm tarball refuses an authored booking block in every vendored version", async () => {
  mkdirSync(".tmp", { recursive: true });
  const scratch = mkdtempSync(path.resolve(".tmp/booking-package-"));
  try {
    const packed = JSON.parse(execFileSync("npm", [
      "pack", "--json", "--ignore-scripts", "--pack-destination", scratch,
      "--cache", path.join(scratch, "cache")
    ], { encoding: "utf8" })) as Array<{ filename: string }>;
    const entry = packed[0];
    assert.ok(entry, "npm pack produced a tarball");
    execFileSync("tar", ["-xzf", path.join(scratch, entry.filename), "-C", scratch]);
    const directory = path.join(scratch, "package/dist/policy-client-bundle");
    const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as unknown;
    const digest = (file: string) => `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
    const source = json(path.join(directory, "source.json")) as {
      commit: string; files: Record<string, { source: string; sha256: string }>;
    };
    assert.equal(source.commit, OWNER_COMMIT);
    assert.equal(Object.keys(source.files).some((file) => file.includes("booking-v6")), false);
    for (const [file, record] of Object.entries(source.files)) {
      const packaged = file.startsWith("test/") ? file : path.join(directory, file);
      assert.equal(digest(packaged), record.sha256, file);
      if (!file.startsWith("test/")) {
        assert.deepEqual(readFileSync(packaged), readFileSync(path.join("src/policy-client-bundle", file)), file);
      }
    }

    const cli = await import(pathToFileURL(path.join(scratch, "package/dist/application-policy.js")).href) as typeof import("../src/application-policy.js");
    const corpus = json(path.join(directory, "policy-client-conformance.json")) as { valid: CorpusSample[] };
    const sample = (name: string) => {
      const found = corpus.valid.find((item) => item.name === name);
      assert.ok(found, name);
      return found;
    };

    for (const [name, schemaVersion] of BASES) {
      const request = sample(name).request as { document: string; encoding: string };
      const parsed = cli.evaluateApplicationManifestText(
        request.document,
        request.encoding === "yaml" ? "yaml" : "json"
      );
      assert.equal(parsed.valid, true, name);
      const base = structuredClone(parsed.document) as ManifestDocument;
      assert.equal(base.schemaVersion, schemaVersion, name);
      assert.equal(Object.hasOwn(base.deployment, "booking"), false, name);
      assert.equal(cli.evaluateApplicationManifest(base).valid, true, name);

      const booked = structuredClone(base);
      booked.deployment.booking = BOOKING;
      const refused: PolicyContractEvaluation = cli.evaluateApplicationManifest(booked);
      assert.equal(refused.valid, false, name);
      assert.equal(refused.errors[0]?.code, "unknown_field", name);
      assert.equal(refused.errors[0]?.pointer, "/deployment/booking", name);
      const refusedDocument = refused.document as ManifestDocument;
      assert.equal(Object.hasOwn(refusedDocument.deployment, "booking"), true, name);

      const withoutBooking = structuredClone(refusedDocument);
      delete withoutBooking.deployment.booking;
      assert.equal(cli.evaluateApplicationManifest(withoutBooking).valid, true, name);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
