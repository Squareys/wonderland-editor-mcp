# Publishing to Wonderland Cloud Pages

Wonderland Cloud Pages hosts the packaged project for free (up to five pages per
account) at `https://<page-name>.cloud.wonderland.dev`.

Publishing makes the project reachable on the internet. **Before publishing,
always ask the user, and wait for the answer:**

1. **"Should the page be unlisted or public?"** Ask this every time a page is
   created; never pick for them.
   - `unlisted`: only people with the link find it.
   - `public`: also listed in the Wonderland Cloud page explorer.
2. The page name (it becomes the subdomain); propose one from the project name.

## Before the first publish: social card

Every published project needs a social card: the image shown as the thumbnail on
Wonderland Cloud Pages and when the link is shared.

1. Make a 1200 x 630 px PNG of the scene's best view (a screenshot of the preview,
   cropped or resized to 1200 x 630). If you cannot take screenshots, ask the user
   for one.
2. Save it in the project's static folder (`settings.project.extraFilesFolder`,
   default `static/`), e.g. `static/social-card.png`. The packager copies that
   folder's contents into the root of `deploy/`.
3. Set the project settings:
   `modify_settings {"changeSettings": {"project": {"coverImage": "social-card.png", "description": "<one sentence about the scene>"}}}`.
   Also set `project.name` if it is still a placeholder. The editor writes these
   into the page's `og:` and `twitter:` meta tags.
4. After the first publish, when the page's address is known, set `coverImage`
   to the absolute URL (`https://<page-domain>/social-card.png`), since link
   previews need absolute image URLs, and publish once more (an update).

## Route 1 (preferred): MCP tools

Use `publish_page` and `publish_status` when the editor's MCP server offers them.
They package the project, handle the sign-in and upload in the background, and keep
the page state. You need no Node.js, no CLI and no token.

1. Ask the user both questions above (unlisted or public, page name) and add the
   social card. Do not call the tool before the user answered.
2. Call `publish_page` with `{"pageName": "<page-name>", "access": "<the user's answer>"}`.
   `access` is required for a new page. Without `pageName` the tool uses the
   project name, turned into a valid page name. Updates keep the existing access.
3. The call returns at once with a state object. The editor opens the user's
   browser at `https://wonderlandengine.com/account/?actionId=...`. Tell the user
   to sign in and confirm there. If the browser did not open, give them
   `confirmUrl` from the state.
4. Call `publish_status` every 5 to 10 seconds. **Never call `publish_page` again
   to poll.** The state is one of:

   | `status` | Meaning | What you do |
   | --- | --- | --- |
   | `idle` | No publish ran in this editor session | Start one with `publish_page` |
   | `packaging` | The editor packages the project | Wait |
   | `waiting_for_confirmation` | The user has to confirm in the browser (`confirmUrl`) | Remind the user. The tool gives up after 5 minutes |
   | `uploading` | The upload runs | Wait |
   | `done` | Finished (`url` holds the page address) | Report the URL |
   | `failed` | Something broke (`error` holds the reason) | Read the error, see [pitfalls.md](pitfalls.md), tell the user |

5. Give the user the `url` and open it in their browser. The first load of a new
   page can fail for up to 30 minutes while the domain gets its SSL certificate.

How the tool keeps state:

- Only one publish runs at a time. A second `publish_page` call while one runs
  returns the current status and starts nothing.
- The tool writes `deployment.json` into the project root. It uses the same format
  as the editor's built-in publish plugin, so both update the same page. The file
  holds no secret. Keep it (it is safe to commit).
- A project with a `deployment.json` is always updated, never published to a second
  page. If you pass a different `pageName`, the tool returns an error. To publish
  to another page, the user has to delete `deployment.json` first. Ask them before
  you suggest that.
- If an earlier run created the page but did not write `deployment.json` (for
  example the editor closed during the upload), the tool finds the existing page
  and updates it instead of creating another.
