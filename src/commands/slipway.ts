import { Command } from "@oclif/core";

export default class Slipway extends Command {
  static description = "Slipway application deployment commands.";
  static strict = false;
  static summary = "Slipway application deployment commands.";

  async run(): Promise<void> {
    this.parsed = true;
    if (this.argv.length === 0 || this.argv.includes("--help") || this.argv.includes("-h")) {
      printSlipwayRootHelp(this.config.bin);
      return;
    }

    console.error(
      `[slipway] Error (SLIPWAY_COMMAND_NOT_NATIVE): unknown native proof slipway command: ${this.argv.join(" ")}. ` +
        `Run \`${this.config.bin} slipway --help\` to list native commands.`
    );
    this.exit(1);
  }
}

function printSlipwayRootHelp(bin: string): void {
  console.log(`Slipway application deployment commands.

USAGE
  $ ${bin} slipway <command> [options]

COMMANDS
  login
  application import --github owner/repo:path@ref [--server-fetch] [--publish]
  application list
  application pause APP_REF --yes
  application resume APP_REF --yes
  application status APPLICATION_ID
  application plans APPLICATION_ID
  application deployment import APP_REF --sequence N --origin ADDRESS --yes
  application lockbox setup-pr APP_REF --yes
  application lockbox dispatch APP_REF --yes
  application lockbox grant ensure APP_REF --yes
  application lockbox grant status APP_REF
  application lockbox grant-status APPLICATION_ID
  application blackbox configure APP_REF --yes
  custody account ensure APP_REF --chain acurast --yes
  custody preflight APP_REF
  custody environment upload APP_REF --secrets-file PATH --yes
  custody execution list APP_REF
  custody execution run-one APP_REF --execution-id ID --expect-kind KIND --expect-policy-digest DIGEST --yes
  custody execution run-one APP_REF --plan-item-id ID --idempotency-key KEY --expect-kind KIND --expect-policy-digest DIGEST --yes-spend --yes
  custody execution submit APP_REF --plan-item-id ID --idempotency-key KEY --yes-spend --yes
  custody execution observe APP_REF --execution-id ID
  custody execution diagnose APP_REF --execution-id ID
  custody execution recover APP_REF --execution-id ID --reason TEXT --yes
  custody child recover APP_REF --child-session-id ID --reason TEXT --yes
  custody machine catalog
  whoami
  logout

DESCRIPTION
  Slipway commands use native proof-cli-slipway entrypoints. Builder login is
  separate from the private slipway:ops operator recovery command surface.`);
}
