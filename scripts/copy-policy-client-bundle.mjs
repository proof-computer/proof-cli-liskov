import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, "dist", "policy-client-bundle"), { recursive: true });
for (const file of [
  "policy-client-bundle.json",
  "policy-client-contract.wasm.gz",
  "policy-client.cjs",
  "policy-client.d.ts"
]) {
  await copyFile(
    path.join(root, "src", "policy-client-bundle", file),
    path.join(root, "dist", "policy-client-bundle", file)
  );
}
