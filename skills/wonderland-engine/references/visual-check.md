# Checking your own result visually

Tool results tell you what you changed, not what it looks like. After every
meaningful change (an import, a layout step, a lighting change), take a screenshot
of the preview and look at it before reporting success.

The preview runs at `http://localhost:8080/` (the `editor.serverPort` setting) and
reloads itself after each change. Wait for "Packaging successful!" in the editor log
(or a few seconds) before taking a screenshot.

## Option 1: your own browser tool

If your environment gives you a browser or screenshot tool (a browser-automation
MCP server, a built-in browser), open the preview URL with it, wait ~15 seconds for
the engine to start, and take a screenshot.

## Option 2: headless Chrome from the shell

Works without extra installs wherever Chrome or Chromium is installed
(`google-chrome-stable`, `chromium`, `chrome.exe`):

```sh
google-chrome-stable --headless=new --no-first-run \
  --user-data-dir=/tmp/wle-shot-profile \
  --enable-unsafe-swiftshader --use-angle=swiftshader \
  --window-size=1280,720 --timeout=15000 \
  --screenshot=/tmp/wle-shot.png http://localhost:8080/
```

Then open the PNG with your image-reading tool.

- `--timeout=15000` waits 15 real seconds. Do **not** use
  `--virtual-time-budget`; it only captures the loading screen.
- SwiftShader renders WebGL in software. It is slow but works without a GPU.
- Use a separate `--user-data-dir` so the user's browser profile is not touched.

## Option 3: Playwright

If Node.js is available:

```js
// shot.mjs — run with: npx -y playwright@latest install chromium && node shot.mjs
import { chromium } from "playwright";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => console.log("[page]", m.type(), m.text()));
await page.goto("http://localhost:8080/");
await page.waitForTimeout(15000);
await page.screenshot({ path: "/tmp/wle-shot.png" });
await browser.close();
```

Playwright also gives you the page's console output, which shows runtime errors in
the project's JavaScript components.

## Option 4: visible Chrome with a DevTools Protocol client

Use this when headless Chrome fails (see "Known limits on Linux"). Start a
visible (not headless) Chrome on the user's display with its own profile and a
debugging port:

```sh
google-chrome-stable --user-data-dir=/tmp/wle-cdp-profile \
  --remote-debugging-port=9222 http://localhost:8080/
```

Then talk to it with a small Chrome DevTools Protocol client. Python's standard
library is enough: open the websocket from `http://localhost:9222/json` over a
raw socket. It gives you:

- `Page.captureScreenshot` for screenshots.
- `Input.dispatchKeyEvent` and `Input.dispatchMouseEvent` for simulated input.
- `Runtime` console events for the page's console output.

Warnings:

- The window appears on the user's screen and takes keyboard focus.
- The user may interact with it.
- Tell the user before you open it, and close it when you are done.
- To stop it, kill the PID that owns the debugging port
  (`ss -ltnp | grep :9222`). `pkill -f` patterns can match your own shell
  command.

## Important: no browser connected while you edit

Wonderland Editor 1.6.1 can crash ("munmap_chunk(): invalid pointer" right after
"Reloading clients") when a slow client, e.g. a headless browser still loading
the preview, is connected while a change triggers repackaging. The crash can
also show as "Cork buffer must not be acquired without checking canCork!" during
"Reloading clients". The user's own browser can trigger it too. Packaging can
start without any MCP call from you (for example after file changes), so
coordinate with the user: tell them when to open the preview, and change nothing
while they look. Take screenshots
only between edits: make your changes, `save_project`, wait for "Packaging
successful!", then start the browser, capture, and **close it** before the next
change. When you stop Chrome, match only your own instance
(`pkill -f "[c]hrome.*<your user-data-dir>"`), never a pattern that also matches
your own shell command.

## Known limits on Linux

- Headless Chrome needs `DISPLAY` set, even with `--use-angle=gl`.
- Headless Chrome with the GPU (ANGLE gl, egl, vulkan) can fail to compile the
  skinning shaders ("SkinningShader: linking shader failed") and shows only the
  page background.
- SwiftShader works for small scenes but can take many minutes to compile the
  shaders of a full scene with the visual-quality baseline, so a fixed 15 s
  timeout only captures the loading screen.
- If neither works, say so and ask the user to look at the preview in their own
  browser (which renders correctly) and describe or screenshot what they see.
  Do not report a scene as visually verified without an image.

## Check from more than one viewpoint

One camera view hides objects behind others, overlaps along the view direction,
and wrong facing. For layout work, check at least two views:

1. Note the camera's current `position` and `rotation` (query the object with the
   `view` component).
2. **Top view:** move the camera above the scene centre, high enough to see all of
   it (e.g. y = 12 for a 12 m room), rotation `[-0.7071, 0, 0, 0.7071]` (looks
   straight down; +X is right, -Z is up in the image). Screenshot. Check
   footprints, gaps to walls, and which way each character faces.
3. **Low side view** from outside one wall or through the doorway. Screenshot.
   Check heights: nothing floats or sinks into the floor.
4. Restore the camera to the noted position and rotation, `save_project`, and take
   the final screenshot.

A ceiling or roof blocks the top view; hide it temporarily (move it up by 100 m)
and move it back afterwards.

## Checking animations

A single screenshot cannot show motion. Take two screenshots 2-3 seconds apart
(or two `page.screenshot` calls with `waitForTimeout` between in Playwright) and
compare them: animated characters must differ between the two. A character in
T-pose (arms straight out) means its animation did not start.

## What to look for

Compare the image with your layout ledger:

- Every planned object is visible, at the planned place and size.
- Nothing floats above or sinks into the ground.
- Nothing overlaps that should not.
- The camera frames the scene; the subject is not cut off or tiny.
- Lighting: no pitch-black areas, no blown-out white areas, shadows present when
  enabled.

## Known differences in headless screenshots

- **Magenta textures** in a SwiftShader screenshot usually mean the texture data
  did not load in the software renderer (texture streaming or compressed formats),
  not a broken project. Ask the user whether the textures show in their browser
  before changing anything.
- Frame rate in headless mode says nothing about real performance.
- Still the loading screen? Increase `--timeout`, and check the editor log for
  "Packaging failed".
