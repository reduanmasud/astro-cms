import { describe, expect, it } from "vitest";
import { resolveAssetSrc } from "./assetSrc.ts";

describe("resolveAssetSrc", () => {
  it("passes absolute URLs through unchanged", () => {
    expect(
      resolveAssetSrc(
        "https://media.example.com/foo.png",
        "src/content/blog/hello.md",
      ),
    ).toBe("https://media.example.com/foo.png");
  });

  it("passes protocol-relative URLs through unchanged", () => {
    expect(
      resolveAssetSrc("//cdn.example.com/foo.png", "src/content/blog/hello.md"),
    ).toBe("//cdn.example.com/foo.png");
  });

  it("passes data URLs through unchanged", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    expect(resolveAssetSrc(dataUrl, "src/content/blog/hello.md")).toBe(dataUrl);
  });

  it("resolves a root-relative path against the repository root", () => {
    expect(
      resolveAssetSrc("/images/hero.png", "src/content/blog/hello.md"),
    ).toBe("/api/repo-asset?path=images%2Fhero.png");
  });

  it("resolves a content-relative path against the document's own directory", () => {
    expect(resolveAssetSrc("./hero.png", "src/content/blog/hello.md")).toBe(
      "/api/repo-asset?path=src%2Fcontent%2Fblog%2Fhero.png",
    );
  });

  it("resolves a bare filename the same way as ./filename", () => {
    expect(resolveAssetSrc("hero.png", "src/content/blog/hello.md")).toBe(
      "/api/repo-asset?path=src%2Fcontent%2Fblog%2Fhero.png",
    );
  });

  it("walks up with ..", () => {
    expect(
      resolveAssetSrc("../assets/hero.png", "src/content/blog/2026/hello.md"),
    ).toBe("/api/repo-asset?path=src%2Fcontent%2Fblog%2Fassets%2Fhero.png");
  });

  it("never escapes above the repository root", () => {
    expect(
      resolveAssetSrc("../../../../etc/passwd", "src/content/blog/hello.md"),
    ).toBe("/api/repo-asset?path=etc%2Fpasswd");
  });
});
