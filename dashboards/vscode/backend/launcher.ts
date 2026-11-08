// What the VS Code launcher knows, as plain functions — so the backend's three routes stay thin
// and the parts worth testing (the host mapping, the manifest read, the token file) have no
// server around them. See ../README.md ("The launcher") for the whole picture.
//
// The editor is the sibling hive service (`services/vscode.yaml`): it runs in the directory of the
// project it was installed into, keeps its connection token at `.vscode-cli/connection-token`
// there, and answers on its own host. This dashboard lands in the same project (the installer
// stamps `project = "<id>"` into config.toml), which is how it finds that directory.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** `<store>/dashboards/<id>/backend` — where this file runs from. */
const HERE = import.meta.dir;
/** `<store>/dashboards/<id>` — this dashboard's own directory. */
export const DASHBOARD_DIR = resolve(HERE, "..");
/** This dashboard's id: the directory the installer minted, and the hive key its services use. */
export const DASHBOARD_ID = basename(DASHBOARD_DIR);
/** The store root: dashboards, projects, hive and marketplace are sibling directories under it. */
const STORE = resolve(DASHBOARD_DIR, "..", "..");

/** The private DNS zone this install answers on — `adi` for a release install, set by the supervisor. */
export const DOMAIN = (process.env.ADI_DOMAIN ?? "adi").trim().toLowerCase() || "adi";
/** The control panel, whose API every lookup below reads. Server-side: a page could not call it. */
export const PANEL = `http://app.${DOMAIN}`;
/** The service's published name in the bundle, and what the hive calls it unless a collision renamed it. */
export const SERVICE_NAME = "vscode";
/** Where the editor answers, as `services/vscode.yaml` declares it — the fallback when the hive has not told us yet. */
export const DEFAULT_SERVICE_HOST = `vscode-server.${DOMAIN}`;
/** The reserved zone for services on *other* adi machines: `<service>.<node>.n.adi` (docs/fleet.md). */
const FLEET_SUFFIX = ".n.adi";

export type HiveService = {
  project: string | null;
  dashboard: string | null;
  name: string;
  host: string | null;
  running: boolean;
  state?: string | null;
};

export type ServiceElement = { name: string; id: string | null; started: boolean | null };

export type Install = {
  marketplace: string;
  slug: string;
  project: string | null;
  service: ServiceElement | null;
};

export type ServiceStatus = {
  /** The hive key the service runs under — the ledger id, `vscode` unless a collision renamed it. */
  id: string;
  /** Whether its block has been copied into a hive.yaml (installed is not started). */
  started: boolean;
  /** Whether its port is answering right now. An on-demand service is usually not, until visited. */
  running: boolean;
  /** The host it answers on, or will. */
  host: string;
  /** Whether any install in this launcher's scope carries the service at all. */
  installed: boolean;
};

export type TokenSource = "secret" | "file" | "none";

export type Status = {
  dashboard: string;
  project: string | null;
  /** Whether the control panel answered. Without it, nothing about the service can be known. */
  panel: boolean;
  service: ServiceStatus | null;
  token: TokenSource;
  error: string | null;
};

/** The project this dashboard is filed under, read off the `project = "<id>"` line the installer writes. */
export function projectOf(configToml: string): string | null {
  const match = /^[ \t]*project[ \t]*=[ \t]*"([^"\n]*)"[ \t]*$/m.exec(configToml);
  const id = match?.[1].trim() ?? "";
  // A project id is one safe path segment; anything else is not a directory to go looking in.
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : null;
}

