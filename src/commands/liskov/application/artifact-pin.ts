import { Command } from "@oclif/core";

export default class SlipwayApplicationArtifactPin extends Command {
  static description = "Manage Liskov Application artifact pins.";
  static examples = [
    "<%= config.bin %> liskov application artifact-pin list proof-docs"
  ];
  static summary = "Manage Liskov Application artifact pins.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application artifact-pin list --help`.");
  }
}
