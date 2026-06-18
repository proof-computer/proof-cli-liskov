import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationRuntimeImageWorkflow } from "../../../../session.js";

export default class SlipwayApplicationRuntimeImageWorkflow extends Command {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true })
  };
  static description = "Write a GitHub Actions workflow for Liskov runtime-image uploads.";
  static examples = [
    "<%= config.bin %> liskov application runtime-image workflow proof-docs",
    "<%= config.bin %> liskov application runtime-image workflow proof-docs --output .github/workflows/liskov-runtime-image.yml --yes",
    "<%= config.bin %> liskov application runtime-image workflow proof-docs --liskov-url https://liskov.proof.computer --json"
  ];
  static flags: Interfaces.FlagInput = {
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": Flags.string({ description: "Liskov service URL embedded in the generated workflow." }),
    "oidc-audience": Flags.string({ description: "GitHub OIDC audience requested by the generated workflow." }),
    output: Flags.string({ char: "o", description: "Workflow file to write.", default: ".github/workflows/liskov-runtime-image.yml" }),
    "workflow-name": Flags.string({ description: "GitHub Actions workflow name." }),
    yes: Flags.boolean({ char: "y", description: "Overwrite an existing workflow file." })
  };
  static summary = "Write the runtime-image upload workflow.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SlipwayApplicationRuntimeImageWorkflow);
    const code = await runSlipwayApplicationRuntimeImageWorkflow({
      applicationRef: args.app_ref,
      json: flags.json as boolean | undefined,
      liskovUrl: flags["liskov-url"] as string | undefined,
      oidcAudience: flags["oidc-audience"] as string | undefined,
      output: flags.output as string | undefined,
      workflowName: flags["workflow-name"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, { stdout: (line) => this.log(line) });
    if (code !== 0) this.exit(code);
  }
}
