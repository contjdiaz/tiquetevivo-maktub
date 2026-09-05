/**
 * @vitest-environment jsdom
 *
 * Regression tests: qr-renderer output.
 *
 * Guards against the blank-QR regression where the bundled qrcodejs build
 * rendered a <table> with a large fixed margin (80px) that pushed the QR out
 * of the fixed-size container. The renderer must normalize the output to fit
 * the container and must NOT depend on the external qrserver.com service.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";

const publicDir = resolve(process.cwd(), "public");

/** Load qrcode.min.js + qr-renderer.js into a jsdom-backed vm sandbox. */
function makeSandbox() {
  const sandbox = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(resolve(publicDir, "js/qrcode.min.js"), "utf8"), sandbox);
  vm.runInContext(readFileSync(resolve(publicDir, "js/qr-renderer.js"), "utf8"), sandbox);
  return sandbox;
}

function render(sandbox, mode) {
  const target = sandbox.document.createElement("div");
  sandbox.document.body.appendChild(target);
  sandbox.__target = target;
  vm.runInContext(
    `window.QrRenderer.renderQr(__target, 'https://example.com/t/1003', '${mode}', 160);`,
    sandbox
  );
  return target;
}

describe("qr-renderer output (regression)", () => {
  it("renders QR content (table/canvas/img) into the container", () => {
    const sandbox = makeSandbox();
    const target = render(sandbox, "pay");
    const hasVisual =
      !!target.querySelector("table") ||
      !!target.querySelector("canvas") ||
      !!target.querySelector("img");
    expect(hasVisual).toBe(true);
  });

  it("normalizes the oversized table margin so it fits the container", () => {
    const sandbox = makeSandbox();
    const target = render(sandbox, "track");
    const table = target.querySelector("table");
    // This build renders as a table in jsdom (no canvas backend).
    expect(table).not.toBeNull();
    // The regression was margin:80px pushing the QR out of view.
    expect(table.style.margin).toBe("0px auto");
    expect(table.style.width).toBe("160px");
    expect(table.style.height).toBe("160px");
  });

  it("does NOT use the external qrserver.com fallback when the library is present", () => {
    const sandbox = makeSandbox();
    const target = render(sandbox, "pay");
    const externalImg = Array.from(target.querySelectorAll("img")).some((img) =>
      /qrserver\.com/.test(img.src || "")
    );
    expect(externalImg).toBe(false);
  });

  it("renderer source contains no external QR service URL", () => {
    const src = readFileSync(resolve(publicDir, "js/qr-renderer.js"), "utf8");
    expect(src).not.toMatch(/qrserver\.com/);
  });
});
