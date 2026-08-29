import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class LiskovApplicationExecution extends OrganizationScopedCommand {
  static description = "Read the typed-spine execution and spend/closeout truth from the canonical policy explanation envelope.";
  static summary = "Application execution commands.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application execution show --help`.");
  }
}
