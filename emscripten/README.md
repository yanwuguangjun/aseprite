# Aseprite WebAssembly Core

将 `doc` / `render` / `dio` / `filters` 等核心库通过 Emscripten 编译为浏览器可用的 WASM 模块，并由 `web/` 前端承载完整编辑业务。

## 依赖

- [Emscripten SDK](https://emscripten.org/)（`emcmake` / `emcc`）
- CMake ≥ 3.20、Ninja 或 Make
- 已初始化的 git submodules（`laf`、`third_party/*`、`src/undo` 等）

```bash
git submodule update --init --recursive
# 若尚未安装 emsdk：
# git clone https://github.com/emscripten-core/emsdk.git /tmp/emsdk
# cd /tmp/emsdk && ./emsdk install latest && ./emsdk activate latest
source /tmp/emsdk/emsdk_env.sh
```

## 构建

```bash
./emscripten/tools/build.sh          # Release
./emscripten/tools/build.sh Debug    # 带符号的 Debug
```

产物复制到：

- `web/public/aseprite/aseprite_core.js`
- `web/public/aseprite/aseprite_core.wasm`

冒烟测试：

```bash
node emscripten/tools/smoke.mjs
```

## Embind API（`DocumentSession`）

| 方法 | 说明 |
|------|------|
| `newSprite/loadAseprite/saveAseprite` | 文档创建与 ASE 读写 |
| `renderFrame` | 渲染到 RGBA（支持洋葱皮） |
| `putPixel/drawLine/drawRect/drawEllipse/floodFill` | 绘制 |
| `beginStroke/endStroke` + `undo/redo` | 笔画级撤销 |
| `addLayer/addFrame/addSlice/addTag` | 图层/帧/切片/标签 |
| `getPalette/setPaletteColor` | 调色板 |

## Debug

使用仓库根目录 `.vscode/launch.json`：

- `WASM: Node smoke`
- `Web: Vite Dev` / `Web: Chrome`
- `Web: Vitest`
