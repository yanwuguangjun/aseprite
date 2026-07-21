import "./styles.css";
import { EditorApp } from "./ui/EditorApp";

const root = document.querySelector("#app");
if (!root) {
  throw new Error("#app missing");
}

const app = new EditorApp(root as HTMLElement);
app.start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  (root as HTMLElement).innerHTML = `<div class="loading">加载失败：${message}</div>`;
  console.error(err);
});
