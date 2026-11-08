// VS Code launcher — the frontend's entry point, kept deliberately thin.
//
// A dashboard's `frontend/index.ts` and `backend/index.ts` are its *entry points*, which the
// platform owns once the dashboard has landed: a marketplace update rewrites every other file of
// this element but never these two. So nothing here may need to change between versions — what the
// frontend serves lives in `./serve.ts`, which an update does replace, and this file only binds the
// port the hive runner leases and hands every request over.

import { serve } from "./serve";

const PORT = Number(process.env.PORT ?? process.env.PORT_HTTP ?? 8091);
const ROOT = import.meta.dir;

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  fetch: (req) => serve(req, ROOT),
});

console.log(`dashboard frontend on http://${server.hostname}:${server.port}`);
