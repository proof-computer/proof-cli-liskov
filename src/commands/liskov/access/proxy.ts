import { Command, Flags, type Interfaces } from "@oclif/core";

import { ManagedAccessProxyError, runManagedAccessProxy } from "../../../managed-access-proxy.js";

export default class LiskovAccessProxy extends Command {
  static description = "Internal managed Runtime SSH ProxyCommand transport.";
  static hidden = true;
  static flags: Interfaces.FlagInput = {
    gateway: Flags.string({ required: true }),
    help: Flags.help({ char: "h" }),
    "token-file": Flags.string({ required: true }),
    "tunnel-id": Flags.string({ required: true })
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(LiskovAccessProxy);
    try {
      await runManagedAccessProxy({
        gateway: flags.gateway as string,
        tokenFile: flags["token-file"] as string,
        tunnelId: flags["tunnel-id"] as string
      });
    } catch (error) {
      const code = error instanceof ManagedAccessProxyError ? error.code : "access_proxy_failed";
      process.stderr.write(`${code}\n`);
      this.exit(1);
    }
  }
}
