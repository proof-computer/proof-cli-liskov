import { Command, Flags, type Interfaces } from "@oclif/core";

import { ManagedAccessProxyError, runManagedAccessProxy } from "../../../managed-access-proxy.js";

/// One sentence per refusal an operator can actually do something about.
/// Managed Runtime SSH carries one session per attachment at a time — that is
/// the contract, not an incidental limit — so the three cases below need
/// opposite responses: wait, retry, or stop.
export function accessProxyAdvice(code: string): string {
  switch (code) {
    case "access_proxy_rejected_session_already_open":
      return ": a Runtime SSH session is already open on this job. Managed Runtime SSH allows one session at a time; retry when it closes.";
    case "access_proxy_rejected_connector_not_registered":
      return ": the runtime has not connected to the access gateway for this job. Check the attachment is ready; if its access sidecar has failed, that is terminal for this run and the job must be relaunched.";
    case "access_proxy_rejected_connector_unavailable":
      return ": the runtime's connection to the access gateway is not ready yet. Retry in a few seconds.";
    default:
      return "";
  }
}

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
      // This runs as OpenSSH's ProxyCommand with inherited stderr, so whatever
      // is written here lands next to ssh's own `kex_exchange_identification`
      // complaint and is the only thing that explains it. A bare token did not
      // (BKLG-20260805-rykk): an operator could not tell "a colleague is
      // connected" from "the runtime never dialled in".
      process.stderr.write(`${code}${accessProxyAdvice(code)}\n`);
      this.exit(1);
    }
  }
}
