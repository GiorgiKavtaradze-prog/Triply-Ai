import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { trips } from "@/db/schema";
import { getAuthUserId, unauthorized } from "@/lib/auth";
import { uploadTripCover } from "@/lib/images";

const MAX_BASE64_LENGTH = Math.ceil((10 * 1024 * 1024 * 4) / 3);

const bodySchema = z.object({
  imageBase64: z.string().min(1).max(MAX_BASE64_LENGTH, "Image is too large"),
});

export async function PATCH(request: Request, { id }: Record<string, string>) {
  const auth = await getAuthUserId(request);
  if (!auth.userId) return unauthorized(auth.reason);
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)));

  if (!trip) {
    return Response.json({ error: "Trip not found" }, { status: 404 });
  }

  let coverImageUrl: string;
  try {
    coverImageUrl = await uploadTripCover(parsed.data.imageBase64, id);
  } catch (error) {
    console.error(`[PATCH /api/trips/${id}/cover] ImageKit upload failed:`, error);
    return Response.json({ error: "Failed to upload image" }, { status: 502 });
  }

  const updated = await db
    .update(trips)
    .set({
      coverImageUrl,
      coverPhotographer: null,
      coverPhotographerUrl: null,
      updatedAt: new Date(),
    })
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .returning({ id: trips.id });
    
  if (updated.length === 0) {
    return Response.json({ error: "Trip not found" }, { status: 404 });
  }

  return Response.json({ coverImageUrl });
}
