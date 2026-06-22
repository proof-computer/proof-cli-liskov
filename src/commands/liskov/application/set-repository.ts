import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationSetRepository } from "../../../session.js";

export default class SlipwayApplicationSetRepository extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }),
    repository: Args.string({ description: "New GitHub repository as owner/repo (e.g. proof-computer/liskov-diagnostic).", required: true })
  };
  static description = "Repoint a Liskov Application at a renamed GitHub repository, republishing a new policy version.";
  static examples = [
    "<%= config.bin %> liskov application set-repository slipway-diagnostic proof-computer/liskov-diagnostic",
    "<%= config.bin %> liskov application set-repository slipway-diagnostic proof-computer/liskov-diagnostic --yes",
    "<%= config.bin %> liskov application set-repository app-0123456789abcdef proof-computer/liskov-diagnostic --owner github:12345 --json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    owner: Flags.string({ description: "Owner address to disambiguate a legacy Application id." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." }),
    "workflow-ref": Flags.string({ description: "Override the artifact-automation workflowRef instead of rewriting the renamed-repo prefix." }),
    yes: Flags.boolean({ char: "y", description: "Confirm the repository change. Without this flag the server returns a dry run." })
  };
  static summary = "Repoint a Liskov Application at a renamed GitHub repository.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationSetRepository);
    const code = await runSlipwayApplicationSetRepository({
      applicationRef: args.app_ref,
      repository: args.repository,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      owner: flags.owner as string | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined,
      workflowRef: flags["workflow-ref"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
