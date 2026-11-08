import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileToken, hiveServiceOf, installOf, openUrl, panelCandidates, panelPortOf, phaseOf, projectOf, serviceDir, targetHost } from "../backend/launcher";

describe("panelPortOf", () => {
  test("reads the panel's http lease out of the ports registry", () => {
    expect(panelPortOf({ leases: [{ service: "demo/app", key: "port", port: 8001 }, { service: "app", key: "http", port: 8000 }] })).toBe(8000);
  });
  test("anything else is no port", () => {
    expect(panelPortOf({ leases: [{ service: "app", key: "https", port: 8443 }] })).toBeNull();
    expect(panelPortOf({ leases: [{ service: "app", key: "http", port: "eighty" }] })).toBeNull();
    expect(panelPortOf({ leases: "none" })).toBeNull();
    expect(panelPortOf(null)).toBeNull();
  });
});

describe("panelCandidates", () => {
  test("tries the override, the leased loopback port, the front door by address, then the name", () => {
    expect(panelCandidates({ ADI_PANEL_URL: "http://127.0.0.1:9000/", ADI_FRONTDOOR_ADDR: "127.0.0.53" }, 8000, "adi")).toEqual([
      { base: "http://127.0.0.1:9000" },
      { base: "http://127.0.0.1:8000" },
      { base: "http://127.0.0.53", host: "app.adi" },
      { base: "http://app.adi" },
    ]);
  });
  test("with nothing but the name, the name is all there is", () => {
    expect(panelCandidates({}, null, "adi")).toEqual([{ base: "http://app.adi" }]);
  });
  test("an IPv6 front door is bracketed and a non-http override is ignored", () => {
    expect(panelCandidates({ ADI_PANEL_URL: "file:///x", ADI_FRONTDOOR_ADDR: "::1" }, null, "adi")).toEqual([
      { base: "http://[::1]", host: "app.adi" },
      { base: "http://app.adi" },
    ]);
  });
});

describe("phaseOf", () => {
  const phases = { "vscode/vscode": "running", "vscode/backend": "idle-stopped", vscode: "starting", "adi/llm-gateway": "bogus" };
  test("reads the supervisor's phase for a project service, and a global one by bare name", () => {
    expect(phaseOf(phases, "vscode", "vscode")).toBe("running");
    expect(phaseOf(phases, "vscode", "backend")).toBe("idle-stopped");
    expect(phaseOf(phases, null, "vscode")).toBe("starting");
  });
  test("anything it does not recognise is no phase", () => {
    expect(phaseOf(phases, "adi", "llm-gateway")).toBeNull();
    expect(phaseOf(phases, "other", "vscode")).toBeNull();
  });
});

describe("projectOf", () => {
  test("reads the project the installer stamped", () => {
    expect(projectOf('name = "vscode"\nproject = "vscode"\narchived_at = 1\n')).toBe("vscode");
    expect(projectOf('project = "3352a5eb-5166-4609-b164-3fe6bf1a091c"')).toBe("3352a5eb-5166-4609-b164-3fe6bf1a091c");
  });
  test("a global install has no project", () => {
    expect(projectOf('name = "vscode"\n')).toBeNull();
    expect(projectOf('project = ""')).toBeNull();
    expect(projectOf('project = "../escape"')).toBeNull();
  });
});

describe("serviceDir", () => {
  test("a project-scoped service runs in its project's directory", () => {
    expect(serviceDir("vscode", "/store", null)).toBe("/store/projects/vscode");
    expect(serviceDir("vscode", "/store", "")).toBe("/store/projects/vscode");
    expect(serviceDir("vscode", "/store", "/elsewhere/projects")).toBe("/elsewhere/projects/vscode");
  });
  test("a global service runs in the global hive's directory", () => {
    expect(serviceDir(null, "/store", "/elsewhere/projects")).toBe("/store/hive");
  });
});

