/** At most this many pictures per message: each one costs about as much as a page of text. */
export const MAX_IMAGES = 4;
/** Bigger files are skipped. Providers cap image size around here, and so should we. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Formats vision models take. SVG, HEIC and friends get rejected, so they're skipped. */
const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** What chat/discordMessages.ts knows about each attachment. */
export interface Attachment {
  url: string;
  /** e.g. "image/png"; null when Discord doesn't know. */
  contentType: string | null;
  size: number;
}

/** The attachments worth showing the model: supported pictures, not too big, not too many. */
export function pickImages(attachments: Attachment[]): Attachment[] {
  return attachments
    .filter((a) => SUPPORTED_TYPES.includes(baseType(a.contentType)) && a.size <= MAX_IMAGE_BYTES)
    .slice(0, MAX_IMAGES);
}

/**
 * Packs a picture into a data: URL, so it travels inside the request. Discord's links are signed
 * and expire, and not every model provider can fetch them, so the picture itself goes along.
 */
export function toDataUrl(bytes: Buffer, contentType: string): string {
  return `data:${baseType(contentType)};base64,${bytes.toString('base64')}`;
}

/**
 * Downloads the pictures and returns them as data: URLs. One that fails to download is left
 * out (and logged): the rest of the message still gets answered.
 */
export async function downloadImages(
  attachments: Attachment[],
  fetchBytes: (url: string) => Promise<Buffer> = fetchAsBuffer,
): Promise<string[]> {
  const downloads = pickImages(attachments).map(async (a) => {
    try {
      return toDataUrl(await fetchBytes(a.url), a.contentType!);
    } catch (err) {
      console.error('[images] could not download a picture:', (err as Error).message);
      return null;
    }
  });
  return (await Promise.all(downloads)).filter((url): url is string => url !== null);
}

async function fetchAsBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** "IMAGE/PNG; charset=x" → "image/png". */
function baseType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}
