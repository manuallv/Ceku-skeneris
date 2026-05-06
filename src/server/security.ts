import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { AppError } from "./errors.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function protectedMode(req: Request, _res: Response, next: NextFunction) {
  if (!config.appAccessToken || config.appAccessToken === "change-me-for-protected-mode") {
    return next();
  }

  const header = req.header("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
  const xToken = req.header("x-app-access-token") ?? "";
  const queryToken = typeof req.query.access_token === "string" ? req.query.access_token : "";
  const token = bearer || xToken || queryToken;

  if (token === config.appAccessToken) return next();
  if (safeMethods.has(req.method)) {
    throw new AppError(401, "protected_mode", "Nepieciešama piekļuves atslēga.");
  }
  throw new AppError(401, "protected_mode", "Darbībai nepieciešama piekļuves atslēga.");
}

export function getActor(req: Request): string {
  return req.header("x-actor") || "protected-user";
}
