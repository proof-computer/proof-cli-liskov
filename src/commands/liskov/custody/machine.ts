import { Command } from "@oclif/core";

export default class SlipwayCustodyMachine extends Command {
  static description = "Read Acurast machine-class data from Liskov.";
  static summary = "Read Acurast machine-class data.";

  async run(): Promise<void> {
    this.log("Use `proof liskov custody machine catalog --help`.");
  }
}
