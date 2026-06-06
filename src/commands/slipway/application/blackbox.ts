import { Command } from "@oclif/core";

export default class SlipwayApplicationBlackbox extends Command {
  static description = "Manage Slipway Application Blackbox configuration.";
  static examples = [
    "<%= config.bin %> slipway application blackbox configure proof-docs --yes"
  ];
  static summary = "Manage Slipway Application Blackbox configuration.";

  async run(): Promise<void> {
    this.log("Use `proof slipway application blackbox configure --help`.");
  }
}
