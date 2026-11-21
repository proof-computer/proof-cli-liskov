import { spawn } from "node:child_process";

/**
 * The command that opens `url` in the default browser. Windows goes through
 * rundll32's URL handler rather than `cmd /c start`: cmd reads `&` as a command
 * separator, so the login URL lost everything after `pendingLoginId=…`.
 * No shell runs on any platform, so `&`, `^` and `%` reach the opener as
 * written. `url` is a serialized http(s) URL (`new URL(...).toString()`),
 * which percent-encodes spaces and `"`, so Windows argument quoting leaves it
 * unchanged too.
 */
export function browserOpenCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

export function openBrowser(url: string): boolean {
  const { command, args } = browserOpenCommand(process.platform, url);
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