- Updates keep the page's current access unless you pass `access`.
- The tool works around the certificate problem described in
  [pitfalls.md](pitfalls.md#publishing). You do not need to do anything for it.

## Route 2 (fallback): shell and CLI

Use this route only when the MCP tools are not available (for example an older
plugin version).

**Requirement: system Node.js 20 or newer (22 or newer to be safe).** Check with
`node --version`. On Node 18 the CLI fails: `@wonderlandcloud/cli` 0.2.36 cannot
load (`ERR_REQUIRE_ESM`). Do not use the Node.js that is built into the editor.
If the system has no Node 20+, tell the user and stop; do not try workarounds.

Tell the user the step and how many are left, as during setup.

### 1. Package the project

The editor packages into `deploy/` after every change. Make sure the last packaging
succeeded ("Packaging successful!" in the editor log) and that `deploy/index.html`
exists. Without a running editor:

```sh
WonderlandEditor --windowless --project "$PWD/<Name>.wlp" --package
```

Check the result visually first ([visual-check.md](visual-check.md)), and re-bake GI
in the editor window if static geometry changed since the last bake.

### 2. Authenticate

**Preferred: one-time token, confirmed in the browser.** This is the flow the
editor's publish plugin uses. The user confirms once in the browser; you never
handle a long-lived token.

1. Request an action:

   ```sh
   ACTION_ID=$(curl -s -X POST https://api.wonderlandengine.com/auth/action \
     -H 'Content-Type: application/json' \
     -d '{"action":"createToken","parameters":{"projectName":"<page-name>"}}')
   ```

2. Open `https://wonderlandengine.com/account/?actionId=$ACTION_ID` in the user's
   browser and ask them to sign in and confirm.
3. Poll every 5 seconds, for at most about a minute, until the result contains a
   token:

   ```sh
   curl -s "https://api.wonderlandengine.com/auth/action/$ACTION_ID/result"
   # → {"token": "..."} once confirmed
   ```

4. Pass the token to the next command only through the environment, e.g.
   `WLE_CREDENTIALS=<token> npx -y @wonderlandcloud/cli page create ...`. Do not
   write it to a file or print it.

If the poll times out, ask whether the user confirmed, then start over with a new
action.

**Alternative: API token file.** For repeated or CI publishing, the user creates a
token on https://wonderlandengine.com/account, downloads the file, and puts it into
the project directory as `wle-apitoken.json`. The CLI finds it automatically. Never
ask the user to paste a token into the chat. Make sure the file never gets
committed:

```sh
grep -qx 'wle-apitoken.json' .gitignore 2>/dev/null || echo 'wle-apitoken.json' >> .gitignore
```

### 3. Create the page (first time)

```sh
npx -y @wonderlandcloud/cli page create <page-name> ./deploy --access <unlisted|public, as the user chose>
```

- `--access` is the user's answer; ask before every new page.
- Page names: lowercase letters, digits and single hyphens, starting with a letter,
  at most about 22 characters (e.g. `duck-garden`).
- `--noThreads` leaves out the response headers that enable multi-threading in the
  runtime. Use it when the project's `editor.serverCOEP` setting is not
  `require-corp` (this is what the editor's publish plugin does).
- The command writes `deployment.json` into the working directory. It stores the
  page name, deploy location and access, and later updates use it. Keep it (it is
  safe to commit; it holds no secret).

The new domain gets an SSL certificate. That usually takes a few minutes and up to
30 minutes, in rare cases up to 24 hours. Tell the user so if the page does not
load right away.

### 4. Update the page (later deployments)

```sh
npx -y @wonderlandcloud/cli page update
```

It uses `deployment.json`. To keep several deployments (e.g. a public production
page and an unlisted preview), give each its own config file:

```sh
npx -y @wonderlandcloud/cli page create my-project-preview ./deploy --access unlisted --config ./deployments/preview.json
npx -y @wonderlandcloud/cli page update --config ./deployments/preview.json
```

Access is set when the page is created and kept on updates. To change it later,
edit `isPublic` in the config file or set `ACCESS=public` / `ACCESS=unlisted` for
`page update`.

### 5. Report

Give the user the page URL (`projectDomain` in `deployment.json`), and open it in
their browser.

## Other commands

| Command | Purpose |
| --- | --- |
| `npx -y @wonderlandcloud/cli page list` | List the user's pages |
| `npx -y @wonderlandcloud/cli page get <page-name>` | Show a page's state |
| `npx -y @wonderlandcloud/cli page delete <page-name>` | Delete a page (ask the user first; it cannot be undone) |

## From the editor window

The editor ships a publish plugin (`publish-plugin.mjs` in "Views > Plugins"). The
user selects it, clicks publish, signs in in the browser window that opens, and
confirms. Progress shows in the editor console. Prefer the MCP tools when you work
autonomously; they need no clicks in the editor. The built-in plugin fails on
Node 18 with a certificate error (see [pitfalls.md](pitfalls.md#publishing)).
