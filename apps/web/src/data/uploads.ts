import { useApp } from "../state/app.js";
import { ApiError } from "./account.js";
import { serverBaseUrl } from "./server.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function toDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the image"));
    reader.readAsDataURL(file);
  });
}

/**
 * Store an image and return the address to use in the document: uploaded to the server's object
 * storage when signed in, otherwise embedded (the document only lives on this device anyway).
 */
export async function storeImage(file: Blob): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, "too_large", "Images can be up to 10 MB.");
  if (!useApp.getState().account) return toDataUrl(file);
  const res = await fetch(`${serverBaseUrl()}/api/uploads`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": file.type || "application/octet-stream", "x-vellum-upload": "1" },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; code?: string; message?: string };
  if (!res.ok || !data.url)
    throw new ApiError(res.status, data.code ?? "upload_failed", data.message ?? "Upload failed.");
  return data.url;
}

/** Replace embedded images in Markdown with uploaded ones (used by importers when signed in). */
export async function uploadEmbeddedImages(markdown: string): Promise<string> {
  if (!useApp.getState().account) return markdown;
  const re = /!\[([^\]]*)\]\((data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+))\)/g;
  const found = [...markdown.matchAll(re)];
  let out = markdown;
  for (const m of found) {
    try {
      const bytes = Uint8Array.from(atob(m[4]!), (c) => c.charCodeAt(0));
      const url = await storeImage(new Blob([bytes], { type: m[3]! }));
      out = out.replace(m[2]!, url);
    } catch {
      // Keep it embedded if the upload fails.
    }
  }
  return out;
}
