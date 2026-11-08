// VS Code launcher — the frontend of the `vscode` dashboard element: one page, served as-is.
//
// One dashboard is one origin. The hive runner injects $PORT (the port leased for
// `<dashboard>/frontend`), but the browser reaches this page through the single hostname both
// hive services share, where this server owns `/` and the sibling backend owns `/api`. So nothing
// here resolves or injects an address: the page calls `/api/status` and links to `/api/open` by
// relative path, which is what lets it work unchanged at `vscode.adi`, at `vscode.<node>.n.adi`
// over the mesh, and behind a real domain later.

import { join } from "node:path";

const PORT = Number(process.env.PORT ?? process.env.PORT_HTTP ?? 8091);
const ROOT = import.meta.dir;
const API_PREFIX = "/api";

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname === "/" || pathname === "/index.html") {
      return new Response(Bun.file(join(ROOT, "index.html")), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // `/api` belongs to the backend, and the front door routes it there — this server only ever
    // sees it when the page was opened on this process's port instead of on the dashboard's host.
    if (pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)) {
      return Response.json(
        { error: "the backend is served under /api on this dashboard's host", hint: "open the dashboard by hostname (its .adi name), not by port" },
        { status: 404 },
      );
    }

    // Anything else: a static file from this directory, confined to one safe path segment.
    const name = pathname.replace(/^\/+/, "");
    if (/^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".")) {
      const asset = Bun.file(join(ROOT, name));
      if (await asset.exists()) return new Response(asset);
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`dashboard frontend on http://${server.hostname}:${server.port}`);
