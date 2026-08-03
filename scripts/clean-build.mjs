import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await rm(path.join(repoRoot, "dist"), { recursive: true, force: true });
