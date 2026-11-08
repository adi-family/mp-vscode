// VS Code launcher — what the frontend serves: one page, as-is, plus the static files beside it.
//
// This is a module of its own, not `index.ts`, because a dashboard's two `index.ts` entry points
// are the platform's once the dashboard has landed — a marketplace update rewrites every other file
// of the element but never those two. Anything that may need to change lives here.
//
// One dashboard is one origin. The browser reaches this page through the single hostname both hive
// services share, where the frontend owns `/` and the sibling backend owns `/api`. So nothing here
// resolves or injects an address: the page calls `/api/status` and links to `/api/open` by relative
// path, which is what lets it work unchanged at `vscode.adi`, at `vscode.<node>.n.adi` over the
// mesh, and behind a real domain later.

import { join } from "node:path";

const API_PREFIX = "/api";

/** Every request the frontend's entry point receives; `root` is the frontend directory. */
export async function serve(req: Request, root: string): Promise<Response> {
  const { pathname } = new URL(req.url);

  // The page is `launcher.html`, not `index.html`: that one is an entry-point file the platform
  // pins after landing (see the header), so it could never be updated.
  if (pathname === "/" || pathname === "/index.html") {
    return new Response(Bun.file(join(root, "launcher.html")), {
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
    const asset = Bun.file(join(root, name));
    if (await asset.exists()) return new Response(asset);
  }
  return new Response("not found", { status: 404 });
}
