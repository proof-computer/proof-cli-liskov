import { Command } from "@oclif/core";

export default class SlipwayCustodyAccount extends Command {
  static description = "Manage Slipway live custody accounts.";
  static summary = "Manage Slipway live custody accounts.";

  async run(): Promise<void> {
    this.log("Use `proof slipway custody account ensure --help`.");
  }
}
