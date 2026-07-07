import { verifyToken } from "@clerk/backend";
import { serverEnv } from "./env";

const isDev = process.env.NODE_ENV !== "production";

export type AuthResult =
  | { userId: string; reason?: undefined }
  | { userId: null; reason: string };

export async function getAuthUserId(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, reason: "No Bearer token in Authorization header" };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return { userId: null, reason: "Empty Bearer token" };

  let secretKey: string;
  try {
    secretKey = serverEnv.clerkSecretKey;
  } catch (error) {
    return { userId: null, reason: error instanceof Error ? error.message : "Missing CLERK_SECRET_KEY" };
  }

  try {
    const payload = await verifyToken(token, { secretKey });
    if (!payload.sub) return { userId: null, reason: "Verified token has no `sub`" };
    return { userId: payload.sub };
  } catch (error) {
    return {
      userId: null,
      reason: `verifyToken failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function unauthorized(reason?: string): Response {
  if (reason) console.warn("[auth] 401:", reason);
  return Response.json(
    { error: isDev && reason ? `Unauthorized: ${reason}` : "Unauthorized" },
    { status: 401 },
  );
}