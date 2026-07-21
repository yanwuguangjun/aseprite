import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearProject, loadProject, saveProject } from "../src/persist/projectStore";

describe("projectStore", () => {
  beforeEach(async () => {
    await clearProject();
  });

  it("saves and loads autosave project", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await saveProject(bytes, { name: "demo" });
    const loaded = await loadProject();
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded!.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(loaded!.savedAt).toBeTypeOf("number");
  });
});
