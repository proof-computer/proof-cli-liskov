import { Args, Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../../organization-context.js";

import { runSlipwayApplicationVarsSet } from "../../../../session.js";

export default class LiskovApplicationVarsSet extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application uid, name, or legacy id.", required: true }),
    name: Args.string({ description: "Managed variable name declared by the active policy.", required: true }),
    value: Args.string({ description: "Value to store, verbatim. An empty string is a value; pass a leading dash after --.", required: true })
  };
  static description =
    "Set the value of a managed variable the Application's active policy declares. Without --yes, shows the current and new value and writes nothing. Values are plaintext by design; put credentials in Secrets.";
  static examples = [
    "<%= config.bin %> liskov application vars set proof-docs RPC_URL wss://rpc.example",
    "<%= config.bin %> liskov application vars set proof-docs RPC_URL wss://rpc.example --yes",
    "<%= config.bin %> liskov application vars set proof-docs --yes -- OFFSET -5"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag(),
    yes: Flags.boolean({ char: "y", description: "Confirm the write. Without this flag the command is a dry run." })
  };
  static summary = "Set a Liskov Application managed variable value.";

  async run(): Promise<void> {
    const { args, flags } = await this.parse(LiskovApplicationVarsSet);
    const code = await runSlipwayApplicationVarsSet({
      applicationRef: args.app_ref,
      name: args.name,
      value: args.value,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined,
      yes: flags.yes as boolean | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
