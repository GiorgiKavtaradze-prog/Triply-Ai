import { useCallback, useState } from "react";
import { useSSO } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import * as Sentry from "@sentry/react-native";

type SSOStrategy = "oauth_google" | "oauth_apple";
export function useSSOAuth() {
  const { startSSOFlow } = useSSO();
  const [pendingStrategy, setPendingStrategy] = useState<SSOStrategy | null>(null);

  const signInWith = useCallback(
    async (strategy: SSOStrategy) => {
      if (pendingStrategy) return;
      setPendingStrategy(strategy);
      try {
        await Sentry.startSpan(
          { name: "SSO sign-in", op: "auth.signin", attributes: { strategy } },
          async () => {
            const { createdSessionId, setActive } = await startSSOFlow({
              strategy,
              redirectUrl: AuthSession.makeRedirectUri(),
            });
            if (createdSessionId && setActive) {
              await setActive({ session: createdSessionId });
              Sentry.logger.info("User signed in", { strategy });
            }
          },
        );
      } catch (err) {
        Sentry.logger.error("SSO sign-in failed", {
          strategy,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPendingStrategy(null);
      }
    },
    [startSSOFlow, pendingStrategy],
  );

  return { signInWith, pendingStrategy };
}
