import type { Express, Request, Response } from "express";
import { request } from "node:https";
import { pipeline } from "node:stream";
import path from "node:path";
import { registerProgramHubLogin } from "./programHubLogin.js";

const hubHost = "srv1746493.hstgr.cloud";
const scannerPath = "/ceku-skeneris/";
const portalPath = "/programmas/";
const looperOpenPath = "/devices/io-loop/open";
const looperAccessUrl = /^https:\/\/srv1746493\.hstgr\.cloud:8443\/_access\?ticket=[A-Za-z0-9_-]{43}$/;
const launchPage = `<!doctype html>
<html lang="lv">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>UNT Programmu centrs</title>
    <script defer src="/programmas-entry.js"></script>
  </head>
  <body>
    <p><a href="${portalPath}">Atvērt programmu centru</a></p>
    <p><a href="${scannerPath}">Atvērt Čeku skeneri</a></p>
  </body>
</html>`;
const launchScript = `
  const standalone = window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  const destination = standalone ? "${scannerPath}" : "${portalPath}";
  window.location.replace(destination + window.location.search + window.location.hash);
`;

const staticPaths = new Set(["/", "/index.html", "/styles.css", "/app.js", "/catalog.js"]);
const forwardedRequestHeaders = ["range", "if-range", "if-none-match", "if-modified-since"] as const;
const forwardedResponseHeaders = [
  "accept-ranges", "cache-control", "content-disposition", "content-length", "content-range",
  "content-security-policy", "content-type", "etag", "expires", "last-modified", "referrer-policy",
  "x-content-type-options"
] as const;

export function registerProgramHub(app: Express, clientDir: string): void {
  app.get("/", (_req, res) => res.set("Cache-Control", "no-store").type("html").send(launchPage));
  app.get("/programmas-entry.js", (_req, res) =>
    res.set("Cache-Control", "no-store").type("js").send(launchScript));
  app.get(scannerPath, (_req, res) =>
    res.set("Cache-Control", "no-cache").sendFile(path.join(clientDir, "index.html")));
  app.get(/^\/programmas$/, (_req, res) => res.redirect(302, portalPath));
  const login = registerProgramHubLogin(app);
  app.use("/programmas", (req, res) => {
    const allowHead = req.path !== looperOpenPath;
    if (req.method !== "GET" && !(allowHead && req.method === "HEAD")) {
      res.set("Allow", allowHead ? "GET, HEAD" : "GET").status(405).end();
      return;
    }

    const upstreamPath = portalResource(req.path);
    if (!upstreamPath) {
      res.status(404).end();
      return;
    }
    if (upstreamPath.startsWith("/releases/public/")) {
      proxyPortal(req, res, upstreamPath);
      return;
    }

    const authorization = login.upstreamAuthorization(req);
    if (!authorization) {
      login.requireLogin(res, upstreamPath === "/" || upstreamPath === "/index.html");
      return;
    }
    proxyPortal(req, res, upstreamPath, authorization);
  });
}

function portalResource(pathname: string): string | undefined {
  if (staticPaths.has(pathname) || pathname === "/devices/io-loop/status" || pathname === looperOpenPath) {
    return pathname;
  }

  const release = /^\/releases\/(public|private)\/(.*)$/.exec(pathname);
  if (!release) return undefined;
  const [, visibility, resource] = release;

  if (resource === "index.json" || /^[a-z0-9][a-z0-9-]{0,62}\/channels\/(stable|beta)\.json$/.test(resource)) {
    return pathname;
  }
  const asset = /^([a-z0-9][a-z0-9-]{0,62})\/releases\/([^/]+)\/([^/]+)$/.exec(resource);
  if (!asset) return undefined;

  const [, app, rawVersion, rawFilename] = asset;
  try {
    const version = decodeURIComponent(rawVersion);
    const filename = decodeURIComponent(rawFilename);
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version) || !filename ||
        filename.startsWith(".") || /[\\/:\u0000-\u001f\u007f]/.test(filename)) {
      return undefined;
    }
    return `/releases/${visibility}/${app}/releases/${encodeURIComponent(version)}/${encodeURIComponent(filename)}`;
  } catch {
    return undefined;
  }
}

function proxyPortal(req: Request, res: Response, upstreamPath: string, authorization?: string): void {
  const headers: Record<string, string> = {};
  for (const name of forwardedRequestHeaders) {
    const value = req.get(name);
    if (value) headers[name] = value;
  }
  if (authorization) headers.authorization = authorization;

  const upstream = request({
    hostname: hubHost,
    port: 443,
    method: req.method,
    path: upstreamPath,
    headers,
    timeout: 30_000
  }, (response) => {
    const status = response.statusCode ?? 502;
    if (upstreamPath === looperOpenPath && status >= 300 && status < 400) {
      response.resume();
      const location = response.headers.location;
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      if (status === 303 && location && looperAccessUrl.test(location)) {
        res.status(303).set("Location", location).end();
      } else {
        res.status(502).type("text").send("IO LOOP attālināto paneli pašlaik nevar atvērt.");
      }
      return;
    }
    if (response.statusCode === 401) {
      response.resume();
      res.status(502).type("text").send("Programmu centrs pašlaik nav sasniedzams.");
      return;
    }
    res.status(status);
    for (const name of forwardedResponseHeaders) {
      const value = response.headers[name];
      if (value !== undefined) res.setHeader(name, value);
    }
    pipeline(response, res, () => undefined);
  });

  res.on("close", () => {
    if (!res.writableFinished) upstream.destroy();
  });
  upstream.on("timeout", () => upstream.destroy(new Error("Program portal upstream timed out")));
  upstream.on("error", () => {
    if (res.destroyed) return;
    if (res.headersSent) res.destroy();
    else res.status(502).type("text").send("Programmu centrs pašlaik nav sasniedzams.");
  });
  upstream.end();
}
