import { Flags, type Interfaces } from "@oclif/core";
import { OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayApplicationImport } from "../../../session.js";

export default class SlipwayApplicationImport extends OrganizationScopedCommand {
  static description = "Import a Liskov Application manifest as a draft.";
  static examples = [
    "<%= config.bin %> liskov application import --github proof-computer/docs:.liskov/application-manifest.json@main --server-fetch",
    "<%= config.bin %> liskov application import --github proof-computer/docs:.liskov/application-manifest.json@main --server-fetch --json",
    "<%= config.bin %> liskov application import --file .liskov/application-manifest.json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    file: Flags.string({ description: "Path to a local Liskov Application manifest JSON file." }),
    github: Flags.string({ description: "GitHub manifest source as owner/repo:path@ref." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "server-fetch": Flags.boolean({ description: "Ask Liskov to fetch a GitHub manifest with the GitHub App session." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Import a Liskov Application manifest.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayApplicationImport);
    const code = await runSlipwayApplicationImport({
      config: flags.config as string | undefined,
      file: flags.file as string | undefined,
      github: flags.github as string | undefined,
      json: flags.json as boolean | undefined,
      serverFetch: flags["server-fetch"] as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
