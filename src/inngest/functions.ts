import { eq } from "drizzle-orm";
import { experiment, NonRetriableError } from "inngest";
import { db } from "@/db";
import { trips, users } from "@/db/schema";
import { generateTripCoverImage } from "@/lib/images";
import { generateTripPlan } from "@/lib/openai";
import { refundGeneration, usageDay } from "@/lib/usage";
import {
  CLERK_USER_CREATED,
  CLERK_USER_DELETED,
  CLERK_USER_UPDATED,
  TRIP_GENERATE,
  inngest,
  type ClerkUserCreatedData,
  type ClerkUserDeletedData,
  type ClerkUserUpdatedData,
  type TripGenerateData,
} from "./client";

export const syncUserCreated = inngest.createFunction(
  { id: "sync-user-created", triggers: [{ event: CLERK_USER_CREATED }] },
  async ({ event, step }) => {
    const { id, email, name, imageUrl } = event.data as ClerkUserCreatedData;

    await step.run("insert-user", async () => {
      await db
        .insert(users)
        .values({ id, email, name, imageUrl })
        .onConflictDoUpdate({
          target: users.id,
          set: { email, name, imageUrl, updatedAt: new Date() },
        });
    });

    return { userId: id };
  },
);

export const syncUserUpdated = inngest.createFunction(
  { id: "sync-user-updated", triggers: [{ event: CLERK_USER_UPDATED }] },
  async ({ event, step }) => {
    const { id, email, name, imageUrl } = event.data as ClerkUserUpdatedData;

    await step.run("upsert-user", async () => {
      await db
        .insert(users)
        .values({ id, email, name, imageUrl })
        .onConflictDoUpdate({
          target: users.id,
          set: { email, name, imageUrl, updatedAt: new Date() },
        });
    });

    return { userId: id };
  },
);

export const syncUserDeleted = inngest.createFunction(
  { id: "sync-user-deleted", triggers: [{ event: CLERK_USER_DELETED }] },
  async ({ event, step }) => {
    const { id } = event.data as ClerkUserDeletedData;

    await step.run("delete-user", async () => {
      await db.delete(users).where(eq(users.id, id));
    });

    return { userId: id };
  },
);
export const generateTrip = inngest.createFunction(
  {
    id: "generate-trip",
    retries: 2,
    onFailure: async ({ event, step }) => {
      const failure = event.data as {
        error?: { message?: string };
        event: { data: TripGenerateData };
      };
      const { tripId, userId } = failure.event.data;
      console.error(`[generate-trip] run failed for ${tripId}:`, failure.error?.message);
      const message = "Trip generation failed. Please try again.";

      await step.run("mark-failed", async () => {
        const [trip] = await db
          .select({ createdAt: trips.createdAt })
          .from(trips)
          .where(eq(trips.id, tripId));

        await db
          .update(trips)
          .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
          .where(eq(trips.id, tripId));

        if (trip) {
          await refundGeneration(userId, usageDay(trip.createdAt));
        }
      });
    },
    triggers: [{ event: TRIP_GENERATE }],
  },
  async ({ event, step, group }) => {
    const { tripId } = event.data as TripGenerateData;
    const trip = await step.run("set-generating", async () => {
      const [row] = await db
        .update(trips)
        .set({ status: "generating", updatedAt: new Date() })
        .where(eq(trips.id, tripId))
        .returning();
      if (!row) throw new NonRetriableError(`Trip ${tripId} not found`);
      return row;
    });
    const planInput = {
      destination: trip.destination,
      startDate: trip.startDate,
      numDays: trip.numDays,
      numTravelers: trip.numTravelers,
      budgetTier: trip.budgetTier,
      interests: trip.interests,
      pace: trip.pace,
    };
    const { result: plan } = await group.experiment("trip-plan-model", {
      variants: {
        mini: () => step.run("generate-plan-mini", () => generateTripPlan(planInput, "gpt-4o-mini")),
        full: () => step.run("generate-plan-full", () => generateTripPlan(planInput, "gpt-4o")),
      },
      select: experiment.weighted({ mini: 90, full: 10 }),
    });
    const cover = await step.run("cover-image", async () => {
      try {
        return await generateTripCoverImage(trip.destination, tripId);
      } catch (error) {
        console.error(`[generate-trip] cover image failed for ${tripId}:`, error);
        return null;
      }
    });
    await step.run("persist", async () => {
      await db
        .update(trips)
        .set({
          status: "ready",
          itinerary: plan.itinerary,
          budgetBreakdown: plan.budgetBreakdown,
          coverImageUrl: cover?.url ?? null,
          coverPhotographer: cover?.photographer ?? null,
          coverPhotographerUrl: cover?.photographerUrl ?? null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(trips.id, tripId));
    });

    return { tripId, status: "ready" };
  },
);

export const functions = [
  syncUserCreated,
  syncUserUpdated,
  syncUserDeleted,
  generateTrip,
];
