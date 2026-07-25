import { Command } from "@oclif/core";

export default class LiskovApplicationPolicy extends Command {
  static description = "Validate or migrate Liskov Application policies locally.";
  static summary = "Manage local Application policy files.";

  async run(): Promise<void> {
    this.log("Use `proof liskov application policy validate --help` or `policy migrate --help`.");
  }
}
