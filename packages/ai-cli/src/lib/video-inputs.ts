import type { experimental_generateVideo as generateVideo } from "ai";

import { loadImageReferences } from "./image-references.js";
import { isObject, readJson } from "./media-options.js";

type VideoOptions = Parameters<typeof generateVideo>[0];

export async function readFrameImages(
  path: string
): Promise<VideoOptions["frameImages"]> {
  const value = await readJson(path, "frame-images");
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("--frame-images must contain a nonempty JSON array");
  const seen = new Set<string>();
  return Promise.all(
    value.map(async (frame) => {
      if (
        !isObject(frame) ||
        typeof frame.image !== "string" ||
        !["first_frame", "last_frame"].includes(String(frame.frameType))
      ) {
        throw new Error(
          '--frame-images entries must be { "image": "path-or-url", "frameType": "first_frame" | "last_frame" }'
        );
      }
      const frameType = frame.frameType as "first_frame" | "last_frame";
      if (seen.has(frameType))
        throw new Error(`--frame-images contains duplicate ${frameType}`);
      seen.add(frameType);
      return {
        frameType,
        image: (await loadImageReferences([frame.image], "frame-images"))[0]!,
      };
    })
  );
}

export async function readInputReferences(
  path: string
): Promise<VideoOptions["inputReferences"]> {
  const value = await readJson(path, "input-references");
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("--input-references must contain a nonempty JSON array");
  return Promise.all(
    value.map(async (reference) => {
      if (typeof reference === "string")
        return (await loadImageReferences([reference], "input-references"))[0]!;
      if (
        !isObject(reference) ||
        typeof reference.data !== "string" ||
        (reference.mediaType !== undefined &&
          (typeof reference.mediaType !== "string" ||
            !/^(image|video)\/[^\s/]+$/.test(reference.mediaType)))
      ) {
        throw new Error(
          '--input-references entries must be paths/URLs or { "data": "path-or-url", "mediaType": "video/mp4" }'
        );
      }
      return {
        data: (
          await loadImageReferences([reference.data], "input-references")
        )[0]!,
        mediaType: reference.mediaType as string | undefined,
      };
    })
  );
}
