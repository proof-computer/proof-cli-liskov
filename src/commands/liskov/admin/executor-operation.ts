import { Command } from "@oclif/core";

export default class SlipwayAdminExecutorOperation extends Command {
  static description = "Guarded Liskov executor-operation repair commands.";
  static summary = "Guarded executor-operation repair commands.";

  async run(): Promise<void> {
    this.log("Use `proof liskov admin executor-operation reconcile --help`.");
  }
}
