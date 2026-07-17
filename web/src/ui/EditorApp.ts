import { engine } from "../engine/AsepriteEngine";
import type { RgbaColor, ToolId } from "../engine/types";
import {
  downloadBytes,
  loadProject,
  pickAsepriteFile,
  saveProject,
} from "../persist/projectStore";

const TOOLS: { id: ToolId; label: string }[] = [
  { id: "pencil", label: "铅笔" },
  { id: "eraser", label: "橡皮" },
  { id: "fill", label: "填充" },
  { id: "line", label: "直线" },
  { id: "rect", label: "矩形" },
  { id: "ellipse", label: "椭圆" },
  { id: "eyedropper", label: "拾色" },
  { id: "slice", label: "切片" },
];

function rgbaToHex(c: RgbaColor): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function hexToRgba(hex: string, a = 255): RgbaColor {
  const v = hex.replace("#", "");
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
    a,
  };
}

export class EditorApp {
  private root: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private statusEl!: HTMLElement;
  private zoom = 8;
  private drawing = false;
  private startX = 0;
  private startY = 0;
  private playing = false;
  private playTimer: number | null = null;
  private shapePreview: ImageData | null = null;
  private autosaveTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    this.root.innerHTML = `<div class="loading">正在加载 Aseprite WASM 引擎…</div>`;
    await engine.init("/aseprite/");
    const saved = await loadProject();
    if (saved?.bytes?.length) {
      engine.loadBytes(saved.bytes);
    } else {
      engine.newSprite(64, 64, 0);
    }
    this.mount();
    this.refreshAll();
    this.bindKeys();
    this.scheduleAutosave();
  }

  private mount(): void {
    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand">
            <h1>Aseprite Web</h1>
            <p>WebAssembly 像素动画编辑器 · ${engine.version}</p>
          </div>
          <div class="top-actions">
            <button data-action="new">新建</button>
            <button data-action="open">打开</button>
            <button data-action="save">导出 .aseprite</button>
            <button data-action="undo">撤销</button>
            <button data-action="redo">重做</button>
            <button data-action="play">播放</button>
            <label class="row"><input type="checkbox" data-action="onion" checked /> 洋葱皮</label>
          </div>
        </header>
        <main class="workspace">
          <aside class="panel" id="left-panel"></aside>
          <section class="canvas-stage" id="stage">
            <canvas id="view"></canvas>
          </section>
          <aside class="panel" id="right-panel"></aside>
        </main>
        <footer class="timeline" id="timeline"></footer>
      </div>
    `;

    this.canvas = this.root.querySelector("#view") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.ctx.imageSmoothingEnabled = false;

    this.renderLeft();
    this.renderRight();
    this.renderTimeline();
    this.bindChrome();
    this.bindCanvas();
  }

  private renderLeft(): void {
    const el = this.root.querySelector("#left-panel")!;
    el.innerHTML = `
      <h2>工具</h2>
      <div class="tool-grid" id="tools"></div>
      <div class="color-row">
        <input type="color" id="color" value="${rgbaToHex(engine.color)}" />
        <label>尺寸 <input id="brush" type="number" min="1" max="32" value="${engine.brushSize}" style="width:3.5rem" /></label>
      </div>
      <h2>图层</h2>
      <div class="panel-scroll" id="layers"></div>
      <button data-action="add-layer">+ 图层</button>
      <h2>切片</h2>
      <div class="slice-list" id="slices"></div>
    `;
    const tools = el.querySelector("#tools")!;
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.textContent = t.label;
      b.dataset.tool = t.id;
      if (engine.tool === t.id) b.classList.add("active");
      tools.appendChild(b);
    }
    this.refreshLayers();
    this.refreshSlices();
  }

  private renderRight(): void {
    const el = this.root.querySelector("#right-panel")!;
    el.innerHTML = `
      <h2>调色板</h2>
      <div class="palette" id="palette"></div>
      <h2>脚本</h2>
      <textarea class="script-box" id="script" spellcheck="false">// app API: putPixel / fill / addFrame / addLayer
app.putPixel(8, 8, app.color(255, 90, 40));
app.fill(20, 20, app.color(47, 107, 79));
</textarea>
      <button data-action="run-script">运行脚本</button>
      <p class="status" id="status">就绪</p>
    `;
    this.statusEl = el.querySelector("#status") as HTMLElement;
    this.refreshPalette();
  }

  private renderTimeline(): void {
    const el = this.root.querySelector("#timeline")!;
    el.innerHTML = `
      <button data-action="add-frame">+ 帧</button>
      <button data-action="add-tag">+ 标签</button>
      <div class="frames" id="frames"></div>
      <span class="status" id="frame-meta"></span>
    `;
    this.refreshFrames();
  }

  private bindChrome(): void {
    this.root.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      const action = t.closest("[data-action]")?.getAttribute("data-action");
      const tool = t.closest("[data-tool]")?.getAttribute("data-tool") as ToolId | null;
      const layer = t.closest("[data-layer]")?.getAttribute("data-layer");
      const frame = t.closest("[data-frame]")?.getAttribute("data-frame");

      if (tool) {
        engine.tool = tool;
        this.renderLeft();
        this.bindLeftInputs();
        return;
      }
      if (layer != null) {
        engine.setActiveLayer(Number(layer));
        this.refreshLayers();
        this.redraw();
        return;
      }
      if (frame != null) {
        engine.setActiveFrame(Number(frame));
        this.refreshFrames();
        this.redraw();
        return;
      }

      switch (action) {
        case "new": {
          const w = Number(prompt("宽度", "64") || 64);
          const h = Number(prompt("高度", "64") || 64);
          engine.newSprite(w, h, 0);
          this.refreshAll();
          break;
        }
        case "open":
          void this.openFile();
          break;
        case "save":
          void this.exportFile();
          break;
        case "undo":
          engine.undo();
          this.refreshAll();
          break;
        case "redo":
          engine.redo();
          this.refreshAll();
          break;
        case "play":
          this.togglePlay();
          break;
        case "add-layer":
          engine.addLayer(`Layer ${engine.layerCount() + 1}`);
          this.refreshLayers();
          this.redraw();
          break;
        case "add-frame":
          engine.addFrame();
          this.refreshFrames();
          this.redraw();
          break;
        case "add-tag": {
          const from = engine.activeFrame();
          const to = Math.max(from, engine.totalFrames() - 1);
          engine.addTag(`Tag ${engine.getTags().length + 1}`, from, to);
          this.setStatus(`已添加标签 ${from}-${to}`);
          break;
        }
        case "run-script":
          this.runScript();
          break;
        default:
          break;
      }
    });

    this.root.addEventListener("change", (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.matches("[data-action=onion]")) {
        engine.onionskin = t.checked;
        this.redraw();
      }
      if (t.id === "color") {
        engine.color = { ...hexToRgba(t.value), a: 255 };
      }
      if (t.id === "brush") {
        engine.brushSize = Math.max(1, Number(t.value) || 1);
      }
      if (t.matches("[data-vis]")) {
        const idx = Number(t.getAttribute("data-vis"));
        engine.setLayerVisible(idx, t.checked);
        this.redraw();
      }
    });

    this.bindLeftInputs();
  }

  private bindLeftInputs(): void {
    const color = this.root.querySelector("#color") as HTMLInputElement | null;
    const brush = this.root.querySelector("#brush") as HTMLInputElement | null;
    if (color) color.value = rgbaToHex(engine.color);
    if (brush) brush.value = String(engine.brushSize);
  }

  private bindCanvas(): void {
    const toPixel = (ev: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return {
        x: Math.floor((ev.clientX - rect.left) * scaleX),
        y: Math.floor((ev.clientY - rect.top) * scaleY),
      };
    };

    this.canvas.addEventListener("pointerdown", (ev) => {
      this.canvas.setPointerCapture(ev.pointerId);
      const { x, y } = toPixel(ev);
      this.drawing = true;
      this.startX = x;
      this.startY = y;
      this.onPointerPaint(x, y, true);
    });

    this.canvas.addEventListener("pointermove", (ev) => {
      if (!this.drawing) return;
      const { x, y } = toPixel(ev);
      this.onPointerPaint(x, y, false);
    });

    const end = (ev: PointerEvent) => {
      if (!this.drawing) return;
      this.drawing = false;
      const { x, y } = toPixel(ev);
      this.onPointerEnd(x, y);
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
  }

  private onPointerPaint(x: number, y: number, isDown: boolean): void {
    switch (engine.tool) {
      case "pencil":
      case "eraser":
        engine.putBrush(x, y);
        this.redraw();
        break;
      case "fill":
        if (isDown) {
          engine.floodFill(x, y);
          this.redraw();
        }
        break;
      case "eyedropper":
        if (isDown) {
          engine.color = engine.pickColor(x, y);
          this.bindLeftInputs();
          this.refreshPalette();
          this.setStatus(`拾色 ${rgbaToHex(engine.color)}`);
        }
        break;
      case "line":
      case "rect":
      case "ellipse":
      case "slice":
        this.previewShape(x, y);
        break;
      default:
        break;
    }
  }

  private onPointerEnd(x: number, y: number): void {
    switch (engine.tool) {
      case "pencil":
      case "eraser":
        engine.endStroke();
        this.scheduleAutosave();
        break;
      case "line":
        engine.drawLine(this.startX, this.startY, x, y);
        engine.endStroke();
        this.redraw();
        this.scheduleAutosave();
        break;
      case "rect":
        engine.drawRect(this.startX, this.startY, x, y, false);
        engine.endStroke();
        this.redraw();
        this.scheduleAutosave();
        break;
      case "ellipse":
        engine.drawEllipse(this.startX, this.startY, x, y, false);
        engine.endStroke();
        this.redraw();
        this.scheduleAutosave();
        break;
      case "slice": {
        const sx = Math.min(this.startX, x);
        const sy = Math.min(this.startY, y);
        const w = Math.abs(x - this.startX) + 1;
        const h = Math.abs(y - this.startY) + 1;
        engine.addSlice(`Slice ${engine.getSlices().length + 1}`, sx, sy, w, h);
        this.refreshSlices();
        this.redraw();
        this.scheduleAutosave();
        break;
      }
      default:
        break;
    }
    this.shapePreview = null;
  }

  private previewShape(x: number, y: number): void {
    this.redraw();
    this.ctx.save();
    this.ctx.strokeStyle = rgbaToHex(engine.color);
    this.ctx.lineWidth = 1;
    const dx = x - this.startX;
    const dy = y - this.startY;
    if (engine.tool === "line") {
      this.ctx.beginPath();
      this.ctx.moveTo(this.startX + 0.5, this.startY + 0.5);
      this.ctx.lineTo(x + 0.5, y + 0.5);
      this.ctx.stroke();
    } else if (engine.tool === "rect" || engine.tool === "slice") {
      this.ctx.strokeRect(
        Math.min(this.startX, x) + 0.5,
        Math.min(this.startY, y) + 0.5,
        Math.abs(dx),
        Math.abs(dy),
      );
    } else if (engine.tool === "ellipse") {
      this.ctx.beginPath();
      this.ctx.ellipse(
        this.startX + dx / 2,
        this.startY + dy / 2,
        Math.abs(dx / 2),
        Math.abs(dy / 2),
        0,
        0,
        Math.PI * 2,
      );
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private refreshAll(): void {
    this.refreshLayers();
    this.refreshFrames();
    this.refreshPalette();
    this.refreshSlices();
    this.redraw();
    this.setStatus(`${engine.width()}×${engine.height()} · 帧 ${engine.activeFrame() + 1}/${engine.totalFrames()}`);
  }

  private refreshLayers(): void {
    const host = this.root.querySelector("#layers");
    if (!host) return;
    host.innerHTML = "";
    for (let i = engine.layerCount() - 1; i >= 0; i--) {
      const row = document.createElement("div");
      row.className = "row";
      const vis = document.createElement("input");
      vis.type = "checkbox";
      vis.checked = engine.layerVisible(i);
      vis.setAttribute("data-vis", String(i));
      const btn = document.createElement("button");
      btn.className = "layer-item" + (engine.activeLayer() === i ? " active" : "");
      btn.dataset.layer = String(i);
      btn.textContent = engine.layerName(i) || `Layer ${i + 1}`;
      row.append(vis, btn);
      host.appendChild(row);
    }
  }

  private refreshFrames(): void {
    const host = this.root.querySelector("#frames");
    const meta = this.root.querySelector("#frame-meta");
    if (!host) return;
    host.innerHTML = "";
    for (let i = 0; i < engine.totalFrames(); i++) {
      const b = document.createElement("button");
      b.className = "frame-item" + (engine.activeFrame() === i ? " active" : "");
      b.dataset.frame = String(i);
      b.textContent = String(i + 1);
      host.appendChild(b);
    }
    if (meta) {
      meta.textContent = `时长 ${engine.frameDuration(engine.activeFrame())}ms · 标签 ${engine.getTags().length}`;
    }
  }

  private refreshPalette(): void {
    const host = this.root.querySelector("#palette");
    if (!host) return;
    host.innerHTML = "";
    const colors = engine.getPalette();
    colors.slice(0, 64).forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`;
      b.title = `#${i}`;
      b.addEventListener("click", () => {
        engine.color = c;
        this.bindLeftInputs();
      });
      host.appendChild(b);
    });
  }

  private refreshSlices(): void {
    const host = this.root.querySelector("#slices");
    if (!host) return;
    const slices = engine.getSlices();
    host.innerHTML = slices.length
      ? slices.map((s) => `<div>${s.name} (${s.x},${s.y} ${s.w}×${s.h})</div>`).join("")
      : "<div class='status'>暂无切片</div>";
  }

  private redraw(): void {
    const w = engine.width();
    const h = engine.height();
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${w * this.zoom}px`;
    this.canvas.style.height = `${h * this.zoom}px`;
    const rgba = engine.render();
    const img = new ImageData(new Uint8ClampedArray(rgba), w, h);
    this.ctx.putImageData(img, 0, 0);

    // draw slice overlays
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(196,92,38,0.9)";
    for (const s of engine.getSlices()) {
      this.ctx.strokeRect(s.x + 0.5, s.y + 0.5, Math.max(0, s.w - 1), Math.max(0, s.h - 1));
    }
    this.ctx.restore();
  }

  private async openFile(): Promise<void> {
    const file = await pickAsepriteFile();
    if (!file) return;
    const ok = await engine.loadFile(file);
    if (!ok) {
      this.setStatus("打开失败");
      return;
    }
    this.refreshAll();
    this.setStatus(`已打开 ${file.name}`);
    this.scheduleAutosave();
  }

  private async exportFile(): Promise<void> {
    try {
      const bytes = engine.saveBytes();
      await downloadBytes(bytes, "sprite.aseprite");
      await saveProject(bytes);
      this.setStatus(`已导出 ${bytes.length} bytes`);
    } catch (err) {
      this.setStatus(`导出失败: ${(err as Error).message}`);
    }
  }

  private runScript(): void {
    const box = this.root.querySelector("#script") as HTMLTextAreaElement | null;
    if (!box) return;
    try {
      engine.runScript(box.value);
      this.refreshAll();
      this.setStatus("脚本执行完成");
      this.scheduleAutosave();
    } catch (err) {
      this.setStatus(`脚本错误: ${(err as Error).message}`);
    }
  }

  private togglePlay(): void {
    if (this.playing) {
      this.playing = false;
      if (this.playTimer != null) window.clearTimeout(this.playTimer);
      this.playTimer = null;
      this.setStatus("停止播放");
      return;
    }
    this.playing = true;
    const tick = () => {
      if (!this.playing) return;
      const next = (engine.activeFrame() + 1) % engine.totalFrames();
      engine.setActiveFrame(next);
      this.refreshFrames();
      this.redraw();
      this.playTimer = window.setTimeout(tick, engine.frameDuration(next));
    };
    tick();
    this.setStatus("播放中");
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (ev) => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        if (ev.shiftKey) engine.redo();
        else engine.undo();
        this.refreshAll();
      }
      if (mod && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        engine.redo();
        this.refreshAll();
      }
      if (mod && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        void this.exportFile();
      }
      if (ev.key === "b") engine.tool = "pencil";
      if (ev.key === "e") engine.tool = "eraser";
      if (ev.key === "g") engine.tool = "fill";
      if (ev.key === "[") engine.brushSize = Math.max(1, engine.brushSize - 1);
      if (ev.key === "]") engine.brushSize = Math.min(32, engine.brushSize + 1);
      if (["b", "e", "g", "[", "]"].includes(ev.key)) {
        this.renderLeft();
        this.bindLeftInputs();
      }
    });
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer != null) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        const bytes = engine.saveBytes();
        void saveProject(bytes, {
          width: engine.width(),
          height: engine.height(),
          frames: engine.totalFrames(),
        });
      } catch {
        /* ignore autosave errors */
      }
    }, 800);
  }

  private setStatus(msg: string): void {
    if (this.statusEl) this.statusEl.textContent = msg;
  }
}
