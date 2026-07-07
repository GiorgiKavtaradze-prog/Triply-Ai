import { Inngest } from "inngest";
export const inngest = new Inngest({
  id: "triply",
  isDev: true,
});

export const CLERK_USER_CREATED = "clerk/user.created" as const;
export const CLERK_USER_UPDATED = "clerk/user.updated" as const;
export const CLERK_USER_DELETED = "clerk/user.deleted" as const;
export type ClerkUserCreatedData = {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
};
export type ClerkUserUpdatedData = ClerkUserCreatedData;
export type ClerkUserDeletedData = {
  id: string;
};

export const TRIP_GENERATE = "trip/generate.requested" as const;
export type TripGenerateData = {
  tripId: string;
  userId: string;
};
