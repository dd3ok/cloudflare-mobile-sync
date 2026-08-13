export interface Env {
  DB: D1Database;
  ALLOWED_COLLECTIONS: string;
  RETAINED_TOMBSTONE_TARGETS?: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_SECRETS?: string;
  TRUSTED_ORIGINS: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  KAKAO_CLIENT_ID?: string;
  KAKAO_CLIENT_SECRET?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  AUTH_RATE_LIMITER: RateLimit;
  SYNC_RATE_LIMITER: RateLimit;
}

export function commaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
