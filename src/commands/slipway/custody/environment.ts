import { Command } from "@oclif/core";

export default class SlipwayCustodyEnvironment extends Command {
  static description = "Manage encrypted live custody environment handoffs.";
  static summary = "Manage encrypted live custody environment handoffs.";

  async run(): Promise<void> {
    this.log("Use `proof slipway custody environment upload --help`.");
  }
}
