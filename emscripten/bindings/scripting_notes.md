# Scripting on Web

完整桌面 Lua 运行时（`ENABLE_SCRIPTING` + `src/app/script`）依赖 `app-lib`/`ui-lib`，未编入当前 WASM core。

Web 端提供等价的安全子集宿主：

- `web/src/engine/AsepriteEngine.ts` → `createScriptApi()` / `runScript()`
- 暴露：`app.sprite`、`app.color`、`app.putPixel`、`app.fill`、`app.addFrame`、`app.addLayer`、`app.undo`、`app.redo`
- 禁止：`os.execute`、文件系统任意读写、原生 Dialog

后续若要将 Lua 编入 WASM，可在 `emscripten/CMakeLists.txt` 中打开 `ENABLE_SCRIPTING` 并绑定白名单 API。
