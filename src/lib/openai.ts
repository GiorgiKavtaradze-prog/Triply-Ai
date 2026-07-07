import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { serverEnv } from "./env";
import {
  budgetBreakdownSchema,
  daySchema,
  hotelSchema,
  type Day,
  type TripGeneration,
} from "./itinerary";

export type TripPlanModel = "gpt-4o-mini" | "gpt-4o";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: serverEnv.openaiApiKey });
  return client;
}

export type TripPlanInput = {
  destination: string;
  startDate: string;
  numDays: number;
  numTravelers: number;
  budgetTier: "budget" | "comfort" | "luxury";
  interests: string[];
  pace: string | null;
};

const BUDGET_GUIDANCE: Record<TripPlanInput["budgetTier"], string> = {
  budget: "budget-conscious: hostels/3-star stays, street food and casual eateries, mostly free or low-cost attractions",
  comfort: "mid-range: comfortable 3-4 star hotels, a mix of casual and nicer restaurants, paid attractions where worthwhile",
  luxury: "luxury: 4-5 star hotels and standout stays, fine dining, premium experiences and private tours",
};

const tripMetaSchema = z.object({
  summary: z.string(),
  hotels: z.array(hotelSchema),
  budgetBreakdown: budgetBreakdownSchema,
});
type TripMeta = z.infer<typeof tripMetaSchema>;

function addDays(startDate: string, offset: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function contextLines(input: TripPlanInput): string {
  const interestLine = input.interests.length ? input.interests.join(", ") : "general sightseeing";
  const paceLine = input.pace ? `${input.pace} pace` : "a balanced pace";
  return [
    `Destination: ${input.destination}`,
    `Travelers: ${input.numTravelers}`,
    `Budget tier: ${BUDGET_GUIDANCE[input.budgetTier]}`,
    `Interests / style: ${interestLine}`,
    `Preferred pace: ${paceLine}`,
  ].join("\n");
}

async function generateDay(
  input: TripPlanInput,
  model: TripPlanModel,
  dayNumber: number,
  date: string,
  usedPlaces: string[],
  usedTitles: string[],
): Promise<Day> {
  const system = [
    "You are an expert travel planner designing ONE day of a longer trip.",
    "Return exactly one day with 3-5 places (a mix of attractions, restaurants and activities) ordered morning → afternoon → evening.",
    "Use real, well-known places that actually exist at the destination, with accurate latitude/longitude. Keep descriptions to 1-2 sentences.",
    'Give the day a distinct, specific title tied to a neighborhood, district or theme (e.g. "Historic Asakusa & the Sumida River") — avoid generic titles like "Cultural Delights".',
  ].join("\n");

  const user = [
    contextLines(input),
    "",
    `Plan Day ${dayNumber} of ${input.numDays} (date: ${date}).`,
    usedPlaces.length
      ? `Do NOT reuse any of these places already planned on other days: ${usedPlaces.join(", ")}.`
      : "This is the first day planned so far.",
    usedTitles.length
      ? `Give this day a title clearly different from the earlier days: ${usedTitles.join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await getClient().chat.completions.parse({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: zodResponseFormat(daySchema, "itinerary_day"),
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) throw new Error(`Model refused (day ${dayNumber}): ${message.refusal}`);
  if (!message?.parsed) throw new Error(`Model returned no plan for day ${dayNumber}.`);

  return daySchema.parse(message.parsed);
}

async function generateMeta(input: TripPlanInput, model: TripPlanModel): Promise<TripMeta> {
  const system = [
    "You are an expert travel planner.",
    "Provide a one-sentence trip summary, 2-3 hotel suggestions appropriate to the budget tier (with accurate latitude/longitude), and a per-person budget breakdown in USD reflecting the budget tier and destination cost of living.",
    "Keep descriptions concise.",
  ].join("\n");

  const user = [contextLines(input), "", `Trip length: ${input.numDays} day(s).`].join("\n");

  const completion = await getClient().chat.completions.parse({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: zodResponseFormat(tripMetaSchema, "trip_meta"),
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) throw new Error(`Model refused (meta): ${message.refusal}`);
  if (!message?.parsed) throw new Error("Model returned no trip meta.");

  const meta = tripMetaSchema.parse(message.parsed);

  meta.budgetBreakdown.totalPerPerson = meta.budgetBreakdown.categories.reduce(
    (sum, category) => sum + category.amountPerPerson,
    0,
  );

  return meta;
}

export async function generateTripPlan(
  input: TripPlanInput,
  model: TripPlanModel = "gpt-4o-mini",
): Promise<TripGeneration> {
  const { startDate, numDays, destination } = input;

  const metaPromise = generateMeta(input, model);

  const days: Day[] = [];
  const usedPlaces: string[] = [];
  const usedTitles: string[] = [];
  for (let i = 0; i < numDays; i++) {
    const day = await generateDay(input, model, i + 1, addDays(startDate, i), usedPlaces, usedTitles);
    day.day = i + 1;
    days.push(day);
    usedPlaces.push(...day.places.map((p) => p.name));
    usedTitles.push(day.title);
  }

  const meta = await metaPromise;

  if (days.length !== numDays) {
    throw new Error(`Built ${days.length} day(s) but ${numDays} were requested for ${destination}.`);
  }

  return {
    itinerary: {
      summary: meta.summary,
      days,
      hotels: meta.hotels,
    },
    budgetBreakdown: meta.budgetBreakdown,
  };
}