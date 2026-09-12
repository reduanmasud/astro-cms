// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { editorExtensions } from "./extensions.ts";
import { imageFilesFrom, uploadImages } from "./imageUpload.ts";

function png(name = "shot.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

interface Harness {
  editor: Editor;
  errors: string[];
}

function harness(upload: (file: File) => Promise<{ url: string }>): Harness {
  const errors: string[] = [];
  const editor = new Editor({
    extensions: editorExtensions(undefined, undefined, {
      upload,
      onError: (message) => errors.push(message),
    }),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  return { editor, errors };
}

interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
}

/** Every node of a type anywhere in the document. */
function nodesOfType(editor: Editor, type: string): JsonNode[] {
  const found: JsonNode[] = [];
  const walk = (node: JsonNode): void => {
    if (node.type === type) found.push(node);
    for (const child of node.content ?? []) walk(child);
  };
  walk(editor.getJSON() as JsonNode);
  return found;
}

describe("imageFilesFrom", () => {
  it("picks out image files and ignores everything else", () => {
    const text = new File(["hello"], "notes.txt", { type: "text/plain" });
    const transfer = { files: [png(), text] } as unknown as DataTransfer;

    expect(imageFilesFrom(transfer).map((file) => file.name)).toEqual([
      "shot.png",
    ]);
  });

  it("is empty when there is nothing to take", () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom({ files: [] } as unknown as DataTransfer)).toEqual(
      [],
    );
  });
});

describe("uploadImages", () => {
  it("inserts the stored image once the upload finishes", async () => {
    const { editor } = harness(() =>
      Promise.resolve({ url: "https://media.test/media/ab/hero.png" }),
    );

    await uploadImages(editor.view, [png()], 1);

    const images = nodesOfType(editor, "image");

    expect(images).toHaveLength(1);
    expect(images[0]?.attrs?.src).toBe("https://media.test/media/ab/hero.png");
  });

  it("keeps the placeholder out of the document while uploading", async () => {
    let release = (_: { url: string }): void => undefined;
    const pending = new Promise<{ url: string }>((resolve) => {
      release = resolve;
    });
    const { editor } = harness(() => pending);

    const done = uploadImages(editor.view, [png()], 1);

    // Mid-upload: the placeholder is a decoration, so the document is still bare.
    expect(nodesOfType(editor, "image")).toEqual([]);
    expect(JSON.stringify(editor.getJSON())).not.toContain("placeholder");

    release({ url: "https://media.test/media/ab/hero.png" });
    await done;
    expect(nodesOfType(editor, "image")).toHaveLength(1);
  });

  it("inserts nothing and reports why when the upload is refused", async () => {
    const { editor, errors } = harness(() =>
      Promise.reject(
        new Error("Only PNG, JPEG, GIF, WebP, and AVIF images are accepted."),
      ),
    );

    await uploadImages(editor.view, [png()], 1);

    expect(nodesOfType(editor, "image")).toEqual([]);
    expect(errors).toEqual([
      "Only PNG, JPEG, GIF, WebP, and AVIF images are accepted.",
    ]);
  });

  it("uploads several pasted images", async () => {
    const upload = vi.fn((file: File) =>
      Promise.resolve({ url: `https://media.test/${file.name}` }),
    );
    const { editor } = harness(upload);

    await uploadImages(editor.view, [png("one.png"), png("two.png")], 1);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(nodesOfType(editor, "image")).toHaveLength(2);
  });
});
