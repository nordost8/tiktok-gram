import { defineConfig } from "eslint/config";

import { baseConfig } from "@tiktok-gram/eslint-config/base";
import { reactConfig } from "@tiktok-gram/eslint-config/react";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
  reactConfig,
);
