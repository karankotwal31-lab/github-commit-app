/**
 * Minimal ambient types for the `web-push` package (it ships no types).
 * Only the surface Aria uses is declared.
 */
declare module "web-push" {
  interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  interface VapidDetails {
    subject: string;
    publicKey: string;
    privateKey: string;
  }

  interface RequestOptions {
    vapidDetails?: VapidDetails;
    TTL?: number;
    headers?: Record<string, string>;
  }

  interface WebPush {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
    sendNotification(
      subscription: PushSubscription,
      payload?: string | Buffer,
      options?: RequestOptions,
    ): Promise<unknown>;
  }

  const webpush: WebPush;
  export default webpush;
}
