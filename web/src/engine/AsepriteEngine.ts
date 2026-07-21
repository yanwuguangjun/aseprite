import type {
  AsepriteModule,
  DocumentSessionNative,
  RgbaColor,
  SliceInfo,
  TagInfo,
  ToolId,
} from "./types";

type Factory = (opts?: {
  locateFile?: (path: string) => string;
}) => Promise<AsepriteModule>;

export class AsepriteEngine {
  private module: AsepriteModule | null = null;
  private session: DocumentSessionNative | null = null;
  private strokeOpen = false;

  color: RgbaColor = { r: 255, g: 255, b: 255, a: 255 };
  tool: ToolId = "pencil";
  onionskin = true;
  brushSize = 1;

  async init(baseUrl = "/aseprite/"): Promise<void> {
    if (this.module) return;

    const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const jsUrl = `${normalized}aseprite_core.js`;
    const imported = (await import(/* @vite-ignore */ jsUrl)) as {
      default?: Factory;
      createAsepriteCore?: Factory;
    };
    const factory = imported.default ?? imported.createAsepriteCore;
    if (typeof factory !== "function") {
      throw new Error("createAsepriteCore factory not found");
    }

    this.module = await factory({
      locateFile: (path: string) => `${normalized}${path.split("/").pop()}`,
    });
    this.session = new this.module.DocumentSession();
  }

  get ready(): boolean {
    return !!this.session;
  }

  get version(): string {
    return this.module?.engineVersion() ?? "uninitialized";
  }

  private doc(): DocumentSessionNative {
    if (!this.session) throw new Error("Engine not initialized");
    return this.session;
  }

  newSprite(width = 64, height = 64, colorMode = 0): void {
    this.endStroke();
    this.doc().newSprite(width, height, colorMode);
  }

  async loadFile(file: File): Promise<boolean> {
    const buf = new Uint8Array(await file.arrayBuffer());
    return this.loadBytes(buf);
  }

  loadBytes(bytes: Uint8Array): boolean {
    this.endStroke();
    return this.doc().loadAseprite(bytes);
  }

  saveBytes(): Uint8Array {
    this.endStroke();
    const data = this.doc().saveAseprite();
    if (!data) throw new Error(this.doc().lastError() || "save failed");
    return data;
  }

  width(): number {
    return this.doc().width();
  }

  height(): number {
    return this.doc().height();
  }

  totalFrames(): number {
    return this.doc().totalFrames();
  }

  activeFrame(): number {
    return this.doc().activeFrame();
  }

  setActiveFrame(frame: number): void {
    this.endStroke();
    this.doc().setActiveFrame(frame);
  }

  frameDuration(frame: number): number {
    return this.doc().frameDuration(frame);
  }

  setFrameDuration(frame: number, ms: number): void {
    this.doc().setFrameDuration(frame, ms);
  }

  addFrame(): void {
    this.endStroke();
    this.doc().addFrame();
  }

  layerCount(): number {
    return this.doc().layerCount();
  }

  layerName(index: number): string {
    return this.doc().layerName(index);
  }

  layerVisible(index: number): boolean {
    return this.doc().layerVisible(index);
  }

  setLayerVisible(index: number, visible: boolean): void {
    this.doc().setLayerVisible(index, visible);
  }

  activeLayer(): number {
    return this.doc().activeLayer();
  }

  setActiveLayer(index: number): void {
    this.endStroke();
    this.doc().setActiveLayer(index);
  }

  addLayer(name: string): void {
    this.endStroke();
    this.doc().addLayer(name);
  }

  render(frame = this.activeFrame()): Uint8ClampedArray {
    return this.doc().renderFrame(frame, this.onionskin);
  }

  getPalette(): RgbaColor[] {
    return this.doc().getPalette();
  }

  setPaletteColor(index: number, color: RgbaColor): void {
    this.doc().setPaletteColor(index, color.r, color.g, color.b, color.a);
  }

  beginStroke(): void {
    if (this.strokeOpen) return;
    this.doc().beginStroke();
    this.strokeOpen = true;
  }

  endStroke(): void {
    if (!this.strokeOpen) return;
    this.doc().endStroke();
    this.strokeOpen = false;
  }

  private paintColor(): RgbaColor {
    if (this.tool === "eraser") return { r: 0, g: 0, b: 0, a: 0 };
    return this.color;
  }

  putBrush(x: number, y: number): void {
    const c = this.paintColor();
    const r = Math.max(0, Math.floor((this.brushSize - 1) / 2));
    this.beginStroke();
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        this.doc().putPixel(x + dx, y + dy, c.r, c.g, c.b, c.a);
      }
    }
  }

  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    const c = this.paintColor();
    this.beginStroke();
    this.doc().drawLine(x1, y1, x2, y2, c.r, c.g, c.b, c.a);
  }

  drawRect(x1: number, y1: number, x2: number, y2: number, filled: boolean): void {
    const c = this.paintColor();
    this.beginStroke();
    this.doc().drawRect(x1, y1, x2, y2, c.r, c.g, c.b, c.a, filled);
  }

  drawEllipse(x1: number, y1: number, x2: number, y2: number, filled: boolean): void {
    const c = this.paintColor();
    this.beginStroke();
    this.doc().drawEllipse(x1, y1, x2, y2, c.r, c.g, c.b, c.a, filled);
  }

  floodFill(x: number, y: number): void {
    const c = this.paintColor();
    this.endStroke();
    this.doc().floodFill(x, y, c.r, c.g, c.b, c.a, 0);
  }

  pickColor(x: number, y: number): RgbaColor {
    return this.doc().pickColor(x, y);
  }

  canUndo(): boolean {
    return this.doc().canUndo();
  }

  canRedo(): boolean {
    return this.doc().canRedo();
  }

  undo(): void {
    this.endStroke();
    this.doc().undo();
  }

  redo(): void {
    this.endStroke();
    this.doc().redo();
  }

  clearCel(): void {
    this.endStroke();
    this.doc().clearCel();
  }

  addSlice(name: string, x: number, y: number, w: number, h: number): void {
    this.doc().addSlice(name, x, y, w, h);
  }

  getSlices(): SliceInfo[] {
    return this.doc().getSlices();
  }

  addTag(name: string, from: number, to: number): void {
    this.doc().addTag(name, from, to);
  }

  getTags(): TagInfo[] {
    return this.doc().getTags();
  }

  /** JS scripting host (Lua-compatible subset surface) for browser scripts. */
  createScriptApi() {
    const self = this;
    return {
      sprite: {
        get width() {
          return self.width();
        },
        get height() {
          return self.height();
        },
        get totalFrames() {
          return self.totalFrames();
        },
      },
      color: (r: number, g: number, b: number, a = 255) => ({ r, g, b, a }),
      putPixel: (x: number, y: number, color: RgbaColor) => {
        self.color = color;
        self.putBrush(x, y);
        self.endStroke();
      },
      fill: (x: number, y: number, color: RgbaColor) => {
        self.color = color;
        self.floodFill(x, y);
      },
      undo: () => self.undo(),
      redo: () => self.redo(),
      addFrame: () => self.addFrame(),
      addLayer: (name: string) => self.addLayer(name),
    };
  }

  runScript(source: string): unknown {
    const api = this.createScriptApi();
    const fn = new Function("app", `"use strict";\n${source}`);
    return fn(api);
  }
}

export const engine = new AsepriteEngine();
