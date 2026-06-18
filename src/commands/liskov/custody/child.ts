import { Command } from "@oclif/core";

export default class SlipwayCustodyChild extends Command {
  static description = "Manage live custody child-session recovery.";
  static summary = "Manage live custody child-session recovery.";

  async run(): Promise<void> {
    this.log("Use `proof liskov custody child recover --help`.");
  }
}
