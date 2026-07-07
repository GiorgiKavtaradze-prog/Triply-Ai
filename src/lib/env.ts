function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Add it to your .env file.`);
  }
  return value;
}

export const serverEnv = {
  get databaseUrl() {
    return required("DATABASE_URL", process.env.DATABASE_URL);
  },
  get clerkSecretKey() {
    return required("CLERK_SECRET_KEY", process.env.CLERK_SECRET_KEY);
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  },
  get unsplashAccessKey() {
    return required("UNSPLASH_ACCESS_KEY", process.env.UNSPLASH_ACCESS_KEY);
  },
  get imagekitPublicKey() {
    return required("IMAGEKIT_PUBLIC_KEY", process.env.IMAGEKIT_PUBLIC_KEY);
  },
  get imagekitPrivateKey() {
    return required("IMAGEKIT_PRIVATE_KEY", process.env.IMAGEKIT_PRIVATE_KEY);
  },
  get imagekitUrlEndpoint() {
    return required("IMAGEKIT_URL_ENDPOINT", process.env.IMAGEKIT_URL_ENDPOINT);
  },
};