describe("targetHost", () => {
  test("on this machine the editor is at the service's own host", () => {
    expect(targetHost("vscode.adi", "vscode-server.adi", "adi")).toBe("vscode-server.adi");
    expect(targetHost("127.0.0.1:8091", "vscode-server.adi", "adi")).toBe("vscode-server.adi");
    expect(targetHost(null, "vscode-server.adi", "adi")).toBe("vscode-server.adi");
  });
  test("through the mesh the editor is the same service on the same node", () => {
    expect(targetHost("vscode.studio.n.adi", "vscode-server.adi", "adi")).toBe("vscode-server.studio.n.adi");
    expect(targetHost("VSCODE.studio.n.adi:443", "vscode-server.adi", "adi")).toBe("vscode-server.studio.n.adi");
  });
  test("a host that is not one label in the zone is used as it is", () => {
    expect(targetHost("vscode.studio.n.adi", "editor.example.com", "adi")).toBe("editor.example.com");
  });
});

describe("openUrl", () => {
  test("carries the token and VS Code's own folder query", () => {
    const url = new URL(openUrl("vscode.adi", "vscode-server.adi", "abc123", new URLSearchParams("folder=/srv/app&x=1")));
    expect(url.origin).toBe("http://vscode-server.adi");
    expect(url.searchParams.get("tkn")).toBe("abc123");
    expect(url.searchParams.get("folder")).toBe("/srv/app");
    expect(url.searchParams.has("x")).toBe(false);
  });
  test("keeps https when the front door terminated TLS", () => {
    expect(openUrl("vscode.adi", "vscode-server.adi", "t", new URLSearchParams(), "https")).toBe("https://vscode-server.adi/?tkn=t");
  });
});

describe("installOf", () => {
  const state = {
    apps: [
      { marketplace: "adi", slug: "other", bundle: { installs: [{ project: "vscode", elements: [{ kind: "services", name: "redis", id: "redis", started: true }] }] } },
      {
        marketplace: "adi",
        slug: "vscode",
        bundle: {
          installs: [
            { project: null, elements: [{ kind: "services", name: "vscode", id: "vscode", started: true }, { kind: "dashboards", name: "vscode", id: "vscode" }] },
            { project: "vscode", elements: [{ kind: "services", name: "vscode", id: "vscode-2", started: false }, { kind: "dashboards", name: "vscode", id: "vscode-3" }] },
          ],
        },
      },
    ],
  };
  test("finds the install, in this launcher's scope, that landed this dashboard", () => {
    expect(installOf(state, "vscode", "vscode-3")).toEqual({ marketplace: "adi", slug: "vscode", project: "vscode", service: { name: "vscode", id: "vscode-2", started: false } });
    expect(installOf(state, null, "vscode")).toEqual({ marketplace: "adi", slug: "vscode", project: null, service: { name: "vscode", id: "vscode", started: true } });
  });
  test("another scope's install, or another bundle's, is not it", () => {
    expect(installOf(state, "vscode", "vscode")).toBeNull();
    expect(installOf(state, "other-project", "vscode-3")).toBeNull();
  });
});

describe("hiveServiceOf", () => {
  const services = [
    { project: null, dashboard: null, name: "vscode", host: "vscode-server.adi", running: false },
    { project: "vscode", dashboard: null, name: "vscode-2", host: "vscode-server.adi", running: true },
    { project: null, dashboard: "vscode", name: "frontend", host: "vscode.adi", running: true },
  ];
  test("matches the service by scope and hive key, never a dashboard's own services", () => {
    expect(hiveServiceOf(services, "vscode", "vscode-2")?.running).toBe(true);
    expect(hiveServiceOf(services, null, "vscode")?.running).toBe(false);
    expect(hiveServiceOf(services, null, "frontend")).toBeNull();
    expect(hiveServiceOf(services, "vscode", "vscode")).toBeNull();
  });
});

describe("fileToken", () => {
  test("reads a token file and treats an empty or missing one as none", () => {
    const dir = mkdtempSync(join(tmpdir(), "vscode-launcher-"));
    try {
      expect(fileToken(join(dir, "missing"))).toBeNull();
      writeFileSync(join(dir, "empty"), "");
      expect(fileToken(join(dir, "empty"))).toBeNull();
      const path = join(dir, "connection-token");
      writeFileSync(path, "deadbeef\n");
      expect(fileToken(path)).toBe("deadbeef");
      expect(statSync(path).isFile()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
