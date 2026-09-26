import { Args, Flags, type Interfaces } from "@oclif/core";
import { AnalyticsCommand } from "../../../../analytics-command.js";

import { runSlipwayAdminRetirementHistoricalCloseout } from "../../../../session.js";

export default class SlipwayAdminRetirementHistoricalCloseout extends AnalyticsCommand {
  static args = {
    uid: Args.string({ description: "Canonical application UID.", required: true })
  };
  static description = "Dry-run or confirm the ADR-0163 manifest-bound historical closeout of one pre-launch application's retirement residue. Never a customer action.";
  static examples = [
    "<%= config.bin %> liskov admin retirement historical-closeout app-uid --manifest-ref docs/raw/2026-09-23-firegrass-paused-disabled-retirement-manifest.md --expect-retirement ret-1 --expect-assessment-digest 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --actor-id admin-1 --reason \"ADR-0163 firegrass closeout\" --json",
    "<%= config.bin %> liskov admin retirement historical-closeout app-uid [same exact guards] --confirm --fingerprint sha256:... --json"
  ];
  static flags: Interfaces.FlagInput = {
    "admin-token": Flags.string({ description: "Admin service token (else PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN, else session token)." }),
    "actor-id": Flags.string({ required: true, description: "Required operator actor id recorded on the closeout." }),
    "actor-kind": Flags.string({
      default: "platform_admin",
      description: "Actor kind recorded on the closeout (default platform_admin)."
    }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    confirm: Flags.boolean({ description: "Apply the closeout. Requires --fingerprint from a prior dry-run." }),
    "expect-assessment-digest": Flags.string({ required: true, description: "Required expected retirement assessment digest (64 lowercase hex)." }),
    "expect-retirement": Flags.string({ required: true, description: "Required expected active retirement id." }),
    fingerprint: Flags.string({ description: "confirmationFingerprint from a prior dry-run; required with --confirm." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "manifest-ref": Flags.string({ required: true, description: "Required owner-approved manifest reference that lists the application." }),
    reason: Flags.string({ required: true, description: "Required operator reason recorded on the closeout." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Close one pre-launch application's retirement residue (ADR-0163).";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayAdminRetirementHistoricalCloseout);
    const code = await runSlipwayAdminRetirementHistoricalCloseout({
      adminToken: flags["admin-token"] as string | undefined,
      actorId: flags["actor-id"] as string,
      actorKind: flags["actor-kind"] as string,
      applicationUid: args.uid,
      config: flags.config as string | undefined,
      confirm: flags.confirm as boolean | undefined,
      confirmationFingerprint: flags.fingerprint as string | undefined,
      expectAssessmentDigest: flags["expect-assessment-digest"] as string,
      expectRetirement: flags["expect-retirement"] as string,
      json: flags.json as boolean | undefined,
      manifestRef: flags["manifest-ref"] as string,
      reason: flags.reason as string,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
