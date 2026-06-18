import { Command, Flags, type Interfaces } from "@oclif/core";

import { runSlipwayApplicationImport } from "../../../session.js";

export default class SlipwayApplicationImport extends Command {
  static description = "Import a Liskov Application policy.";
  static examples = [
    "<%= config.bin %> liskov application import --github proof-computer/docs:.slipway/application-policy.json@main --server-fetch",
    "<%= config.bin %> liskov application import --github proof-computer/docs:.slipway/application-policy.json@main --server-fetch --publish --json",
    "<%= config.bin %> liskov application import --file .slipway/application-policy.json"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    file: Flags.string({ description: "Path to a local Liskov Application policy JSON file." }),
    github: Flags.string({ description: "GitHub policy source as owner/repo:path@ref." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    publish: Flags.boolean({ description: "Publish the imported draft as the active policy." }),
    "server-fetch": Flags.boolean({ description: "Ask Liskov to fetch a GitHub policy with the GitHub App session." }),
    "slipway-url": Flags.string({ description: "Liskov service URL." })
  };
  static summary = "Import a Liskov Application policy.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayApplicationImport);
    const code = await runSlipwayApplicationImport({
      config: flags.config as string | undefined,
      file: flags.file as string | undefined,
      github: flags.github as string | undefined,
      json: flags.json as boolean | undefined,
      publish: flags.publish as boolean | undefined,
      serverFetch: flags["server-fetch"] as boolean | undefined,
      slipwayUrl: flags["slipway-url"] as string | undefined
    }, {
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
