import { z } from "zod";

export const placeKindEnum = z.enum(["attraction", "restaurant", "activity"]);

export const placeSchema = z.object({
  name: z.string(),
  kind: placeKindEnum,
  description: z.string(),
  timeOfDay: z.enum(["morning", "afternoon", "evening"]),
  latitude: z.number(),
  longitude: z.number(),
});

export const daySchema = z.object({
  day: z.number().int(),
  title: z.string(),
  summary: z.string(),
  places: z.array(placeSchema),
});

export const hotelSchema = z.object({
  name: z.string(),
  description: z.string(),
  priceEstimate: z.string(),
  latitude: z.number(),
  longitude: z.number(),
});

export const itinerarySchema = z.object({
  summary: z.string(),
  days: z.array(daySchema),
  hotels: z.array(hotelSchema),
});

export const budgetCategorySchema = z.object({
  name: z.string(),
  amountPerPerson: z.number(),
  note: z.string(),
});

export const budgetBreakdownSchema = z.object({
  currency: z.string(),
  totalPerPerson: z.number(),
  categories: z.array(budgetCategorySchema),
});

export const tripGenerationSchema = z.object({
  itinerary: itinerarySchema,
  budgetBreakdown: budgetBreakdownSchema,
});

export type Place = z.infer<typeof placeSchema>;
export type Day = z.infer<typeof daySchema>;
export type Hotel = z.infer<typeof hotelSchema>;
export type Itinerary = z.infer<typeof itinerarySchema>;
export type BudgetBreakdown = z.infer<typeof budgetBreakdownSchema>;
export type TripGeneration = z.infer<typeof tripGenerationSchema>;