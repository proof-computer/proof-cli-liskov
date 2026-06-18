import { Command } from "@oclif/core";

export default class SlipwayApplicationLockboxGrant extends Command {
  static description = "Manage Liskov Application Lockbox grants.";
  static examples = [
    "<%= config.bin %> liskov application lockbox grant status proof-docs"
  ];
  static summary = "Manage Liskov Application Lockbox grants.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application lockbox grant status --help`.");
  }
}
