import { ConvexHttpClient } from "convex/browser";

let client: ConvexHttpClient | null = null;

export function getConvexClient(): ConvexHttpClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error(
        "CONVEX_URL environment variable is not set. Run `npx convex dev` to set up your Convex deployment."
      );
    }
    client = new ConvexHttpClient(url);
  }
  return client;
}
