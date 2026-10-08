# Tab Loudness Normalizer

One-click Chrome extension for the classic streaming problem: speech is quiet, action is loud.

It captures the active tab's audio, runs it through a dialogue-focused compressor and peak limiter, then plays the processed audio back through your normal output device. It does not record, save, upload, or inspect audio.

## Install

Not on the Chrome Web Store yet, so it installs as an unpacked extension. That takes about a minute.

1. Download the latest `chrome-tab-loudness-normalizer-x.y.z.zip` from the
   [Releases page](https://github.com/skamagedon/chrome-tab-loudness-normalizer/releases).
2. Unzip it somewhere you will keep it. Chrome loads the extension from this folder
   every time it starts, so do not unzip to a temp directory and delete it afterwards.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**, top right.
5. Click **Load unpacked** and select the unzipped folder, the one containing `manifest.json`.
6. Pin the extension so the button is visible: click the puzzle-piece icon in the toolbar,
   then the pin next to **Tab Loudness Normalizer**.

Chrome will warn that the extension can "read and change all your data on all websites."
That is real, and the [Permissions](#permissions-and-privacy) section explains exactly
what each permission is for and why it is that broad.

Chrome also shows a "Disable developer mode extensions" prompt on startup. That is
unavoidable for unpacked extensions and is not specific to this one.

Requires Chrome 116 or newer.

## Use

1. Open the HBO, Disney, Netflix, Hulu, Prime, YouTube, or other tab you want to tame.
2. Start playback.
3. Click the extension icon once. The badge shows `ON`.
4. Click it again to turn processing off.

Version `2.5.0` keeps the 1.3.0 audio chain unchanged and rewrites the fullscreen assist, which never worked in 1.x. See below.

## Notes

- This works at the Chrome tab audio layer, so it is more likely to work on streaming sites than a script that edits the page's `<video>` element.
- Some DRM/protected playback setups may refuse tab audio capture. If that happens, use the system-wide Windows option below.
- There is a small latency cost because Chrome is routing the tab through the Web Audio API.
- The fullscreen assist script loads as a real all-frame content script, so late player frames get a chance to participate instead of relying on one-time injection.
- Fullscreen state is read from `document.fullscreenElement` in the top frame and broadcast to the other frames. Earlier builds inferred it from window dimensions, which also matched a merely *maximized* window, so the assist would crop the video inside a normal windowed page while Chrome's own UI was still on screen. There is no dimension test that separates maximized from fullscreen across taskbar and display-scaling setups, so it does not try.
- The assist writes exactly two CSS properties on the video, `object-fit` and `object-view-box`, and nothing else. Builds before 2.4.0 also stamped `position: fixed`, `inset`, `100vw/100vh` and `z-index: 2147483647` whenever the video was not itself the fullscreen element. That fired on the `fullscreenchange` event, while the site's player was still mid-transition, and tore the video out of flow underneath the player's own layout code. On Disney+ it stopped fullscreen working altogether: fullscreen worked with the extension off and failed with it on. Geometry is no longer touched at all.
- `Shift+D` toggles an on-screen diagnostic readout, parented inside the fullscreen element so it stays visible in fullscreen.
- `Shift+V` fullscreens the `<video>` element directly instead of its container. The UA stylesheet forces the fullscreen element to fill the screen, so this cannot be defeated by page layout, at the cost of the site's own controls and subtitles.
- While normalization is on, `Shift+F` does one of two things depending on where you are. Not in fullscreen yet: it enters fullscreen on the player container. Already in fullscreen: it cycles the picture through `native` (untouched), `fill`, and three zoom steps. `Esc` returns to `native`. Turning the normalizer on starts in `fill`.

## Fullscreen does not work while the normalizer is on

This is a Chromium design decision, not a bug in this extension, and it cannot be fixed
in extension code.

Audio tab capture increments the **visible** capturer count
(`stay_hidden=false` in `ForwardingAudioStreamFactory::LoopbackStreamStarted`). Any tab
that is being visibly captured has page-requested fullscreen diverted into
"fullscreen within tab" by `FullscreenController::MaybeToggleFullscreenWithinTab`, and
`EnterFullscreenModeForTab` then returns early with the comment *"the browser window
fullscreen state is unchanged"*. The page is told it is fullscreen and the video fills
the tab, but Chrome's own UI stays on screen.

**Use `F11`.** `F11` is browser fullscreen, a separate code path that capture does not
affect, confirmed working with the normalizer on. With Chrome's UI gone the page viewport
is the whole screen, and the fill mode makes the video cover it.

The extension detects `F11` by asking the browser outright: the service worker calls
`chrome.windows.get()` and reports whether `state === "fullscreen"`. It does not infer
this from `innerHeight` against `screen.height`, because every version of that
comparison also matched a merely maximized window and cropped the video inside an
ordinary windowed page. The extension never changes your window state itself.

Full source-level walkthrough: [docs/FULLSCREEN_AND_TAB_CAPTURE.md](docs/FULLSCREEN_AND_TAB_CAPTURE.md).

## Permissions and privacy

No audio is recorded, stored, or transmitted. No analytics, no telemetry, no network
requests of any kind. The extension has no server and nothing to send data to. Audio is
captured, passed through Web Audio nodes in memory, and played straight back out. When
you toggle it off, the stream's tracks are stopped and the `AudioContext` is closed.

Every permission and why it is needed:

| Permission | Why |
| --- | --- |
| `tabCapture` | The whole point. Captures the active tab's audio stream so it can be compressed. |
| `offscreen` | A Manifest V3 service worker cannot hold an `AudioContext`, so the audio graph lives in an offscreen document. |
| `activeTab` | Grants access to the tab you clicked the button on, so processing can start there. |
| `scripting` | Injects the fullscreen assist into tabs that were already open before the extension loaded. |
| `storage` | Remembers which tab is active and which fill mode is selected, in session storage. Cleared when Chrome closes. |
| `host_permissions: <all_urls>` | The fullscreen assist has to run on whatever streaming site you use, and the extension does not ship a hardcoded list of sites. |

`<all_urls>` is the broadest permission Chrome offers and it is fair to be wary of it.
The honest tradeoff is that a site allowlist would be narrower but would silently fail
on any service not on the list. Everything the content script does is in
[`fullscreen_assist.js`](fullscreen_assist.js); it reads video element dimensions and
sets CSS properties, and that is all.

## Why the 1.x fullscreen assist did nothing

Chrome's user agent stylesheet (`blink/renderer/core/css/fullscreen.css`) applies this to whatever element is fullscreen:

```
:not(:root):fullscreen {
  position: fixed !important;  inset: 0 !important;
  width: 100% !important;      height: 100% !important;
  min-width / max-width / min-height / max-height !important;
  margin: 0 !important;        transform: none !important;
  object-fit: contain;      /* intentionally not !important */
}
```

UA `!important` beats author `!important` in the cascade, so every geometry property the old build stamped onto the fullscreen element was discarded. The one property the UA deliberately leaves overridable is `object-fit`, and the old build set it to `contain`, which is the value already in effect. Both halves were no-ops, which is why nothing moved.

The rewrite therefore never fights the fullscreen element's geometry. It sets `object-fit: cover` to remove geometric letterboxing, and `object-view-box: inset(...)` to crop further for bars that are baked into the encoded frames. Both are author-overridable in fullscreen. Geometry is only forced on the video when the video is *not* itself the fullscreen element, which is the one case where the UA rules do not apply to it.

To see what the assist is looking at, open DevTools, switch the console's frame selector to the player frame, and run:

```js
window.__tabLoudnessNormalizerFullscreenAssist.probe()
```

## Stronger Windows-Wide Option

For a solution that affects every app and every browser, install **Equalizer APO** and add a compressor/limiter VST such as **ReaComp** from ReaPlugs. That is the most reliable route for DRM streaming apps because it processes audio after the browser/app has already sent it to Windows.

Good starting compressor settings:

- Ratio: `4:1` to `6:1`
- Threshold: around `-35 dB`
- Attack: `3 ms`
- Release: `200-300 ms`
- Auto makeup gain: on, or manually add `+4 dB`
- Add a limiter after it with ceiling around `-3 dB`

## License

MIT. See [LICENSE](LICENSE). Contributions welcome via issues and pull requests at
https://github.com/skamagedon/chrome-tab-loudness-normalizer
