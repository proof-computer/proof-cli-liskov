import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalOrganizationId,
  LISKOV_ORGANIZATION_ENV,
  MAX_ORGANIZATION_SELECTOR_BYTES,
  OrganizationScopedCommand,
  OrganizationSelectorError,
  organizationRequestHeaders,
  organizationSelector
} from "../src/organization-context.js";

test("organization selectors trim once, preserve exact case, and reject empty or oversized input", () => {
  assert.equal(organizationSelector("  Exact-Slug  "), "Exact-Slug");
  assert.equal(organizationSelector(undefined), undefined);
  assert.throws(() => organizationSelector(" \t "), (error: unknown) =>
    error instanceof OrganizationSelectorError && error.code === "LISKOV_ORGANIZATION_SELECTOR_INVALID");
  assert.throws(
    () => organizationSelector("x".repeat(MAX_ORGANIZATION_SELECTOR_BYTES + 1)),
    (error: unknown) => error instanceof OrganizationSelectorError && error.code === "LISKOV_ORGANIZATION_SELECTOR_INVALID"
  );
  assert.throws(() => organizationSelector(undefined, { required: true }), (error: unknown) =>
    error instanceof OrganizationSelectorError && error.code === "LISKOV_ORGANIZATION_SELECTOR_REQUIRED");
});

test("canonical organization resolution prefers an exact ID over an exact slug collision", () => {
  const organizations = [{
    id: "collision",
    name: "ID winner",
    slug: "other",
    isPersonal: false,
    role: "owner"
  }, {
    id: "org-second",
    name: "Slug loser",
    slug: "collision",
    isPersonal: false,
    role: "developer"
  }];
  assert.equal(canonicalOrganizationId("collision", organizations), "collision");
  assert.equal(canonicalOrganizationId("Collision", organizations), undefined);
});

test("request organization headers use a fail-closed authorization scheme", () => {
  assert.deepEqual(organizationRequestHeaders("token", undefined), {
    accept: "application/json",
    authorization: "Bearer token"
  });
  assert.deepEqual(organizationRequestHeaders("token", " request-org "), {
    accept: "application/json",
    authorization: "Liskov-Organization token",
    "x-liskov-organization": "request-org"
  });
});

test("the inherited organization flag advertises its environment source and has no short alias", () => {
  const flag = OrganizationScopedCommand.baseFlags.organization as unknown as {
    char?: string;
    env?: string;
    helpLabel?: string;
  };
  assert.equal(flag.env, LISKOV_ORGANIZATION_ENV);
  assert.equal(flag.helpLabel, "--organization <selector>");
  assert.equal(flag.char, undefined);
});
