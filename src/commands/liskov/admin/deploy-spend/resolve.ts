import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayAdminDeploySpendResolve } from "../../../../session.js";

export default class SlipwayAdminDeploySpendResolve extends Command {
  static args = {
    reserve: Args.string({ description: "Deploy-spend reserve id.", required: true })
  };
  static description = "Dry-run or resolve an ADR-0011 deploy-spend review hold with immutable evidence.";
  static examples = [
    "<%= config.bin %> liskov admin deploy-spend resolve deploy-reserve:abc --expect-organization org-1 --expect-application app-1 --expect-deployment dep-1 --expect-execution exec-1 --expect-billing-transaction deploy-spend:abc --expect-status review_required --final-usd-micros 25000 --evidence-ref case:123 --evidence-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --reason \"manual adjudication\" --json"
  ];
  static flags: Interfaces.FlagInput = {
    "admin-token": Flags.string({ description: "Admin service token (else PROOF_SLIPWAY_ADMIN_SERVICE_TOKEN, else session token)." }),
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    "expect-organization": Flags.string({ required: true, description: "Required expected organization id." }),
    "expect-application": Flags.string({ required: true, description: "Required expected application id." }),
    "expect-deployment": Flags.string({ required: true, description: "Required expected deployment id." }),
    "expect-execution": Flags.string({ required: true, description: "Required expected execution id." }),
    "expect-billing-transaction": Flags.string({ required: true, description: "Required expected billing transaction id." }),
    "expect-status": Flags.string({
      required: true,
      options: ["review_required"],
      description: "Required expected status (review_required)."
    }),
    "final-usd-micros": Flags.integer({ required: true, min: 0, description: "Explicit final charge in USD micros; never inferred." }),
    "evidence-ref": Flags.string({ required: true, description: "External evidence reference." }),
    "evidence-sha256": Flags.string({ required: true, description: "SHA-256 of the reviewed evidence." }),
    reason: Flags.string({ required: true, description: "Required adjudication reason." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    yes: Flags.boolean({ char: "y", description: "Apply the resolution. Without this flag the server performs a dry run." }),
    help: Flags.help({ char: "h" })
  };
  static summary = "Resolve a deploy-spend review hold.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayAdminDeploySpendResolve);
    const code = await runSlipwayAdminDeploySpendResolve({
      reserveId: args.reserve,
      adminToken: flags["admin-token"] as string | undefined,
      config: flags.config as string | undefined,
      expectOrganization: flags["expect-organization"] as string,
      expectApplication: flags["expect-application"] as string,
      expectDeployment: flags["expect-deployment"] as string,
      expectExecution: flags["expect-execution"] as string,
      expectBillingTransaction: flags["expect-billing-transaction"] as string,
      expectStatus: flags["expect-status"] as string,
      finalUsdMicros: flags["final-usd-micros"] as number,
      evidenceRef: flags["evidence-ref"] as string,
      evidenceSha256: flags["evidence-sha256"] as string,
      reason: flags.reason as string,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      json: flags.json as boolean | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
