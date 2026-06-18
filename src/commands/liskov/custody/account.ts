import { Command } from "@oclif/core";

export default class SlipwayCustodyAccount extends Command {
  static description = "Manage Liskov live custody accounts.";
  static summary = "Manage Liskov live custody accounts.";

  async run(): Promise<void> {
    this.log("Use `proof liskov custody account ensure --help`.");
  }
}
