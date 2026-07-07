import { sql } from "drizzle-orm";
import { db } from "@/db";
import { generationUsage } from "@/db/schema";

export const DAILY_GENERATION_CAP = 20;

export function usageDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function reserveGeneration(userId: string): Promise<boolean> {
  const day = usageDay();
  const rows = await db
    .insert(generationUsage)
    .values({ userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [generationUsage.userId, generationUsage.day],
      set: { count: sql`${generationUsage.count} + 1` },
      setWhere: sql`${generationUsage.count} < ${DAILY_GENERATION_CAP}`,
    })
    .returning({ count: generationUsage.count });

  return rows.length > 0;
}

export async function refundGeneration(userId: string, day: string): Promise<void> {
  await db
    .update(generationUsage)
    .set({ count: sql`GREATEST(${generationUsage.count} - 1, 0)` })
    .where(sql`${generationUsage.userId} = ${userId} AND ${generationUsage.day} = ${day}`);
}