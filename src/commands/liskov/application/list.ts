import { Flags, type Interfaces } from "@oclif/core";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../organization-context.js";

import { runSlipwayApplicationList } from "../../../session.js";

export default class SlipwayApplicationList extends OrganizationScopedCommand {
  static description = "List readable Liskov Applications.";
  static examples = [
    "<%= config.bin %> liskov application list",
    "<%= config.bin %> liskov application list --retired",
    "<%= config.bin %> liskov application list --json",
    "<%= config.bin %> liskov application list --liskov-url http://127.0.0.1:8787"
  ];
  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    // `deleted` is the persisted compatibility detail; `retired` is the
    // product's word (ADR-0038 §12). The old flag stays as an alias so a
    // scripted caller is not broken (BKLG-20260902-e7l1).
    deleted: Flags.boolean({ description: "Deprecated alias for --retired." }),
    retired: Flags.boolean({ description: "List retired Applications only." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag()
  };
  static summary = "List readable Liskov Applications.";

  async run(): Promise<void> {
    const { flags } = await this.parse(SlipwayApplicationList);
    const code = await runSlipwayApplicationList({
      config: flags.config as string | undefined,
      deleted: (flags.retired as boolean | undefined) === true || (flags.deleted as boolean | undefined) === true,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined
    }, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
