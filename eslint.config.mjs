import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/**", ".tmp/**", "node_modules/**", ".worktrees/**", "src/policy-client-bundle/**"] },
  {
    files: ["**/*.{ts,mts,cts,js,mjs,cjs}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: "error" }
  }
);
