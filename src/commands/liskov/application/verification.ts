import { Args, Command, Flags, type Interfaces } from "@oclif/core";

import { runApplicationVerification } from "../../../application-verification.js";
import { liskovUrlFlag, OrganizationScopedCommand } from "../../../organization-context.js";

export default class LiskovApplicationVerification extends Command {
  static description = "Manage an application's public verification record.";
  static summary = LiskovApplicationVerification.description;
  static strict = false;

  async run(): Promise<void> {
    this.parsed = true;
    const bin = this.config.bin;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      this.log(`Manage an application's public verification record.

USAGE
  $ ${bin} liskov application verification <command> [options]

COMMANDS
  show APP_REF
  publish APP_REF [--label TEXT | --clear-label] [--yes]
  unpublish APP_REF [--yes]

DESCRIPTION
  Show reads the current record. Publishing and unpublishing require an
  organization admin. Run either without --yes to preview the change.`);
      return;
    }

    this.error(`Unknown application verification command. Run \`${bin} liskov application verification --help\` for available commands.`, {
      code: "SLIPWAY_COMMAND_NOT_NATIVE",
      exit: 1
    });
  }
}

export abstract class ApplicationVerificationCommand extends OrganizationScopedCommand {
  static args = {
    app_ref: Args.string({ description: "Liskov Application UID, name, or legacy ID.", required: true })
  };

  static flags: Interfaces.FlagInput = {
    config: Flags.string({ description: "Path to the local Liskov session file." }),
    help: Flags.help({ char: "h" }),
    json: Flags.boolean({ description: "Emit machine-readable JSON." }),
    "liskov-url": liskovUrlFlag()
  };

  // These commands promise one read or mutation, including when previewing publication.
  protected readonly reportInvocationAnalytics = false;
  protected abstract readonly action: "show" | "publish" | "unpublish";

  async run(): Promise<void> {
    const { args, flags } = await this.parse({
      args: ApplicationVerificationCommand.args,
      flags: this.ctor.flags,
      baseFlags: this.ctor.baseFlags
    });
    const yes = flags.yes === true;
    const action = this.action === "publish"
      ? { kind: this.action, yes, publisherLabel: flags["clear-label"] === true ? null : flags.label as string | undefined }
      : { kind: this.action, yes };
    const code = await runApplicationVerification({
      applicationRef: args.app_ref,
      config: flags.config as string | undefined,
      json: flags.json as boolean | undefined,
      slipwayUrl: flags["liskov-url"] as string | undefined
    }, action, {
      organization: flags.organization as string | undefined,
      stdout: (line) => this.log(line)
    });
    if (code !== 0) this.exit(code);
  }
}
