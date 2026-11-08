# VS Code

A full VS Code in the browser, proxied behind the front door — Microsoft's own `code serve-web`,
the same CLI VS Code itself ships, pinned to one commit and sha256-verified before it ever runs.
No Rust, no binary checked into this repo: the CLI is fetched from Microsoft at first start.

This bundle carries three elements:

| kind | name | what it is |
|---|---|---|
| dashboard | `vscode` | the launcher: a tile on the Home grid at `vscode.adi` that starts the editor and opens it with its connection token |
| service | `vscode` | the hive service that fetches, verifies and runs `code serve-web`, at `vscode-server.adi` |
| project | VS Code | the project scaffold both are recommended to file under |

Install into a project of its own:

```sh
adi-mono marketplace install <marketplace>/vscode --new-project "VS Code"
```

That lands all three. The service is copied live in the same act (it is **on-demand**: nothing
runs until the first visit — see "Launching it"); the launcher arrives archived, like every
dashboard, and is started with:

```sh
adi-mono marketplace start vscode        # the launcher's dashboard id, as `marketplace apps` lists it
```

or from its row on the Dashboards page. If you installed with `--no-start`, the service is started
by the launcher's first "Open", or by hand:

```sh
adi-mono marketplace start <marketplace>/vscode/services/vscode --project <id>
```

## Launching it

Once the launcher is started, VS Code is a tile on the Home grid of the control panel
(`app.adi`), the same as any other app on the machine. Opening the tile:

1. loads the launcher at `http://vscode.adi/`, which asks the control panel where the service
   stands — installed, copied live, answering;
2. if the editor is already running, hands you straight over to it; otherwise shows one button,
   **Open VS Code**, and says what opening it will do (a first start downloads the editor and
   accepts the licence below);
3. `/api/open` copies the service live if it is still parked, resolves the connection token the
   same way the service itself does (next section) — minting and writing one if there is none yet,
   so the first start serves with a token the launcher already knows — and answers a `302` to
   `https://vscode-server.adi/?tkn=<token>`;