export function ownProject(): string | null {
  try {
    return projectOf(readFileSync(join(DASHBOARD_DIR, "config.toml"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Where the service runs — and so where it keeps `.vscode-cli/`. A project-scoped service runs in
 * its project's directory; a global one in the global hive's. `ADI_PROJECTS_DIR` is honoured when
 * the supervisor passes it; otherwise the projects module sits beside this dashboards module.
 */
export function serviceDir(project: string | null, store: string, projectsDir: string | null | undefined): string {
  if (project) return join(projectsDir?.trim() || join(store, "projects"), project);
  return join(store, "hive");
}

export function tokenFile(project: string | null): string {
  return join(serviceDir(project, STORE, process.env.ADI_PROJECTS_DIR), ".vscode-cli", "connection-token");
}

/**
 * The host to send the browser to. On this machine, the service's own host. Through the mesh —
 * the viewer reached this launcher as `<label>.<node>.n.adi` — the same service on the same node,
 * `<service-label>.<node>.n.adi`, which is the one address that resolves from where they sit.
 */
export function targetHost(requestHost: string | null | undefined, serviceHost: string, domain = DOMAIN): string {
  const service = serviceHost.trim().toLowerCase().replace(/\.$/, "");
  const viewer = (requestHost ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  if (viewer.endsWith(FLEET_SUFFIX)) {
    const labels = viewer.slice(0, -FLEET_SUFFIX.length).split(".");
    const node = labels.at(-1) ?? "";
    const own = service.endsWith(`.${domain}`) ? service.slice(0, -(domain.length + 1)) : service;
    if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(node) && own && !own.includes(".")) {
      return `${own}.${node}${FLEET_SUFFIX}`;
    }
  }
  return service;
}

/** The connection token as the service itself resolves it: the global secret first, then its file. */
export function readToken(project: string | null): { token: string; source: TokenSource } | null {
  const secret = secretToken();
  if (secret) return { token: secret, source: "secret" };
  const file = fileToken(tokenFile(project));
  if (file) return { token: file, source: "file" };
  return null;
}

/**
 * The token the next open will use, minting one when there is none yet. The service reuses an
 * existing `connection-token` rather than generating its own, so a token written here before the
 * first start is the token it will serve with — which is what lets a first open succeed.
 */
export function ensureToken(project: string | null): { token: string; source: TokenSource } {
  const known = readToken(project);
  if (known) return known;
  const path = tokenFile(project);
  mkdirSync(join(path, ".."), { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token, { mode: 0o600 });
  return { token, source: "file" };
}

export function tokenSource(project: string | null): TokenSource {
  return readToken(project)?.source ?? "none";
}

function secretToken(): string | null {
  try {
    const run = Bun.spawnSync(["adi-mono", "secrets", "read", "VSCODE_TOKEN"], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
      timeout: 5000,
    });
    if (run.exitCode !== 0) return null;
    const token = run.stdout.toString().trim();
    return token || null;
  } catch {
    return null;
  }
}

export function fileToken(path: string): string | null {
  try {
    if (!existsSync(path) || statSync(path).size === 0) return null;
    const token = readFileSync(path, "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
}

/** One call to the control panel's API, JSON in and out; a non-2xx answer becomes an Error with its message. */
export async function panel<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${PANEL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    // A non-JSON answer is reported below with its status.
  }
  if (!response.ok) {
    const message = typeof (data as { error?: unknown })?.error === "string" ? (data as { error: string }).error : `${response.status} from ${path}`;
    throw new Error(message);
  }
  return data as T;
}

type MarketplaceState = {
  apps: {
    marketplace: string;
    slug: string;
    bundle?: {
      installs: {
        project?: string | null;
        elements: { kind: string; name: string; id?: string | null; started?: boolean | null }[];
      }[];
    } | null;
  }[];
};

/**
 * The install this launcher came from: the bundle whose ledger, in this launcher's own scope,
 * lists this dashboard. Pure, so a test can hand it a catalog.
 */
export function installOf(state: MarketplaceState, project: string | null, dashboardId = DASHBOARD_ID): Install | null {
  for (const app of state.apps ?? []) {
    for (const copy of app.bundle?.installs ?? []) {
      if ((copy.project ?? null) !== project) continue;
      if (!copy.elements.some((element) => element.kind === "dashboards" && element.id === dashboardId)) continue;
      const service = copy.elements.find((element) => element.kind === "services") ?? null;
      return {
        marketplace: app.marketplace,
        slug: app.slug,
        project,
        service: service ? { name: service.name, id: service.id ?? null, started: service.started ?? null } : null,
      };
    }
  }
  return null;
}

export async function findInstall(project: string | null): Promise<Install | null> {
  return installOf(await panel<MarketplaceState>("/api/marketplace"), project);
}

/** The service's live row in the hive, if its block has been copied into a hive.yaml. */
export function hiveServiceOf(services: HiveService[], project: string | null, id: string): HiveService | null {
  return services.find((service) => service.dashboard === null && (service.project ?? null) === project && service.name === id) ?? null;
}

export async function findHiveService(project: string | null, id: string): Promise<HiveService | null> {
  const hive = await panel<{ services: HiveService[] }>("/api/hive");
  return hiveServiceOf(hive.services ?? [], project, id);
}

export async function status(): Promise<Status> {
  const project = ownProject();
  const result: Status = { dashboard: DASHBOARD_ID, project, panel: true, service: null, token: tokenSource(project), error: null };
  try {
    const install = await findInstall(project);
    const id = install?.service?.id ?? SERVICE_NAME;
    const live = await findHiveService(project, id);
    result.service = {
      id,
      started: live !== null || install?.service?.started === true,
      running: live?.running === true,
      host: live?.host?.trim() || DEFAULT_SERVICE_HOST,
      installed: live !== null || (install !== null && install.service !== null),
    };
  } catch (error) {
    result.panel = false;
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

/**
 * Copy the parked service live, if it still is parked. Idempotent: a service already in its
 * hive.yaml answers the same way. Refuses when no install in this scope carries the service —
 * there is nothing this launcher could start.
 */
export async function start(): Promise<Status> {
  const project = ownProject();
  const install = await findInstall(project);
  if (!install?.service) {
    throw Object.assign(
      new Error(
        "The VS Code service is not installed alongside this launcher. Install the whole bundle — or its services/vscode element — into the same project, then come back.",
      ),
      { status: 409 },
    );
  }
  if (install.service.started !== true) {
    await panel("/api/marketplace/start-service", {
      marketplace: install.marketplace,
      slug: install.slug,
      name: install.service.name,
      project: install.project,
    });
  }
  return status();
}

/**
 * The URL that opens the editor for this viewer: the service's host (mapped through the mesh when
 * the viewer came that way) with the connection token, plus VS Code's own `folder`/`workspace`
 * query, passed through when the launcher was opened with one.
 */
export function openUrl(requestHost: string | null | undefined, serviceHost: string, token: string, search: URLSearchParams, scheme = "http"): string {
  const url = new URL(`${scheme}://${targetHost(requestHost, serviceHost)}/`);
  url.searchParams.set("tkn", token);
  for (const key of ["folder", "workspace"]) {
    const value = search.get(key);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}
