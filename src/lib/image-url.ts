export function optimizedImage(
  url: string | null | undefined,
  width = 1200,
  quality = 80,
): string | undefined {
  if (!url) return undefined;
  if (!url.includes("ik.imagekit.io")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}tr=w-${width},q-${quality},f-auto`;
}