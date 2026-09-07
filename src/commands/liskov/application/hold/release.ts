import { Args, Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationHoldRelease } from "../../../../session.js";

export default class LiskovApplicationHoldRelease extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description =
    "Return a held job of a Liskov Application to service without publishing a new policy version. A job is held when Liskov has proof the application itself failed (a signed runtime fatal, or a crash under debug.holdOnFailure); the hold stops that job's next generation until it is released. Without --yes the server returns a dry run naming the hold. The release is recorded as an authorization the executor applies on its next pass; it does not change the policy.";
  static examples = [
    "<%= config.bin %> liskov application hold release proof-docs",
    "<%= config.bin %> liskov application hold release proof-docs --reason \"config fixed in v3\" --yes",
    "<%= config.bin %> liskov application hold release proof-docs --hold-id failure-hold:sha256:… --yes --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    "hold-id": Flags.string({ description: "The hold to release, when more than one job is held. Coverage lists them." }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag(),
    owner: Flags.string({ description: "Owner address to disambiguate a legacy Application id." }),
    reason: Flags.string({ description: "Reason recorded on the release." }),
    yes: Flags.boolean({ char: "y", description: "Request the release. Without this flag the server returns a dry run." })
  };
  static summary = "Release a held job so its next generation can launch.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationHoldRelease);
    const code = await runSlipwayApplicationHoldRelease({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      holdId: flags["hold-id"] as string | undefined,
      json: flags.json as boolean | undefined,
      owner: flags.owner as string | undefined,
      reason: flags.reason as string | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
