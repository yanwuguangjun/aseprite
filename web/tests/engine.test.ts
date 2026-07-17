import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { AsepriteEngine } from "../src/engine/AsepriteEngine";
import type { AsepriteModule } from "../src/engine/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmDir = resolve(__dirname, "../public/aseprite");

describe("AsepriteEngine WASM", () => {
  const engine = new AsepriteEngine();

  beforeAll(async () => {
    const jsPath = resolve(wasmDir, "aseprite_core.js");
    const wasmPath = resolve(wasmDir, "aseprite_core.wasm");
    // Ensure artifacts exist (built by emscripten/tools/build.sh)
    expect(readFileSync(jsPath).byteLength).toBeGreaterThan(1000);
    expect(readFileSync(wasmPath).byteLength).toBeGreaterThan(1000);

    const mod = (await import(pathToFileURL(jsPath).href)) as {
      default: (opts?: { locateFile?: (p: string) => string }) => Promise<AsepriteModule>;
    };
    const factory = mod.default;
    const native = await factory({
      locateFile: (p: string) => pathToFileURL(resolve(wasmDir, p.split("/").pop()!)).href,
    });

    // Inject initialized module via public init path by monkey-patching import is hard;
    // instead exercise native module directly and also through a thin wrapper.
    (engine as unknown as { module: AsepriteModule; session: unknown }).module = native;
    (engine as unknown as { session: unknown }).session = new native.DocumentSession();
  }, 30000);

  it("creates sprite and draws pixels", () => {
    engine.newSprite(32, 24, 0);
    expect(engine.width()).toBe(32);
    expect(engine.height()).toBe(24);
    expect(engine.totalFrames()).toBe(1);
    expect(engine.layerCount()).toBeGreaterThan(0);

    engine.color = { r: 10, g: 20, b: 30, a: 255 };
    engine.putBrush(1, 1);
    engine.endStroke();

    const rgba = engine.render(0);
    expect(rgba.length).toBe(32 * 24 * 4);
    expect(rgba[ (1 * 32 + 1) * 4 + 0 ]).toBe(10);
    expect(rgba[ (1 * 32 + 1) * 4 + 1 ]).toBe(20);
    expect(rgba[ (1 * 32 + 1) * 4 + 2 ]).toBe(30);
  });

  it("supports undo/redo and aseprite roundtrip", () => {
    engine.newSprite(16, 16, 0);
    engine.color = { r: 255, g: 0, b: 0, a: 255 };
    engine.putBrush(0, 0);
    engine.endStroke();
    expect(engine.canUndo()).toBe(true);
    engine.undo();
    expect(engine.canRedo()).toBe(true);
    engine.redo();

    const bytes = engine.saveBytes();
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(engine.loadBytes(bytes)).toBe(true);
    expect(engine.width()).toBe(16);
  });

  it("runs script host subset", () => {
    engine.newSprite(8, 8, 0);
    engine.runScript(`app.putPixel(2, 2, app.color(1, 2, 3));`);
    const c = engine.pickColor(2, 2);
    expect(c.r).toBe(1);
    expect(c.g).toBe(2);
    expect(c.b).toBe(3);
  });
});
