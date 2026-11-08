// VS Code launcher — the backend's entry point, kept deliberately thin.
//
// `frontend/index.ts` and `backend/index.ts` are a dashboard's *entry points*, which the platform
// owns once a dashboard has landed: a marketplace update rewrites every other file of this element
// but never these two (they are what the panel restamps when its own templates move). So nothing
// here may need to change between versions — the whole launcher lives in `./launcher.ts`, which an
// update does replace, and this file only binds the port the hive runner leases and hands every
// request over.
//
// A dependency-free Bun server, like every dashboard's: loopback only, on $PORT; the page reaches it
// by relative URL on the one host both of the dashboard's services share.

import { DASHBOARD_ID, handleRequest } from "./launcher";

const PORT = Number(process.env.PORT ?? process.env.PORT_HTTP ?? 8092);

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: (req) => handleRequest(req),
});

console.log(`dashboard ${DASHBOARD_ID} backend on http://${server.hostname}:${server.port}`);
