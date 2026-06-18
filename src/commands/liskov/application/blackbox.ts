import { Command } from "@oclif/core";

export default class SlipwayApplicationBlackbox extends Command {
  static description = "Manage Liskov Application Blackbox configuration.";
  static examples = [
    "<%= config.bin %> liskov application blackbox configure proof-docs --yes"
  ];
  static summary = "Manage Liskov Application Blackbox configuration.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application blackbox configure --help`.");
  }
}
