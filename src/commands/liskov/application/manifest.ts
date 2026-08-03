import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class LiskovApplicationManifest extends OrganizationScopedCommand {
  static description = "Validate authored Liskov Application manifests.";
  static summary = "Authored Application manifest commands.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application manifest validate --help`.");
  }
}
