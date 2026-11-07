# VS Code

A full VS Code in the browser, proxied behind the front door — Microsoft's own `code serve-web`,
the same CLI VS Code itself ships, pinned to one commit and sha256-verified before it ever runs.
No Rust, no binary checked into this repo: the CLI is fetched from Microsoft at first start.

This bundle carries two elements:

| kind | name | what it is |
|---|---|---|
| service | `vscode` | the hive service that fetches, verifies and runs `code serve-web` |
| project | VS Code | the project scaffold it's recommended to file the service under |

Install into a project of its own:

```sh
adi-mono marketplace install <marketplace>/vscode --new-project "VS Code"
```

Then start it (parked services have no on/off switch to force — see `guides/services.md` — so
install never launches it):

```sh
adi-mono marketplace start <marketplace>/vscode/services/vscode
```

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
this behind a login wall and sell seats on it.

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

## The connection token

`code serve-web` refuses every request without a connection token. On each start the script:

1. tries `adi-mono secrets read VSCODE_TOKEN` (**global** scope — a hive service has no project
   context to look a project-scoped secret up against, unlike an agent);
2. failing that, reuses whatever token it generated on a previous start, from
   `.vscode-cli/connection-token` (mode `0600`);
3. failing that (first start, no secret set), generates a random 32-byte token and writes it there.

Set the secret yourself to pick a token you already know, and to survive the state directory being
wiped:

```sh
adi-mono secrets set VSCODE_TOKEN   # value from stdin or --value
```

Whichever token is in force, open `https://vscode.adi/?tkn=<token>` — without `?tkn=` (or with the
wrong one) the server answers `403`.

## The workspace folder

`code serve-web --default-folder` sets what opens for a request that carries no `folder=` of its
own. This service passes it `$WORKSPACE_DIR`, which defaults to the directory the service itself
runs in — the project's directory, for a project-scoped install. Override it by setting
`WORKSPACE_DIR` in the service's `environment.static` block in `.adi/hive.yaml` before starting,
if you want it to open somewhere else.

## Why no Rust, why no binary here

The upstream CLI is a prebuilt native binary — exactly the compiled shape a bundle may never carry
(`docs/marketplace-bundles.md`, "No Rust in an item"). So this bundle ships none of it: the
service's own script fetches the one matching archive by URL at **start** time, not at publish
time, and refuses to run anything whose sha256 doesn't match the digest pinned for that exact
platform/architecture in `services/vscode.yaml`. That script is itself the one named hole the same
document calls out — "a hive service's `runner.script` ... can `curl` a binary and execute it at
runtime" — stated plainly rather than papered over.

## How the bootstrap itself is written — one shell, two parsers

The installer lands only this one file (`services/vscode.yaml`), so the whole bootstrap has to be
self-contained inside it. `runner.script.run` is handed to `sh -c` on Unix and to `cmd /C` on
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
curl -s -o /dev/null -w '%{http_code}\n' https://vscode.adi/              # 403 — no token
curl -s -o /dev/null -w '%{http_code}\n' "https://vscode.adi/?tkn=wrong"   # 403 — wrong token
curl -s -o /dev/null -w '%{http_code}\n' "https://vscode.adi/?tkn=$TOKEN"  # 302 → the workbench
```

## Licence

MIT (this bundle). `code`/VS Code Server is Microsoft's own, under the VS Code Server Licence
Terms linked above — this bundle redistributes none of it.
