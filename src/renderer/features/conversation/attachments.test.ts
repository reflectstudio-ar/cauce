// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { IMAGE_LIMITS, readAttachments, readImageFile } from "./attachments";

function imageFile(name = "photo.png", type = "image/png", bytes = 8): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("readImageFile", () => {
  it("reads an image into pi's ImageContent shape", async () => {
    const image = await readImageFile(imageFile());

    expect(image.type).toBe("image");
    expect(image.mimeType).toBe("image/png");
    expect(image.data.length).toBeGreaterThan(0);
    expect(image.data.startsWith("data:")).toBe(false);
  });
});

describe("readAttachments", () => {
  it("returns readable attachments for valid images", async () => {
    const result = await readAttachments([imageFile()], 0);

    expect("attachments" in result && result.attachments).toHaveLength(1);
    expect("attachments" in result && result.attachments[0]?.name).toBe("photo.png");
  });

  it("rejects a file that is not an image", async () => {
    expect(await readAttachments([imageFile("notes.txt", "text/plain")], 0)).toEqual({
      error: "notes.txt is not an image.",
    });
  });

  it("rejects a file over the size limit", async () => {
    const big = { name: "big.png", type: "image/png", size: IMAGE_LIMITS.maxBytes + 1 } as File;

    expect(await readAttachments([big], 0)).toEqual({ error: "big.png is larger than 5 MB." });
  });

  it("enforces the total image count", async () => {
    expect(await readAttachments([imageFile()], IMAGE_LIMITS.maxImages)).toEqual({
      error: `You can attach up to ${IMAGE_LIMITS.maxImages} images.`,
    });
  });
});
