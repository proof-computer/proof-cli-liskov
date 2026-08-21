import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class LiskovApplicationPolicy extends OrganizationScopedCommand {
  static description = "Read the canonical retained V5 policy explanation surface.";
  static summary = "Application policy explanation commands.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application policy explain --help`.");
  }
}
