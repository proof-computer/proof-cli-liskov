import { OrganizationScopedCommand } from "../../../../organization-context.js";

export default class SlipwayApplicationLockboxGrant extends OrganizationScopedCommand {
  static description = "Manage Liskov Application secret grants.";
  static examples = [
    "<%= config.bin %> liskov application lockbox grant status proof-docs"
  ];
  static summary = "Manage Liskov Application secret grants.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application lockbox grant status --help`.");
  }
}
