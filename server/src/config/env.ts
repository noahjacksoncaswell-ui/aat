import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",

  s3Endpoint: process.env.S3_ENDPOINT || "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Bucket: process.env.S3_BUCKET ?? "aat-lod-documents",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",

  nwsUserAgent: process.env.NWS_USER_AGENT ?? "AAT-LOD-Platform (ops@aat-aerospace.example)",
  openWeatherMapApiKey: process.env.OPENWEATHERMAP_API_KEY || "",

  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:5173",
};

export const isS3Configured = () => Boolean(env.s3AccessKeyId && env.s3SecretAccessKey);
