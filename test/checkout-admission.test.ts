import assert from "node:assert/strict";
import test from "node:test";
import { isOrganizationBillingResponse, type LiskovOrganizationBillingResponse } from "../src/organization-client.js";
import { formatOrganizationBilling } from "../src/organization-output.js";

const base: LiskovOrganizationBillingResponse = {
  ok: true, organization: { id: "org-a", name: "A", slug: "a", isPersonal: false, role: "admin" },
  serviceCredits: { availableUsd: 0, reservedUsd: 0, usedUsd: 0, promoUsd: 0 }
};
test("billing reads support old servers and report actual Checkout availability", () => {
  assert.equal(isOrganizationBillingResponse(base), true);
  assert.match(formatOrganizationBilling(base), /availability unknown/);
  for (const available of [false, true]) {
    const value = { ...base, addFunds: { checkoutAvailable: available, checkoutAdmission: {
      enabled: available, configured: true, available, reason: available ? null : "checkout_admission_disabled"
    } } };
    assert.equal(isOrganizationBillingResponse(value), true);
    assert.match(formatOrganizationBilling(value), available ? /available in the Console/ : /temporarily paused/);
    assert.deepEqual(JSON.parse(JSON.stringify(value)).addFunds, value.addFunds);
  }
  assert.match(formatOrganizationBilling({ ...base, addFunds: { checkoutAvailable: false } }), /checkout: unavailable/);
  assert.equal(isOrganizationBillingResponse({ ...base, addFunds: { checkoutAvailable: "false" } }), false);
});
