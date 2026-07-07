import { serve } from "inngest/edge";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

const handler = serve({ client: inngest, functions });

export function GET(request: Request) {
  return handler(request);
}

export function POST(request: Request) {
  return handler(request);
}

export function PUT(request: Request) {
  return handler(request);
}
