import { describe, expect, it } from "vitest";
import { pathToView, viewToPath, type View } from "./route.ts";

describe("viewToPath", () => {
  it.each<[View, string]>([
    [{ name: "browse" }, "/"],
    [{ name: "collection", collectionName: "posts" }, "/c/posts"],
    [
      { name: "edit", documentId: "d1", collectionName: "posts" },
      "/c/posts/d1",
    ],
    [{ name: "media" }, "/media"],
    [{ name: "status" }, "/status"],
  ])("%o -> %s", (view, path) => {
    expect(viewToPath(view)).toBe(path);
  });

  it("percent-encodes names that contain slashes or spaces", () => {
    expect(viewToPath({ name: "collection", collectionName: "a/b c" })).toBe(
      "/c/a%2Fb%20c",
    );
  });
});

describe("pathToView", () => {
  it.each<[string, View]>([
    ["/", { name: "browse" }],
    ["/c/posts", { name: "collection", collectionName: "posts" }],
    [
      "/c/posts/d1",
      { name: "edit", documentId: "d1", collectionName: "posts" },
    ],
    ["/media", { name: "media" }],
    ["/status", { name: "status" }],
  ])("%s -> %o", (path, view) => {
    expect(pathToView(path)).toEqual(view);
  });

  it("decodes percent-encoded names", () => {
    expect(pathToView("/c/a%2Fb%20c")).toEqual({
      name: "collection",
      collectionName: "a/b c",
    });
  });

  it.each(["/nonsense", "/c", "/c/"])("falls back to browse for %s", (path) => {
    expect(pathToView(path)).toEqual({ name: "browse" });
  });

  it("round-trips every view through viewToPath", () => {
    const views: View[] = [
      { name: "browse" },
      { name: "collection", collectionName: "docs" },
      { name: "edit", documentId: "d2", collectionName: "docs" },
      { name: "media" },
      { name: "status" },
    ];
    for (const view of views) {
      expect(pathToView(viewToPath(view))).toEqual(view);
    }
  });
});
