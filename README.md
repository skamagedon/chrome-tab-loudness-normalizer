# Tab Loudness Normalizer

One-click Chrome extension for the classic streaming problem: speech is quiet, action is loud.

It captures the active tab's audio, runs it through a dialogue-focused compressor and peak limiter, then plays the processed audio back through your normal output device. It does not record, save, upload, or inspect audio.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `chrome-tab-loudness-normalizer`.

## Use

1. Open the HBO, Disney, Netflix, Hulu, Prime, YouTube, or other tab you want to tame.
2. Start playback.
3. Click the extension icon once. The badge shows `ON`.
4. Click it again to turn processing off.

Version `2.2.0` keeps the 1.3.0 audio chain unchanged and rewrites the fullscreen assist, which never worked in 1.x. See below.

## Notes

- This works at the Chrome tab audio layer, so it is more likely to work on streaming sites than a script that edits the page's `<video>` element.
- Some DRM/protected playback setups may refuse tab audio capture. If that happens, use the system-wide Windows option below.
- There is a small latency cost because Chrome is routing the tab through the Web Audio API.
- The fullscreen assist script loads as a real all-frame content script, so late player frames get a chance to participate instead of relying on one-time injection.
- Fullscreen state is read from `document.fullscreenElement` in the top frame and broadcast to the other frames. Earlier builds inferred it from window dimensions, which also matched a merely *maximized* window, so the assist would crop the video inside a normal windowed page while Chrome's own UI was still on screen. There is no dimension test that separates maximized from fullscreen across taskbar and display-scaling setups, so it does not try.
- While normalization is on, `Shift+F` does one of two things depending on where you are. Not in fullscreen yet: it enters fullscreen on the player container. Already in fullscreen: it cycles the picture through `native` (untouched), `fill`, and three zoom steps. `Esc` returns to `native`. Turning the normalizer on starts in `fill`.

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
