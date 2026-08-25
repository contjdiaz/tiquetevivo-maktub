import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Smoke test for .env.example placeholder values
 * Validates: Requirements 6.1, 6.2
 */
describe("Feature: security-hardening | .env.example credential hygiene", () => {
  const projectRoot = resolve(__dirname, "../..");
  const envExamplePath = resolve(projectRoot, ".env.example");
  const content = readFileSync(envExamplePath, "utf-8");

  it("ADMIN_USERNAME has an empty placeholder value (Req 6.1)", () => {
    const match = content.match(/^ADMIN_USERNAME=(.*)$/m);
    expect(match).not.toBeNull();
    expect(match[1].trim()).toBe("");
  });

  it("ADMIN_PASSWORD has an empty placeholder value (Req 6.1)", () => {
    const match = content.match(/^ADMIN_PASSWORD=(.*)$/m);
    expect(match).not.toBeNull();
    expect(match[1].trim()).toBe("");
  });

  it("contains a comment about setting strong credentials before deployment (Req 6.2)", () => {
    expect(content).toContain(
      "# IMPORTANT: Set strong, unique credentials before deployment"
    );
  });
});
