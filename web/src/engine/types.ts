export type ColorMode = 0 | 1 | 2; // RGB | Grayscale | Indexed

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SliceInfo {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TagInfo {
  name: string;
  from: number;
  to: number;
}

export type ToolId =
  | "pencil"
  | "eraser"
  | "fill"
  | "line"
  | "rect"
  | "ellipse"
  | "eyedropper"
  | "slice";

export interface DocumentSessionNative {
  newSprite(width: number, height: number, colorMode: number): void;
  loadAseprite(bytes: Uint8Array): boolean;
  saveAseprite(): Uint8Array | null;
  width(): number;
  height(): number;
  colorMode(): number;
  totalFrames(): number;
  frameDuration(frame: number): number;
  setFrameDuration(frame: number, ms: number): void;
  layerCount(): number;
  layerName(index: number): string;
  layerVisible(index: number): boolean;
  setLayerVisible(index: number, visible: boolean): void;
  activeLayer(): number;
  activeFrame(): number;
  setActiveLayer(index: number): void;
  setActiveFrame(frame: number): void;
  addFrame(): void;
  addLayer(name: string): void;
  renderFrame(frame: number, onionskin: boolean): Uint8ClampedArray;
  getPalette(): RgbaColor[];
  setPaletteColor(index: number, r: number, g: number, b: number, a: number): void;
  beginStroke(): void;
  endStroke(): void;
  putPixel(x: number, y: number, r: number, g: number, b: number, a: number): void;
  drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void;
  drawRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
    a: number,
    filled: boolean,
  ): void;
  drawEllipse(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number,
    g: number,
    b: number,
    a: number,
    filled: boolean,
  ): void;
  floodFill(
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
    tolerance: number,
  ): void;
  pickColor(x: number, y: number): RgbaColor;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  clearCel(): void;
  sliceCount(): number;
  addSlice(name: string, x: number, y: number, w: number, h: number): void;
  getSlices(): SliceInfo[];
  tagCount(): number;
  addTag(name: string, from: number, to: number): void;
  getTags(): TagInfo[];
  lastError(): string;
  version(): string;
  delete(): void;
}

export interface AsepriteModule {
  DocumentSession: new () => DocumentSessionNative;
  engineVersion(): string;
}
