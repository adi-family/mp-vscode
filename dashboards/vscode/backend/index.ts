// VS Code launcher — the backend of the `vscode` dashboard element of this bundle.
//
// The editor itself is the sibling hive service (`services/vscode.yaml`): it answers on its own
// host (`vscode-server.adi`) and refuses every request without a connection token. This backend is
// what turns that into one click from the Home grid: it knows where the service keeps its token,
// whether the service has been copied live, and how to send the browser to the right host with
// `?tkn=`. All of that is read from the control panel's own API, server-side — a page on this
// dashboard's origin could not call it (the panel refuses browser requests from other sites).
//
// Three routes, reached as /api/* on this dashboard's host (the front door forwards the path as it
// arrived, so the mount prefix is stripped here):
//   GET  /api/status  — where things stand: project, service, token source
//   POST /api/start   — copy the parked service live (idempotent; an install usually already has)
//   GET  /api/open    — 302 to the editor with the connection token; starts the service if needed
//
// A dependency-free Bun server, like every dashboard's: the hive runner injects $PORT, this process
// binds loopback only, and the page reaches it by relative URL on the one host both services share.

import { DASHBOARD_ID, DEFAULT_SERVICE_HOST, ensureToken, openUrl, ownProject, start, status } from "./launcher";

const PORT = Number(process.env.PORT ?? process.env.PORT_HTTP ?? 8092);
const API_PREFIX = "/api";

function routePath(pathname: string): string {
  if (pathname === API_PREFIX) return "/";
  if (pathname.startsWith(`${API_PREFIX}/`)) return pathname.slice(API_PREFIX.length);
  return pathname;
}

const noStore = { "cache-control": "no-store" };

function json(data: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: { "content-type": "application/json; charset=utf-8", ...noStore },
  });
}

function failure(error: unknown): Response {
  const code = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 502;
  return json({ error: error instanceof Error ? error.message : String(error) }, code);
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = routePath(url.pathname);

    if (path === "/health") return json({ ok: true, dashboard: DASHBOARD_ID, port: PORT });

    if (req.method === "GET" && path === "/status") {
      return json(await status());
    }

    if (req.method === "POST" && path === "/start") {
      try {
        return json(await start());
      } catch (error) {
        return failure(error);
      }
    }

    if (req.method === "GET" && path === "/open") {
      // Best effort on the service side: a parked service is copied live first, and a panel that
      // cannot be reached still gets a redirect to the service's declared host — the front door's
      // own pages say what is wrong there better than a JSON error here would.
      let host = DEFAULT_SERVICE_HOST;
      try {
        let current = await status();
        if (current.service?.installed && !current.service.started) current = await start();
        if (current.service?.host) host = current.service.host;
      } catch {
        // Fall through with the default host.
      }
      const { token } = ensureToken(ownProject());
      const scheme = req.headers.get("x-forwarded-proto")?.toLowerCase() === "https" ? "https" : "http";
      return new Response(null, {
        status: 302,
        headers: { location: openUrl(req.headers.get("host"), host, token, url.searchParams, scheme), ...noStore },
      });
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`dashboard ${DASHBOARD_ID} backend on http://${server.hostname}:${server.port}`);
