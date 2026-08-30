import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@tiktok-gram/eslint-config/base";
import { nextjsConfig } from "@tiktok-gram/eslint-config/nextjs";
import { reactConfig } from "@tiktok-gram/eslint-config/react";

export default defineConfig(
  { ignores: [".next/**"] },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);
