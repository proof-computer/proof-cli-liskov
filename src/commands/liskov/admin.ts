import { Command } from "@oclif/core";

export default class SlipwayAdmin extends Command {
  static description = "Liskov platform-admin operations.";
  static examples = [
    "<%= config.bin %> liskov admin processor list --greylisted",
    "<%= config.bin %> liskov admin executor-operation reconcile --help"
  ];
  static summary = "Liskov platform-admin operations.";

  async run(): Promise<void> {
    this.log("Use `proof liskov admin processor list --help`, `proof liskov admin executor-operation reconcile --help`, or `proof liskov admin deploy-spend resolve --help`.");
  }
}
