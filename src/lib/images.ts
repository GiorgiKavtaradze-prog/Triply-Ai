import ImageKit from "imagekit";
import { serverEnv } from "./env";

let imagekit: ImageKit | null = null;
function getImageKit(): ImageKit {
  if (!imagekit) {
    imagekit = new ImageKit({
      publicKey: serverEnv.imagekitPublicKey,
      privateKey: serverEnv.imagekitPrivateKey,
      urlEndpoint: serverEnv.imagekitUrlEndpoint,
    });
  }
  return imagekit;
}

type UnsplashPhoto = {
  sourceUrl: string;
  photographer: string;
  photographerUrl: string;
};

async function findUnsplashCover(destination: string): Promise<UnsplashPhoto | null> {
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", destination);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Client-ID ${serverEnv.unsplashAccessKey}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Unsplash search timed out");
    }
    throw error;
  }

  if (!res.ok) {
    throw new Error(`Unsplash search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    results?: {
      urls?: { regular?: string; full?: string };
      user?: { name?: string; links?: { html?: string } };
    }[];
  };

  const photo = data.results?.[0];
  const sourceUrl = photo?.urls?.regular ?? photo?.urls?.full;
  if (!sourceUrl) return null;

  return {
    sourceUrl,
    photographer: photo?.user?.name ?? "Unsplash",
    photographerUrl:
      (photo?.user?.links?.html ?? "https://unsplash.com") +
      "?utm_source=triply&utm_medium=referral",
  };
}

export type TripCover = {
  url: string;
  photographer: string;
  photographerUrl: string;
};

export async function generateTripCoverImage(
  destination: string,
  tripId: string,
): Promise<TripCover | null> {
  const photo = await findUnsplashCover(destination);
  if (!photo) return null;

  const uploaded = await getImageKit().upload({
    file: photo.sourceUrl,
    fileName: `${tripId}.jpg`,
    folder: "/triply/covers",
    useUniqueFileName: false,
  });

  return {
    url: uploaded.url,
    photographer: photo.photographer,
    photographerUrl: photo.photographerUrl,
  };
}

export async function uploadTripCover(base64: string, tripId: string): Promise<string> {
  const uploaded = await getImageKit().upload({
    file: base64,
    fileName: `${tripId}.jpg`,
    folder: "/triply/covers",
    useUniqueFileName: true,
  });

  return uploaded.url;
}