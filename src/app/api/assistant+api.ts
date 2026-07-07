import OpenAI from "openai";
import { z } from "zod";
import { db } from "@/db";
import { assistantMessages } from "@/db/schema";
import { ASSISTANT_META_SEPARATOR, type AssistantStreamMeta } from "@/lib/assistant-stream";
import { getAuthUserId, unauthorized } from "@/lib/auth";
import { serverEnv } from "@/lib/env";

const MODEL = "gpt-4o-mini";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: serverEnv.openaiApiKey });
  return client;
}

const SYSTEM_PROMPT = [
  "You are Triply's friendly AI travel companion.",
  "Help the user with anything travel-related: where to go, when to visit, what to pack,",
  "budgeting, itineraries, local tips and cultural etiquette.",
  "Keep answers concise, warm and practical. Use short paragraphs and simple bullet points",
  "(prefixed with '• ') when listing destinations or tips. Politely steer non-travel questions",
  "back to travel planning.",
].join(" ");

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

const chatSchema = z.object({
  messages: z.array(messageSchema).min(1).max(40),
});

async function persistMessage(userId: string, role: "user" | "assistant", content: string) {
  try {
    await db.insert(assistantMessages).values({ id: crypto.randomUUID(), userId, role, content });
  } catch (error) {
    console.error(`[POST /api/assistant] failed to persist ${role} message:`, error);
  }
}

export async function POST(request: Request) {
  const auth = await getAuthUserId(request);
  if (!auth.userId) return unauthorized(auth.reason);
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  let completion: Awaited<ReturnType<typeof openStream>>;
  try {
    completion = await openStream(parsed.data.messages);
  } catch (error) {
    console.error("[POST /api/assistant] chat failed:", error);
    return Response.json({ error: "Failed to reach the assistant" }, { status: 500 });
  }

  const lastMessage = parsed.data.messages[parsed.data.messages.length - 1];
  if (lastMessage?.role === "user") {
    await persistMessage(userId, "user", lastMessage.content);
  }

  const encoder = new TextEncoder();
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      let usage: OpenAI.Completions.CompletionUsage | null = null;
      let responseModel: string | null = null;
      let reply = "";
      try {
        for await (const chunk of completion) {
          if (chunk.model) responseModel = chunk.model;
          if (chunk.usage) usage = chunk.usage;
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            reply += delta;
            controller.enqueue(encoder.encode(delta));
          }
        }
        if (reply) await persistMessage(userId, "assistant", reply);
      } catch (error) {
        console.error("[POST /api/assistant] stream interrupted:", error);
      } finally {
        const meta: AssistantStreamMeta = {
          model: responseModel,
          usage: usage
            ? {
              input_tokens: usage.prompt_tokens,
              output_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens,
              cached_tokens: usage.prompt_tokens_details?.cached_tokens,
              reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens,
            }
            : null,
        };
        controller.enqueue(encoder.encode(ASSISTANT_META_SEPARATOR + JSON.stringify(meta)));
        controller.close();
      }
    },
  });

  return new Response(streamBody, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function openStream(messages: z.infer<typeof messageSchema>[]) {
  return getClient().chat.completions.create({
    model: MODEL,
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
  });
}