4. the front door sees the visit, wakes the on-demand service, and holds the page ("Starting this
   service for you", reloading every two seconds) until the editor answers, then becomes it.

Through the mesh the same launcher at `vscode.<node>.n.adi` redirects to
`vscode-server.<node>.n.adi` — the one address for that node's editor that resolves from where the
viewer sits. `?stay` on the launcher's URL keeps it from handing a running editor over, for when
you want to read the page. `?folder=<path>` and `?workspace=<path>` are passed through to VS Code.

### Why https, and what it asks of the machine

VS Code's web client signs its connection handshake with a WASM module that it first decrypts
with `crypto.subtle` — an API browsers expose only in a *secure context*. Over plain `http://` on
any host but loopback that step fails silently, the server answers "Unauthorized client refused",
and the workbench renders but never connects (no files, no terminal). So the launcher opens the
editor over `https://` wherever that can work: on this machine through the front door's own TLS
(adi-hive mints a local CA and a leaf covering every routed host into `hive/tls/`; trust that CA
once and `https://*.adi` is a secure context), and through the mesh via the viewer's own front
door, whose leaf covers `*.<node>.n.adi`. Loopback stays `http://`, being secure already. A front
door without TLS gets `http://` and the launcher says plainly that the editor will not connect.

The launcher is two dependency-free Bun servers (`dashboards/vscode/frontend/index.ts`,
`dashboards/vscode/backend/index.ts`), the shape every dashboard has. Those two files, and
`frontend/index.html`, are a dashboard's *entry points*: the platform owns them once the dashboard
has landed, and a marketplace update rewrites every other file of the element but never these
three (`GENERATED_DASHBOARD_FILES` in the installer). So they are thin shims that never need to
change, and everything that does lives beside them — `backend/launcher.ts`, `frontend/serve.ts`,
`frontend/launcher.html`. An install made from a version before 0.3.3 carries the old, fatter
entry points; `update` leaves those as they are, so such a copy is refreshed by uninstalling and
reinstalling the `dashboards/vscode` element. The backend calls the control
panel's own API (`/api/marketplace`, `/api/hive`, `/api/marketplace/start-service`) server-side;
a page could not, since the panel refuses browser requests from other origins. It finds the panel
without relying on the `.adi` name, which a node without the resolver installed cannot use: the
panel's leased loopback port in the store's `ports/registry.json` first, then the front door by its
address (`ADI_FRONTDOOR_ADDR`) with `Host: app.<domain>`, then `http://app.<domain>` — or
`ADI_PANEL_URL` in the backend's environment to say outright. It needs the service installed **in
the same scope** (the same project, or both global): it finds the service through the install
ledger that landed it, and the token in the directory that install's service runs in.

**Moving from 0.2.0:** the service's host was `vscode.adi`; from 0.3.0 that is the launcher's, and
the service answers on `vscode-server.adi`. `adi-mono marketplace update <marketplace>/vscode
--project <id>` re-lands the service block with the new host (unless you edited it — then it is
left alone and said so, and the launcher would collide with it on `vscode.adi`), after which the
launcher can be installed: `adi-mono marketplace install <marketplace>/vscode/dashboards/vscode
--project <id>`.

## Licence terms — read before starting this

This service is a thin wrapper around Microsoft's own `code` CLI, which it downloads directly
from Microsoft (`update.code.visualstudio.com`) the first time it starts. **Nothing of Microsoft's
is redistributed by this bundle** — the repository ships none of their binary, only the pinned
commit and sha256 digests the script checks the download against.

**Starting this service accepts the VS Code Server Licence Terms**
(https://aka.ms/vscode-server-license) on behalf of whoever starts it — `code serve-web` is
launched with `--accept-server-license-terms` on every start, which is what that flag is for.
Read the licence before the first start if that matters to you; this README cannot substitute
for it. In particular, the licence Microsoft publishes for the VS Code Server **permits running it
for your own use or your team's use, not hosting it as a service for third parties** — do not put
this behind a login wall and sell seats on it. The launcher says the same thing beside its button,
because pressing it is the act that starts the service.

**Telemetry is on by default**, the same as it is in Microsoft's own VS Code — `code serve-web`
phones home to Microsoft unless told not to. Disable it per-start by setting `VSCODE_TELEMETRY:
"off"` in the service's `environment.static` block in `.adi/hive.yaml` before starting (it adds
`--disable-telemetry` to the launch). This disables the *server's* telemetry; a user's own
settings inside the editor (e.g. an extension with its own phone-home) are theirs to manage from
inside the workbench.

## First start takes a minute

On first start the service downloads the one archive matching the host's OS and CPU — Linux
(x64/arm64), macOS (x64/arm64) or Windows (x64/arm64), six combinations in total — from
Microsoft's update server, checks it against the sha256 pinned in `services/vscode.yaml` for that
exact combination, and caches the extracted `code` (`code.exe` on Windows) under `.vscode-cli/` in
the directory the service runs from (the project's own directory, when installed into one, which
is also what the editor opens by default — see "The workspace folder" below). Every later start
reuses the cache and is instant. `code serve-web` itself then downloads the actual server component
for the pinned commit into `.vscode-cli/cli-data/` (via `--cli-data-dir`, so that lands in this
service's own state rather than the host user's home directory) — also cached after the first
start.

The CLI version is pinned by its exact 40-hex commit (`--commit-id` on the `serve-web` invocation),
the same commit the six archives are downloaded for — a start never floats to whatever Microsoft
currently calls "latest stable".

The service declares no `start:` policy, so the hive's default for a proxied service applies:
**on-demand**. It is woken by a visit to its host and stopped again after sitting idle; the
launcher's redirect is such a visit.

## The connection token

`code serve-web` refuses every request without a connection token. On each start the script:

1. tries `adi-mono secrets read VSCODE_TOKEN` (**global** scope — a hive service has no project
   context to look a project-scoped secret up against, unlike an agent);
2. failing that, reuses whatever token it generated on a previous start, from
   `.vscode-cli/connection-token` (mode `0600`);
3. failing that (first start, no secret set), generates a random 32-byte token and writes it there.

The launcher resolves the token in the same order, and when neither the secret nor the file exists
it writes a fresh one to that file before redirecting — the service then reuses it (step 2), which
is what makes the very first open land in the editor rather than on a `403`.

Set the secret yourself to pick a token you already know, and to survive the state directory being
wiped:

```sh
adi-mono secrets set VSCODE_TOKEN   # value from stdin or --value
```

Whichever token is in force, the editor is at `http://vscode-server.adi/?tkn=<token>` — without
`?tkn=` (or with the wrong one) the server answers `403`. The launcher at `http://vscode.adi/` is
the way there that does not require knowing it.

## Defaults for a slow link

VS Code's remote protocol is chatty: file-watcher events, git polling, port scanning, hovers,
code lens, semantic tokens — each one a round trip over the editor's WebSocket, and over a mesh
link every round trip is the network's full latency. So the bundle seeds the server's
**machine-scope settings** (`.vscode-cli/server-data/data/Machine/settings.json`, applied to every
browser that opens this editor) with defaults that cut the round trips:

| setting | why |
|---|---|
| `files.watcherExclude`, `search.exclude`, `files.exclude` for `node_modules`, `.git/objects`, `target`, `dist`, `.vscode-cli` | the server's watcher pushes every event over the link; the state directory is 700 MB of nothing you edit |
| `git.autorefresh`, `git.autofetch` off | the git extension runs on the server and rescans on every focus and edit |
| `remote.autoForwardPorts` off | stops the periodic process and port scan |
| `editor.hover.delay` 600, `editor.quickSuggestionsDelay` 300 | fewer requests while the cursor moves |
| `editor.codeLens`, `editor.inlayHints.enabled`, `editor.semanticHighlighting.enabled`, `editor.occurrencesHighlight`, `editor.lightbulb.enabled` off | each is a request to the remote extension host on every edit |
| `files.autoSave` on focus change | far fewer writes than after a delay |
| `terminal.integrated.localEchoEnabled` on | typed characters show at once while the real echo catches up |

Seeded **once**, by the service at start and by the launcher on open, and only when no settings
file exists — after that the file is yours: edit it, or leave an empty `{}` there to keep the
defaults away. Application-scoped settings (`extensions.*`, `telemetry.*`) cannot live in a
machine settings file and are deliberately not seeded. The WebSocket itself already compresses
(`permessage-deflate` is negotiated through the front door and the mesh), and the tunnel is a
direct QUIC path when the network allows one — what remains is the round trips, which these cut.

## The workspace folder

`code serve-web --default-folder` sets what opens for a request that carries no `folder=` of its
own. This service passes it `$WORKSPACE_DIR`, which defaults to the directory the service itself
runs in — the project's directory, for a project-scoped install. Override it by setting
`WORKSPACE_DIR` in the service's `environment.static` block in `.adi/hive.yaml` before starting,
if you want it to open somewhere else — or open the launcher with `?folder=<path>` for one visit.

## Why no Rust, why no binary here

The upstream CLI is a prebuilt native binary — exactly the compiled shape a bundle may never carry
(`docs/marketplace-bundles.md`, "No Rust in an item"). So this bundle ships none of it: the
service's own script fetches the one matching archive by URL at **start** time, not at publish
time, and refuses to run anything whose sha256 doesn't match the digest pinned for that exact
platform/architecture in `services/vscode.yaml`. That script is itself the one named hole the same
document calls out — "a hive service's `runner.script` ... can `curl` a binary and execute it at
runtime" — stated plainly rather than papered over.

## How the bootstrap itself is written — one shell, two parsers

The installer lands the service as one file (`services/vscode.yaml`), so the whole bootstrap has to
be self-contained inside it. `runner.script.run` is handed to `sh -c` on Unix and to `cmd /C` on
Windows — one string, two completely different parsers. The run line here is kept to exactly one
thing neither parser can trip over:

```
bun -e "eval(process.env.VSCODE_BOOTSTRAP)"
```

No `$VAR` or `%VAR%` shell expansion, nothing from `% ^ & | < >` anywhere in that line — both `sh`
and `cmd` hand `bun` the one double-quoted argument intact. The actual bootstrap (the download,
the sha256 check, the extraction, the token handling, the `code serve-web` launch) is the
`VSCODE_BOOTSTRAP` value in `environment.static` just above it in the YAML: a plain environment
variable, injected straight into the child process's environment table by the Rust runner, which
never goes through either shell's parser at all — so it is free to contain anything, including the
very characters the run line itself has to avoid. `eval`, not `new Function`, is what picks it up:
a direct `eval()` keeps the enclosing module's scope (so `require`/dynamic `import` inside the
bootstrap work), where `new Function(...)` runs with no lexical scope at all.

