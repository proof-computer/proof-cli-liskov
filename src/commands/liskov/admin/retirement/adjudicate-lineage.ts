import { Args, Command, Flags, type Interfaces } from "@oclif/core";
import { AnalyticsCommand } from "../../../../analytics-command.js";

import { runSlipwayAdminRetirementAdjudicateLineage } from "../../../../session.js";

export default class SlipwayAdminRetirementAdjudicateLineage extends AnalyticsCommand {
  static args = {
    uid: Args.string({ description: "Canonical application UID.", required: true })
  };
  static description = "Dry-run or confirm evidence-backed adjudication of one review-blocked retirement lineage. Never a customer action.";
  static examples = [
    "<%= config.bin %> liskov admin retirement adjudicate-lineage app-uid --operation op-1 --expect-organization org-1 --expect-application app-1 --expect-application-uid app-uid --expect-operation-kind deploy_submit --expect-operation-status review_required --expect-deployment dep-1 --expect-job job-1 --expect-reserve reserve-1 --expect-reserve-status review_required --expect-billing-transaction tx-1 --expect-billing-status review_required --actor-id admin-1 --evidence-ref ticket://k4jz --evidence-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --reason \"finalized JobRegistrationStartInPast\" --json",
    "<%= config.bin %> liskov admin retirement adjudicate-lineage app-uid --operation op-1 [same exact guards] --confirm --fingerprint sha256:... --json"
  ];
  static flags: Interfaces.FlagInput = {
    "admin-token": Flags.string({ description: "Admin service token (else PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN, else session token)." }),
    "actor-id": Flags.string({ required: true, description: "Required operator actor id recorded on the resolution." }),
    "actor-kind": Flags.string({
      default: "platform_admin",
      description: "Actor kind recorded on the resolution (default platform_admin)."
    }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    confirm: Flags.boolean({ description: "Apply the adjudication. Requires --fingerprint from a prior dry-run." }),
    "evidence-ref": Flags.string({ required: true, description: "External evidence reference." }),
    "evidence-sha256": Flags.string({ required: true, description: "SHA-256 of the reviewed evidence (64 lowercase hex)." }),
    "expect-application": Flags.string({ required: true, description: "Required expected application id." }),
    "expect-application-uid": Flags.string({ required: true, description: "Required expected application UID." }),
    "expect-billing-status": Flags.string({ required: true, description: "Required expected billing transaction status." }),
    "expect-billing-transaction": Flags.string({ required: true, description: "Required expected billing transaction id." }),
    "expect-deployment": Flags.string({ required: true, description: "Required expected deployment id." }),
    "expect-job": Flags.string({ required: true, description: "Required expected job id." }),
    "expect-operation-kind": Flags.string({ required: true, description: "Required expected operation kind." }),
    "expect-operation-status": Flags.string({ required: true, description: "Required expected operation status." }),
    "expect-organization": Flags.string({ required: true, description: "Required expected organization id." }),
    "expect-reserve": Flags.string({ required: true, description: "Required expected reserve id." }),
    "expect-reserve-status": Flags.string({ required: true, description: "Required expected reserve status." }),
    fingerprint: Flags.string({ description: "confirmationFingerprint from a prior dry-run; required with --confirm." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    operation: Flags.string({ required: true, description: "Canonical executor operation id (expectOperation)." }),
    reason: Flags.string({ required: true, description: "Required operator reason recorded on the resolution." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Adjudicate one review-blocked retirement lineage.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayAdminRetirementAdjudicateLineage);
    const code = await runSlipwayAdminRetirementAdjudicateLineage({
      adminToken: flags["admin-token"] as string | undefined,
      actorId: flags["actor-id"] as string,
      actorKind: flags["actor-kind"] as string,
      applicationUid: args.uid,
      config: flags.config as string | undefined,
      confirm: flags.confirm as boolean | undefined,
      confirmationFingerprint: flags.fingerprint as string | undefined,
      evidenceRef: flags["evidence-ref"] as string,
      evidenceSha256: flags["evidence-sha256"] as string,
      expectApplication: flags["expect-application"] as string,
      expectApplicationUid: flags["expect-application-uid"] as string,
      expectBillingStatus: flags["expect-billing-status"] as string,
      expectBillingTransaction: flags["expect-billing-transaction"] as string,
      expectDeployment: flags["expect-deployment"] as string,
      expectJob: flags["expect-job"] as string,
      expectOperation: flags.operation as string,
      expectOperationKind: flags["expect-operation-kind"] as string,
      expectOperationStatus: flags["expect-operation-status"] as string,
      expectOrganization: flags["expect-organization"] as string,
      expectReserve: flags["expect-reserve"] as string,
      expectReserveStatus: flags["expect-reserve-status"] as string,
      json: flags.json as boolean | undefined,
      reason: flags.reason as string,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
