import { Command } from "@oclif/core";

export default class SlipwayApplicationLockboxGrant extends Command {
  static description = "Manage Slipway Application Lockbox grants.";
  static examples = [
    "<%= config.bin %> slipway application lockbox grant status proof-docs"
  ];
  static summary = "Manage Slipway Application Lockbox grants.";

  async run(): Promise<void> {
    this.log("Use `proof slipway application lockbox grant status --help`.");
  }
}
