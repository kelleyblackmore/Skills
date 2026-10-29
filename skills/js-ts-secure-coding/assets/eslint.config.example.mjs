// ESLint flat config. Install the latest of each:
//   npm i -D eslint @eslint/js globals typescript typescript-eslint eslint-plugin-security
//   (and @types/node for Node code)
import js from "@eslint/js";
import globals from "globals";
import security from "eslint-plugin-security";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", "build/", "coverage/", "node_modules/"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      // Node globals (process, console, Buffer). For code that runs in a
      // browser, add a block with `files` for those paths and globals.browser.
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": "allow-with-description", "ts-ignore": true },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
