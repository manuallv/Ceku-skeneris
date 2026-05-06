import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.isProduction ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.OPENAI_API_KEY",
      "*.DB_PASSWORD",
      "*.DATABASE_URL",
      "config.openAiApiKey",
      "config.databaseUrl",
      "config.db.password"
    ],
    censor: "[redacted]"
  }
});
