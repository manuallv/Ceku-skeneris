import type { Request } from "express";

export function getActor(req: Request): string {
  return req.header("x-actor") || "anonymous";
}
