import type { PromptImage } from "@shared/bridge-types";

export const IMAGE_LIMITS = {
  /** pi resizes images, but the prompt still carries them base64-encoded. */
  maxImages: 4,
  maxBytes: 5 * 1024 * 1024,
} as const;

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly image: PromptImage;
}

/** Reads a picked image into pi's `ImageContent` shape (base64 + mime type). */
export async function readImageFile(file: File): Promise<PromptImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });

  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const mimeType = header.slice(header.indexOf(":") + 1, header.indexOf(";"));
  return { type: "image", data: dataUrl.slice(comma + 1), mimeType };
}

export type AttachmentResult = { readonly attachments: readonly Attachment[] } | { readonly error: string };

/**
 * Validates and reads a batch of picked files: images only, at most
 * IMAGE_LIMITS.maxImages in total, each at most IMAGE_LIMITS.maxBytes.
 * Returns the readable attachments or the first reason the batch is not
 * acceptable, so the composer can say exactly what went wrong.
 */
export async function readAttachments(files: readonly File[], existingCount: number): Promise<AttachmentResult> {
  if (existingCount + files.length > IMAGE_LIMITS.maxImages) {
    return { error: `You can attach up to ${IMAGE_LIMITS.maxImages} images.` };
  }

  const attachments: Attachment[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return { error: `${file.name} is not an image.` };
    }
    if (file.size > IMAGE_LIMITS.maxBytes) {
      return { error: `${file.name} is larger than ${Math.round(IMAGE_LIMITS.maxBytes / (1024 * 1024))} MB.` };
    }
    attachments.push({
      id: `${file.name}-${file.lastModified}-${attachments.length}`,
      name: file.name,
      image: await readImageFile(file),
    });
  }

  return { attachments };
}