**Windows walkthrough**, concretely: `cmd /C bun -e "eval(process.env.VSCODE_BOOTSTRAP)"` — `cmd`
sees one command (`bun`), two arguments (`-e` and the quoted string), and never interprets anything
inside the quotes because none of `cmd`'s own metacharacters (`% ^ & | < >`) appear there. `bun`
then reads `process.env.VSCODE_BOOTSTRAP` directly from its own process environment — not from
anything `cmd` expanded — and `eval`s it. Inside that bootstrap, Windows-specific branches use
`child_process.spawn`/`execFileSync` with an argument array (never a shell string), so the zip
extraction (`Expand-Archive` via `powershell.exe`) and the final `code.exe serve-web` launch are
never re-parsed by `cmd` either.

## Checking it works

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://vscode-server.adi/              # 403 — no token (once running)
curl -s -o /dev/null -w '%{http_code}\n' "http://vscode-server.adi/?tkn=wrong"   # 403 — wrong token
curl -s -o /dev/null -w '%{http_code}\n' "http://vscode-server.adi/?tkn=$TOKEN"  # 302 → the workbench
curl -s http://vscode.adi/api/status                                             # the launcher's view of the service
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://vscode.adi/api/open   # 302 http://vscode-server.adi/?tkn=…
```

The launcher's own tests: `bun test dashboards/vscode/test`.

## Licence

MIT (this bundle). `code`/VS Code Server is Microsoft's own, under the VS Code Server Licence
Terms linked above — this bundle redistributes none of it.
