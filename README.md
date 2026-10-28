# VS Code

A full VS Code in the browser, proxied behind the front door — openvscode-server
(gitpod-io/openvscode-server) v1.109.5, fetched and verified on first start, no Rust, no binary
checked into this repo.

This bundle carries two elements:

| kind | name | what it is |
|---|---|---|
| service | `vscode` | the hive service that fetches, verifies and runs openvscode-server |
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

## First start takes a minute

On its first start the service downloads the right build for the host's architecture
(`linux-x64` or `linux-arm64` — there is no macOS build published upstream, so this refuses with a
clear message on Darwin), checks it against a pinned sha256, and caches the extracted binary under
`.vscode-server/` in the directory it runs from (the project's own directory, when installed into
one, which is also what the editor opens by default — see "The workspace folder" below). Every
later start reuses the cache and is instant.

## The connection token

openvscode-server refuses every request without a connection token. On each start the script:

1. tries `adi-mono secrets read VSCODE_TOKEN` (**global** scope — a hive service has no project
   context to look a project-scoped secret up against, unlike an agent);
2. failing that, reuses whatever token it generated on a previous start, from
   `.vscode-server/connection-token` (mode `0600`);
3. failing that (first start, no secret set), generates a random 32-byte token and writes it there.

Set the secret yourself to pick a token you already know, and to survive the state directory being
wiped:

```sh
adi-mono secrets set VSCODE_TOKEN   # value from stdin or --value
```

Whichever token is in force, open `https://vscode.adi/?tkn=<token>` — without `?tkn=` (or with the
wrong one) the server answers `403`.

## The workspace folder

openvscode-server has no documented flag for this, but it does have one: `--default-folder`,
undocumented in `--help` but present in `server-main.js`'s own CLI parser (`default-folder`, read
into `folderUri`) — it sets what opens for a request that carries no `folder=` of its own. This
service passes it `$WORKSPACE_DIR`, which defaults to the directory the service itself runs
in — the project's directory, for a project-scoped install. Override it by setting `WORKSPACE_DIR`
in the service's `environment.static` block in `.adi/hive.yaml` before starting, if you want it to
open somewhere else.

## Why no Rust, why no binary here

The upstream release is a prebuilt Node.js + native-modules tarball — exactly the compiled-binary
shape a bundle may never carry (`docs/marketplace-bundles.md`, "No Rust in an item"). So this
bundle ships none of it: the service's own script fetches the two possible platform tarballs by
URL at **start** time, not at publish time, and refuses to run anything whose sha256 doesn't match
the digest pinned in `services/vscode.yaml`. That script is itself the one named hole the same
document calls out — "a hive service's `runner.script` ... can `curl` a binary and execute it at
runtime" — stated plainly rather than papered over.

## Checking it works

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://vscode.adi/              # 403 — no token
curl -s -o /dev/null -w '%{http_code}\n' "https://vscode.adi/?tkn=wrong"   # 403 — wrong token
curl -s -o /dev/null -w '%{http_code}\n' "https://vscode.adi/?tkn=$TOKEN"  # 302 → the workbench
```

## Licence

MIT (this bundle). openvscode-server is itself MIT; see its own repository for third-party notices.
