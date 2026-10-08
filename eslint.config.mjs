import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // One place constructs the AI client, wrapped so every call is traced.
  // Anything else reaching for the SDK would make an untraced call possible.
  {
    ignores: ["lib/ai/client.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["openai", "openai/*", "langsmith/wrappers", "langsmith/wrappers/*"],
              message: "Call the model through lib/ai/client.ts, which traces every call.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
