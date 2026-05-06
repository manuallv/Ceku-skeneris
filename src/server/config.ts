import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: toNumber(process.env.PORT, 3000),
  publicAppUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:5173",
  appAccessToken: process.env.APP_ACCESS_TOKEN ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",
  maxUploadBytes: toNumber(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
  localStorageDir: path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? "storage"),
  databaseUrl: process.env.DATABASE_URL ?? "",
  db: {
    host: process.env.DB_HOST ?? "",
    port: toNumber(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? "",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "",
    ssl: toBoolean(process.env.DB_SSL, false)
  },
  allowAdditiveMigrations: toBoolean(process.env.ALLOW_ADDITIVE_MIGRATIONS, false),
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  aiProvider: process.env.AI_PROVIDER ?? "openai",
  aiModel: process.env.AI_MODEL ?? "gpt-4.1-mini"
};

export type AppConfig = typeof config;
