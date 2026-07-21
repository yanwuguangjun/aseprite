# Aseprite Web

基于 WASM 核心的完整像素动画编辑器（时间轴、图层、工具、调色板、洋葱皮、切片、脚本、IndexedDB 自动保存）。

## 开发

```bash
# 先构建 WASM（如尚未生成 public/aseprite/*）
../emscripten/tools/build.sh

cd web
npm install
npm run dev
```

浏览器打开 Vite 提示的本地地址（默认 `http://localhost:5173`）。

## 脚本

```bash
npm test          # Vitest（含 WASM 引擎测试）
npm run build     # 生产构建到 dist/
```

## 功能

- 铅笔 / 橡皮 / 填充 / 直线 / 矩形 / 椭圆 / 拾色 / 切片
- 图层可见性、多帧时间轴、播放预览、洋葱皮
- 调色板、撤销重做、导出 `.aseprite`
- IndexedDB 自动保存与恢复
- JS 脚本宿主（`app.putPixel` / `app.fill` / `app.addFrame` …），作为 Lua 子集的 Web 侧入口

## Debug

见根目录 `.vscode/launch.json`。
