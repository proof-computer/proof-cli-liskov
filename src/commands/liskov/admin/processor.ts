import { Command } from "@oclif/core";

export default class SlipwayAdminProcessor extends Command {
  static description = "Manage Liskov processor greylist state.";
  static examples = [
    "<%= config.bin %> liskov admin processor list --greylisted",
    "<%= config.bin %> liskov admin processor clear-greylist 0xabc --yes"
  ];
  static summary = "Manage Liskov processor greylist state.";

  async run(): Promise<void> {
    this.log("Use `proof liskov admin processor list --help`.");
  }
}
