import { Command } from "@oclif/core";

export default class SlipwayApplicationRuntimeImage extends Command {
  static description = "Manage Liskov Application runtime-image upload wiring.";
  static examples = [
    "<%= config.bin %> liskov application runtime-image workflow proof-docs --output .github/workflows/liskov-runtime-image.yml"
  ];
  static summary = "Manage runtime-image upload wiring.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application runtime-image workflow --help`.");
  }
}
