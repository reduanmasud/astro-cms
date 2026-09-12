import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { uploadMedia } from "../api.ts";

/**
 * Pasting or dropping an image uploads it through the media API and inserts
 * the stored URL (docs/adr/0017-media-storage.md).
 *
 * While the bytes are in flight the editor shows a placeholder *decoration*,
 * never a node: transient state stays out of the document, so a failed upload
 * or a closed tab cannot leave a broken node in the draft — or in the Markdown
 * that is eventually published.
 */

export interface ImageUploadOptions {
  /** Stores the file and resolves with its public URL. */
  upload: (file: File) => Promise<{ url: string }>;
  onError: (message: string) => void;
}

interface PlaceholderAction {
  add?: { id: symbol; pos: number };
  remove?: { id: symbol };
}

const placeholderKey = new PluginKey<DecorationSet>("imageUploadPlaceholder");
const optionsKey = new PluginKey<ImageUploadOptions>("imageUploadOptions");

export const DEFAULT_IMAGE_UPLOAD: ImageUploadOptions = {
  upload: async (file) => (await uploadMedia(file)).media,
  onError: (message) => {
    console.error(message);
  },
};

/** The image files carried by a paste or a drop, in order. */
export function imageFilesFrom(transfer: DataTransfer | null): File[] {
  return [...(transfer?.files ?? [])].filter((file) =>
    file.type.startsWith("image/"),
  );
}

function placeholderPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: placeholderKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const moved = set.map(tr.mapping, tr.doc);
        const action = tr.getMeta(placeholderKey) as
          PlaceholderAction | undefined;
        if (action?.add) {
          const element = document.createElement("span");
          element.className = "image-placeholder";
          element.textContent = "Uploading…";
          return moved.add(tr.doc, [
            Decoration.widget(action.add.pos, element, { id: action.add.id }),
          ]);
        }
        if (action?.remove) {
          const id = action.remove.id;
          return moved.remove(moved.find(undefined, undefined, isFor(id)));
        }
        return moved;
      },
    },
    props: {
      decorations: (state) => placeholderKey.getState(state),
    },
  });
}

/** Matches the decoration standing in for one upload. */
function isFor(id: symbol): (spec: { id?: unknown }) => boolean {
  return (spec) => spec.id === id;
}

/** Where a placeholder sits now, or undefined once it is gone. */
function placeholderAt(view: EditorView, id: symbol): number | undefined {
  const set = placeholderKey.getState(view.state);
  return set?.find(undefined, undefined, isFor(id))[0]?.from;
}

/**
 * Uploads each file and inserts it where the placeholder ended up, so the
 * image lands in the right place even if the document moved meanwhile.
 */
export async function uploadImages(
  view: EditorView,
  files: readonly File[],
  pos: number,
  override?: ImageUploadOptions,
): Promise<void> {
  // One source of truth: a direct call and a paste both use what the editor
  // was configured with, unless the caller passes something else.
  const options =
    override ?? optionsKey.getState(view.state) ?? DEFAULT_IMAGE_UPLOAD;

  for (const file of files) {
    const id = Symbol(file.name);
    view.dispatch(view.state.tr.setMeta(placeholderKey, { add: { id, pos } }));

    try {
      const { url } = await options.upload(file);
      const image = view.state.schema.nodes.image;
      if (!image) throw new Error("This editor cannot show images.");

      const at = placeholderAt(view, id);
      const tr = view.state.tr.setMeta(placeholderKey, { remove: { id } });
      if (at !== undefined) {
        tr.insert(at, image.create({ src: url, alt: file.name }));
      }
      view.dispatch(tr);
    } catch (error) {
      view.dispatch(view.state.tr.setMeta(placeholderKey, { remove: { id } }));
      options.onError(
        error instanceof Error ? error.message : "The upload failed.",
      );
    }
  }
}

/** Paste and drop handlers plus the placeholder decoration. */
export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: "imageUpload",

  addOptions() {
    return DEFAULT_IMAGE_UPLOAD;
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      placeholderPlugin(),
      new Plugin<ImageUploadOptions>({
        key: optionsKey,
        state: { init: () => options, apply: (_tr, value) => value },
      }),
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            const files = imageFilesFrom(event.clipboardData);
            if (files.length === 0) return false;
            event.preventDefault();
            void uploadImages(view, files, view.state.selection.from, options);
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = imageFilesFrom(event.dataTransfer);
            if (files.length === 0) return false;
            event.preventDefault();
            const at = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            void uploadImages(
              view,
              files,
              at?.pos ?? view.state.selection.from,
              options,
            );
            return true;
          },
        },
      }),
    ];
  },
});
