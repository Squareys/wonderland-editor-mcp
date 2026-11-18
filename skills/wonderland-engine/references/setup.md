# Setup: from nothing to a connected editor

Follow these steps in order. Skip a step only when its check passes. Before each
step, tell the user where you are, e.g. "Step 4 of 8: creating the project".

| # | Step | Check that lets you skip it |
| --- | --- | --- |
| 1 | Detect platform and existing install | — |
| 2 | Install Wonderland Editor | `--version` prints 1.5.0 or newer |
| 3 | EULA | The user accepted it before, in this session or in the editor |
| 4 | Sign in | The editor starts without "You need to log in" |
| 5 | Create or open a project | A `.wlp` file exists |
| 6 | Install the MCP plugin | `node_modules/@wonderlandengine/mcp-plugin` exists in the project |
| 7 | Start the editor with the MCP server | `http://localhost:3020/mcp` answers |
| 8 | Connect and open the preview | The MCP tools are listed, the browser shows the scene |

Minimum editor version: **1.5.0** (the plugin's tutorial requirement). Prefer the
latest release.

## Step 1: Detect the platform and an existing install

Run the version command for the platform. If it prints a version, go to step 3.

| Platform | Editor command | Version check |
| --- | --- | --- |
| Linux (Flatpak) | `flatpak run com.wonderlandengine.editor` | `flatpak run com.wonderlandengine.editor --version` |
| Linux (tarball) | `<install dir>/bin/WonderlandEditor` | `<install dir>/bin/WonderlandEditor --version` |
| Linux (.deb) | `WonderlandEditor` | `WonderlandEditor --version` |
| Windows | `"C:\Program Files\Wonderland\WonderlandEngine\bin\WonderlandEditor.exe"` | same with `--version` |
| macOS | `/Applications/WonderlandEditor.app/Contents/MacOS/WonderlandEditor` | same with `--version` |

From here on, `WonderlandEditor` means the editor command of this table.

## Step 2: Install Wonderland Editor

Find the current version on https://wonderlandengine.com/downloads/. Download URLs
follow this pattern (replace `1.6.1` with the current version):

```
https://downloads.wonderlandengine.com/1.6.1/WonderlandEngine-1.6.1-win64.exe
https://downloads.wonderlandengine.com/1.6.1/WonderlandEngine-1.6.1-win64.zip
https://downloads.wonderlandengine.com/1.6.1/WonderlandEngine-1.6.1-Linux.tar.gz
https://downloads.wonderlandengine.com/1.6.1/WonderlandEngine-1.6.1-Linux.deb
https://downloads.wonderlandengine.com/1.6.1/WonderlandEngine-1.6.1-Darwin-arm64.dmg
https://downloads.wonderlandengine.com/1.6.1/WonderlandEngine-1.6.1-Darwin-x86_64.dmg
```

**Linux, preferred: Flatpak.** Works on every distribution and bundles Node.js and
npm, so the user needs no system Node.

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub com.wonderlandengine.editor
```

If `flatpak` is missing, ask the user to install it with their package manager
(this needs administrator rights, e.g. `sudo pacman -S flatpak`,
`sudo apt install flatpak`, `sudo dnf install flatpak`). The launcher entry appears
after the user logs out and back in; `flatpak run` works right away.

**Linux, alternative: tarball.**

```sh
mkdir -p ~/.local/opt && cd ~/.local/opt
curl -fLO https://downloads.wonderlandengine.com/1.6.1/WonderlandEngine-1.6.1-Linux.tar.gz
tar xzf WonderlandEngine-1.6.1-Linux.tar.gz
```

**Windows.** Download the `.zip` with `curl.exe -fLO <url>` and extract it, or
download the `.exe` installer and ask the user to run it (it needs administrator
approval).

**macOS.** Download the `.dmg` for the CPU (`uname -m`: `arm64` or `x86_64`), then:

```sh
hdiutil attach WonderlandEngine-1.6.1-Darwin-arm64.dmg
cp -R "/Volumes/<volume name>/WonderlandEditor.app" /Applications/
hdiutil detach "/Volumes/<volume name>"
```

## Step 3: EULA

Wonderland Engine is free to use up to 120,000 USD revenue per year, with a royalty
above that. The user must agree to the End User License Agreement themselves.

1. Open https://wonderlandengine.com/legal/eula in the user's browser
   (`xdg-open`, `open`, or `start` on Windows).
2. Ask: "Do you accept the Wonderland Engine EULA?" Wait for an explicit yes.
3. Only after that yes, pass `--accept-eula` on editor commands. Never pass it
   without the user's yes, and never treat silence as a yes.

If the user signs in through the editor window instead (step 4), the editor asks
for the EULA there and the flag is not needed.

## Step 4: Sign in

The editor needs a Wonderland account. Without one it stops with
"You need to log in to use WonderlandEditor."

Two ways, ask the user which they prefer:

- **Editor window (simplest):** the user starts the editor normally and signs in.
  The login is remembered for later windowless runs.
- **API token (for windowless and CI):** the user creates a token on their
  account page at wonderlandengine.com ("API-Token" → "Create New API-Token") and
  saves it to a file only they write, e.g.:

  ```sh
  install -m 600 /dev/null ~/.config/wle-credentials   # then paste the token into it
  ```

  You then pass it as `WLE_CREDENTIALS="$(cat ~/.config/wle-credentials)"`.
  `--credentials "email:password"` also works, but prefer the token.

Never ask the user to paste a token or password into the chat.

## Step 5: Create or open a project

To create a new project, start the editor in the background and stop it once the
`.wlp` file exists (`--create` does not exit by itself):

```sh
mkdir -p <project dir> && cd <project dir>
WonderlandEditor --windowless --accept-eula --create --project "$PWD/<Name>.wlp"
```

Use an absolute path for `--project`. The new project has no camera, and VR is
enabled without eye objects, so the first packaging fails; you fix both in step 8.

## Step 6: Install and enable the MCP plugin

In the project directory, create a `package.json` if there is none, then install:

```sh
npm init -y            # only if package.json is missing
npm i -D @wonderlandengine/mcp-plugin
```

With the Flatpak and no system Node.js, use the bundled npm. The bundled wrapper
looks in the wrong place, so pass the npm location explicitly:

```sh
flatpak run --env=NPM_CLI_JS=/app/share/wonderlandengine/npm/index.js \
  --command=npm com.wonderlandengine.editor init -y
flatpak run --env=NPM_CLI_JS=/app/share/wonderlandengine/npm/index.js \
  --command=npm com.wonderlandengine.editor i -D @wonderlandengine/mcp-plugin
```

Then enable the plugin for the project. **With the editor stopped**, add this entry
to the top-level `plugins` object of the `.wlp` file (the one case where you edit
the project file directly):

```json
"plugins": { "@wonderlandengine/mcp-plugin": { "enable": true } }
```

In the editor window, the same is done in "Views > Plugins": enable plugin
execution, switch to "Project Scope", click "Install" next to
`@wonderlandengine/mcp-plugin`, then enable it.

## Step 7: Start the editor with the MCP server

Pick one mode. Both start the MCP server at `http://localhost:3020/mcp` and the
preview server at `http://localhost:8080`.

**With window (the user watches the editor):**

```sh
WonderlandEditor --project "$PWD/<Name>.wlp" --enable-plugins
```

**Windowless (headless, the user watches the browser preview):**

```sh
WonderlandEditor --windowless --project "$PWD/<Name>.wlp" --enable-plugins --server --watch
```

Run it in the background and keep its log. Wait until the log shows the plugin
loaded (`[mcp] server running on port 3020`), or until the endpoint answers:

```sh
curl -s -X POST http://localhost:3020/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
```

A JSON-RPC result means the server runs. Probing re-initializes the plugin's single
session, so connect your real client after probing, not before.

If the log shows `[mcp][error] ... EADDRINUSE`, another editor still runs. Stop it
(`flatpak kill com.wonderlandengine.editor` for Flatpak) and start again.

**Linux: windowless still needs a display.** The editor opens an X11 display even
with `--windowless`. Without one it crashes with a segmentation fault (exit 139)
right after "Running in windowless mode". On a desktop, make sure `DISPLAY` is set.
On a machine without a desktop, run it under `xvfb-run -a WonderlandEditor ...`.

**Linux with NVIDIA:** if the editor crashes at startup (exit 139 after
"Initializing Plugin: PluginsView"), set `__GL_THREADED_OPTIMIZATIONS=0`. For the
Flatpak, ask the user before making it permanent:
`flatpak override --user --env=__GL_THREADED_OPTIMIZATIONS=0 com.wonderlandengine.editor`.

## Step 8: Connect, make the project packageable, open the preview

1. Add the MCP server to your own client configuration (see
   [connect.md](connect.md)). Most clients need a restart or reload to pick it up.
2. Check that the tools are listed (`query_settings` is a cheap first call).
3. For a new project from step 5, make it packageable:
   - `modify_settings {"changeSettings": {"xr": {"vr": {"enable": false}}}}`
     (unless the user wants VR; then set the eye objects instead),
   - add a camera (object with a `view` component at `[0, 1.6, 4]`) and a sun
     light,
   - `save_project`.
4. Call `open_preview` (or open `http://localhost:8080` yourself). Tell the user
   the page reloads by itself after every change.
5. Take a first screenshot (see [visual-check.md](visual-check.md)) to confirm the
   preview renders.
6. Tell the user setup is done, and what you will do next.
