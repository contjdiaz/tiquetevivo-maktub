import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Preserve Vitest's default excludes and additionally keep browser-based
    // Playwright specs out of the Vitest run. Playwright specs are executed
    // separately via the `playwright:check` npm script.
    exclude: [
      ...configDefaults.exclude,
      "tests/playwright/**",
      "**/*playwright*.spec.js",
    ],
  },
});
