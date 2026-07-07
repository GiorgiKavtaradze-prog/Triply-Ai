import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { trips } from "@/db/schema";
import { getAuthUserId, unauthorized } from "@/lib/auth";

export async function GET(request: Request, { id }: Record<string, string>) {
  const auth = await getAuthUserId(request);
  if (!auth.userId) return unauthorized(auth.reason);
  const userId = auth.userId;

  const [trip] = await db
    .select({ status: trips.status, errorMessage: trips.errorMessage })
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)));

  if (!trip) {
    return Response.json({ error: "Trip not found" }, { status: 404 });
  }

  return Response.json(trip);
}
