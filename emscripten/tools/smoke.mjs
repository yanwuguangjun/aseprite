import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmDir = resolve(__dirname, "../../web/public/aseprite");
const jsUrl = pathToFileURL(resolve(wasmDir, "aseprite_core.js")).href;

const mod = await import(jsUrl);
const create = mod.default;
const m = await create({
  locateFile: (p) => pathToFileURL(resolve(wasmDir, p.split("/").pop())).href,
});

const doc = new m.DocumentSession();
doc.newSprite(32, 32, 0);
doc.beginStroke();
doc.drawLine(0, 0, 31, 31, 255, 128, 0, 255);
doc.endStroke();
const rgba = doc.renderFrame(0, false);
const ase = doc.saveAseprite();
console.log(
  JSON.stringify({
    version: m.engineVersion(),
    size: [doc.width(), doc.height()],
    rgba: rgba.length,
    ase: ase.length,
    undo: doc.canUndo(),
  }),
);
doc.delete();
