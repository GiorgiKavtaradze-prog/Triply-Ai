import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import { ASSISTANT_META_SEPARATOR, type AssistantStreamMeta } from "@/lib/assistant-stream";
import type { Trip } from "@/db/schema";
import type { TripStatus } from "@/lib/trip-status";

type GetToken = () => Promise<string | null>;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function authedFetch(
  getToken: GetToken,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const method = init?.method ?? "GET";
  return Sentry.startSpan(
    {
      name: `${method} ${path}`,
      op: "http.client",
      attributes: {
        "http.request.method": method,
        "server.address": path,
      },
    },
    async (span) => {
      const token = await getToken();
      const res = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });

      span.setAttribute("http.response.status_code", res.status);

      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
        }
        const log = res.status >= 500 ? Sentry.logger.error : Sentry.logger.warn;
        log("API request failed", {
          endpoint: path,
          method,
          status: res.status,
          message,
        });

        throw new ApiError(message, res.status);
      }

      return res;
    },
  );
}

export type CreateTripInput = {
  destination: string;
  startDate: string;
  numDays: number;
  numTravelers: number;
  budgetTier: "budget" | "comfort" | "luxury";
  interests: string[];
  pace: string | null;
};

export async function createTrip(
  getToken: GetToken,
  input: CreateTripInput,
): Promise<{ id: string; status: TripStatus }> {
  const res = await authedFetch(getToken, "/api/trips", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.json();
}

export type TripSummary = Pick<
  Trip,
  "id" | "destination" | "numDays" | "status" | "coverImageUrl" | "budgetBreakdown" | "createdAt"
>;

export async function listTrips(getToken: GetToken): Promise<TripSummary[]> {
  const res = await authedFetch(getToken, "/api/trips");
  const data = (await res.json()) as { trips: TripSummary[] };
  return data.trips;
}
export async function getTripStatus(
  getToken: GetToken,
  id: string,
): Promise<{ status: TripStatus; errorMessage: string | null }> {
  const res = await authedFetch(getToken, `/api/trips/${id}/status`);
  return res.json();
}

export async function getTrip(getToken: GetToken, id: string): Promise<Trip> {
  const res = await authedFetch(getToken, `/api/trips/${id}`);
  return res.json();
}

export async function deleteTrip(getToken: GetToken, id: string): Promise<void> {
  await authedFetch(getToken, `/api/trips/${id}`, { method: "DELETE" });
}

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

const ASSISTANT_AGENT_NAME = "Travel Companion";
const ASSISTANT_MODEL = "gpt-4o-mini";
const ASSISTANT_PROVIDER = "openai";

function apiUrl(path: string): string {
  const origin =
    (globalThis as { location?: { origin?: string } }).location?.origin ??
    (Constants.expoConfig?.hostUri ? `http://${Constants.expoConfig.hostUri}` : null);
  return origin ? new URL(path, origin).toString() : path;
}

function toGenAiMessages(messages: AssistantMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    parts: [{ type: "text", content: m.content }],
  }));
}

function applyStreamMeta(span: Sentry.Span, meta: AssistantStreamMeta) {
  if (meta.model) span.setAttribute("gen_ai.response.model", meta.model);
  const u = meta.usage;
  if (!u) return;
  if (u.input_tokens != null) span.setAttribute("gen_ai.usage.input_tokens", u.input_tokens);
  if (u.output_tokens != null) span.setAttribute("gen_ai.usage.output_tokens", u.output_tokens);
  if (u.total_tokens != null) span.setAttribute("gen_ai.usage.total_tokens", u.total_tokens);
  if (u.cached_tokens != null) {
    span.setAttribute("gen_ai.usage.input_tokens.cached", u.cached_tokens);
  }
  if (u.reasoning_tokens != null) {
    span.setAttribute("gen_ai.usage.output_tokens.reasoning", u.reasoning_tokens);
  }
}

export async function streamAssistantMessage(
  getToken: GetToken,
  messages: AssistantMessage[],
  onDelta: (delta: string) => void,
): Promise<void> {
  return Sentry.startSpan(
    {
      op: "gen_ai.invoke_agent",
      name: `invoke_agent ${ASSISTANT_AGENT_NAME}`,
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.provider.name": ASSISTANT_PROVIDER,
        "gen_ai.agent.name": ASSISTANT_AGENT_NAME,
        "gen_ai.request.model": ASSISTANT_MODEL,
        "gen_ai.response.streaming": true,
        "gen_ai.input.messages": JSON.stringify(toGenAiMessages(messages)),
      },
    },
    async (span) => {
      const startedAt = Date.now();
      const token = await getToken();
      const res = await expoFetch(apiUrl("/api/assistant"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages }),
      });

      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
        }
        Sentry.logger.warn("Assistant stream failed", { status: res.status, message });
        throw new ApiError(message, res.status);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new ApiError("The assistant returned no response stream", 502);

      const decoder = new TextDecoder();
      let reply = "";
      let metaJson = "";
      let inMeta = false;
      let firstTokenAt: number | null = null;

      const consume = (text: string) => {
        if (!text) return;
        if (inMeta) {
          metaJson += text;
          return;
        }
        const sep = text.indexOf(ASSISTANT_META_SEPARATOR);
        const replyPart = sep === -1 ? text : text.slice(0, sep);
        if (replyPart) {
          if (firstTokenAt === null) {
            firstTokenAt = Date.now();
            span.setAttribute("gen_ai.response.time_to_first_token", (firstTokenAt - startedAt) / 1000);
          }
          reply += replyPart;
          onDelta(replyPart);
        }
        if (sep !== -1) {
          inMeta = true;
          metaJson += text.slice(sep + ASSISTANT_META_SEPARATOR.length);
        }
      };

      try {
        for (; ;) {
          const { done, value } = await reader.read();
          if (done) break;
          consume(decoder.decode(value, { stream: true }));
        }
        consume(decoder.decode());
      } finally {
        reader.releaseLock();
      }

      span.setAttribute(
        "gen_ai.output.messages",
        JSON.stringify([{ role: "assistant", parts: [{ type: "text", content: reply }] }]),
      );

      if (metaJson) {
        try {
          applyStreamMeta(span, JSON.parse(metaJson) as AssistantStreamMeta);
        } catch {
        }
      }
    },
  );
}

export type StoredAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export async function getAssistantMessages(
  getToken: GetToken,
): Promise<StoredAssistantMessage[]> {
  const res = await authedFetch(getToken, "/api/assistant/messages");
  const data = (await res.json()) as { messages: StoredAssistantMessage[] };
  return data.messages;
}

export async function clearAssistantMessages(getToken: GetToken): Promise<void> {
  await authedFetch(getToken, "/api/assistant/messages", { method: "DELETE" });
}

export async function updateTripCover(
  getToken: GetToken,
  id: string,
  imageBase64: string,
): Promise<{ coverImageUrl: string }> {
  const res = await authedFetch(getToken, `/api/trips/${id}/cover`, {
    method: "PATCH",
    body: JSON.stringify({ imageBase64 }),
  });
  return res.json();
}