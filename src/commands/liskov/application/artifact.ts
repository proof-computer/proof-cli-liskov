import { OrganizationScopedCommand } from "../../../organization-context.js";

export default class SlipwayApplicationArtifact extends OrganizationScopedCommand {
  static description = "Upload a built bundle as a Liskov Application artifact.";
  static examples = [
    "<%= config.bin %> liskov application artifact upload proof-docs --file bundle.zip"
  ];
  static summary = "Upload a built bundle as a Liskov Application artifact.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application artifact upload --help`.");
  }
}
