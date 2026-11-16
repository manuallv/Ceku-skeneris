import express, { type Express, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const portalPath = "/programmas/";
const cookieName = "__Secure-unt_programmas";
const sessionDurationMs = 14 * 24 * 60 * 60 * 1000;
const allowedTabs = new Set(["#programmas", "#lejupielades", "#ierices", "#izlaidumi"]);
const derivePassword = promisify(scrypt);

type LoginSettings = {
  salt: string;
  passwordHash: string;
  sessionKey: string;
  upstreamAuthorization: string;
};

function loadSettings(): LoginSettings | undefined {
  try {
    const settings = JSON.parse(readFileSync(".program-hub-auth.json", "utf8")) as Partial<LoginSettings>;
    if (
      typeof settings.salt === "string" && /^[a-f0-9]{32}$/.test(settings.salt) &&
      typeof settings.passwordHash === "string" && /^[a-f0-9]{64}$/.test(settings.passwordHash) &&
      typeof settings.sessionKey === "string" && /^[a-f0-9]{64}$/.test(settings.sessionKey) &&
      typeof settings.upstreamAuthorization === "string" &&
      /^Basic [a-zA-Z0-9+/]{1,4000}={0,2}$/.test(settings.upstreamAuthorization)
    ) {
      return settings as LoginSettings;
    }
  } catch {
    // Scanner startup is independent of the portal credentials.
  }
  return undefined;
}

function sign(payload: string, key: string): Buffer {
  return createHmac("sha256", Buffer.from(key, "hex")).update(payload).digest();
}

function hasSession(req: Request, key: string): boolean {
  const token = req.headers.cookie?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  const match = /^(\d{13})\.([\w-]{24})\.([\w-]{43})$/.exec(token ?? "");
  if (!match || Number(match[1]) <= Date.now()) return false;
  return timingSafeEqual(sign(match[1] + "." + match[2], key), Buffer.from(match[3], "base64url"));
}

function selectedTab(tab: unknown): string {
  return typeof tab === "string" && allowedTabs.has(tab) ? tab : "";
}

function showLogin(res: Response, status = 200, message = "", tab = ""): void {
  res.set("Cache-Control", "no-store").status(status).type("html").send(`<!doctype html>
<html lang="lv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UNT Programmu centrs</title>
  <script defer src="/programmas/login-state.js"></script>
  <style>
    :root { color-scheme: dark; font: 16px/1.5 Inter, system-ui, sans-serif; background: #121319; color: #f6f6f8; }
    body { margin: 0; min-height: 100svh; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; }
    main { box-sizing: border-box; width: min(calc(100% - 2rem), 26rem); padding: clamp(1.5rem, 7vw, 2.5rem); border: 1px solid #353744; border-radius: 1rem; background: #1d1f28; }
    h1 { margin: 0 0 1.5rem; font-size: 1.45rem; font-weight: 650; }
    label { display: block; margin-bottom: .4rem; }
    input, button { box-sizing: border-box; width: 100%; min-height: 3rem; border-radius: .5rem; font: inherit; }
    input { color: inherit; background: #121319; border: 1px solid #777b91; padding: .5rem .75rem; }
    input:focus-visible, button:focus-visible { outline: 2px solid #b2beff; outline-offset: 3px; }
    button { margin-top: 1rem; border: 0; background: #aab6ff; color: #151823; font-weight: 650; cursor: pointer; }
    p { margin: 0 0 1rem; color: #ffc0ba; }
  </style>
</head>
<body>
  <main>
    <h1>UNT Programmu centrs</h1>
    ${message ? `<p role="alert">${message}</p>` : ""}
    <form action="/programmas/login" method="post">
      <label for="portal-password">Parole</label>
      <input id="portal-password" name="password" type="password" autocomplete="current-password" maxlength="128" required>
      <input id="portal-tab" name="tab" value="${tab}" type="hidden">
      <button type="submit">Ieiet</button>
    </form>
  </main>
</body>
</html>`);
}

export function registerProgramHubLogin(app: Express) {
  const settings = loadSettings();

  app.get("/programmas/login-state.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("js").send(`
      const tab = document.getElementById("portal-tab");
      if (tab && window.location.hash) tab.value = window.location.hash;
    `);
  });

  const loginLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: 6,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => showLogin(res, 429, "Par daudz mēģinājumu. Pamēģini vēlāk.")
  });

  app.post(
    "/programmas/login",
    loginLimiter,
    express.urlencoded({ extended: false, limit: "1kb", parameterLimit: 2 }),
    async (req, res) => {
      const tab = selectedTab(req.body?.tab);
      if (!settings) {
        res.set("Cache-Control", "no-store").status(503).type("text").send("Programmu centrs pašlaik nav sasniedzams.");
        return;
      }
      const password: unknown = req.body?.password;
      if (typeof password !== "string" || password.length < 1 || password.length > 128) {
        showLogin(res, 401, "Parole nav pareiza.", tab);
        return;
      }

      const hash = await derivePassword(password, Buffer.from(settings.salt, "hex"), 32) as Buffer;
      if (!timingSafeEqual(hash, Buffer.from(settings.passwordHash, "hex"))) {
        showLogin(res, 401, "Parole nav pareiza.", tab);
        return;
      }

      const payload = (Date.now() + sessionDurationMs) + "." + randomBytes(18).toString("base64url");
      const token = payload + "." + sign(payload, settings.sessionKey).toString("base64url");
      res.set("Cache-Control", "no-store").cookie(cookieName, token, {
        path: portalPath,
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        maxAge: sessionDurationMs
      }).redirect(303, portalPath + tab);
    }
  );

  return {
    upstreamAuthorization(req: Request): string | undefined {
      if (settings && hasSession(req, settings.sessionKey)) return settings.upstreamAuthorization;
      return undefined;
    },
    requireLogin(res: Response, isPage: boolean): void {
      if (!settings) {
        res.set("Cache-Control", "no-store").status(503).type("text").send("Programmu centrs pašlaik nav sasniedzams.");
      } else if (isPage) {
        showLogin(res);
      } else {
        res.set("Cache-Control", "no-store").status(401).type("text").send("Vispirms pieslēdzies programmu centrā.");
      }
    }
  };
}
