# Why fullscreen does not work while the normalizer is on

Short version: **this is not fixable in extension code.** While a tab's audio is being
captured, Chromium deliberately redirects page-requested fullscreen into a mode that
keeps the browser window exactly as it is. The video goes fullscreen *inside the tab*
and Chrome's UI stays on screen.

The chain below is from Chromium source, not inference.

## 1. Audio tab capture counts as *visible* capture

`content/browser/media/forwarding_audio_stream_factory.cc`

```cpp
void ForwardingAudioStreamFactory::LoopbackStreamStarted() {
  capture_handle_ = web_contents()->IncrementCapturerCount(
      gfx::Size(), /*stay_hidden=*/false,
      /*stay_awake=*/true, /*is_activity=*/true);
}
```

`stay_hidden=false` is the whole problem. There is a hidden-capture path that avoids
side effects on the page, and audio loopback capture does not use it.

## 2. That increments `visible_capturer_count_`

`content/browser/web_contents/web_contents_impl.cc`

```cpp
if (stay_hidden) {
  ++hidden_capturer_count_;
} else {
  ++visible_capturer_count_;
}
...
bool WebContentsImpl::IsBeingVisiblyCaptured() {
  return visible_capturer_count_ > 0;
}
```

## 3. Visible capture diverts fullscreen into "fullscreen within tab"

`chrome/browser/ui/exclusive_access/fullscreen_controller.cc`

```cpp
bool FullscreenController::MaybeToggleFullscreenWithinTab(
    WebContents* web_contents, bool enter_fullscreen) {
  if (enter_fullscreen) {
    if (web_contents->IsBeingVisiblyCaptured()) {
      FullscreenWithinTabHelper::CreateForWebContents(web_contents);
      FullscreenWithinTabHelper::FromWebContents(web_contents)
          ->SetIsFullscreenWithinTab(true);
      return true;
    }
  }
  ...
}
```

## 4. And that makes the browser window stay windowed

```cpp
void FullscreenController::EnterFullscreenModeForTab(...) {
  ...
  if (MaybeToggleFullscreenWithinTab(web_contents, true)) {
    // During tab capture of fullscreen-within-tab views, the browser window
    // fullscreen state is unchanged, so return now.
    return;
  }
```

The comment says it outright. `GetFullscreenState()` reports this as
`FullscreenMode::kPseudoContent` rather than `kContent`.

## What this explains

- `document.fullscreenElement` **is** set, and the `requestFullscreen()` promise
  **does** resolve. Nothing reports an error. The page genuinely believes it is
  fullscreen, which is why the UA fullscreen stylesheet applies and the video expands
  to fill the tab's viewport.
- The browser window never changes. Tabs, omnibox and bookmarks bar stay visible.
- Fullscreen works normally the moment capture stops.
- It makes no difference whether the site's own button, `Shift+F`, or `Shift+V` is used.
  All three go through `EnterFullscreenModeForTab`.
- No amount of CSS, element choice, or timing changes this. The decision is made in the
  browser process before the renderer is told anything.

It is also intentional, not a defect: a capturer is consuming the tab's rendered output
at a particular size, so letting the window resize underneath it would corrupt the
capture.

## The workaround

`F11` is a different code path. `ToggleBrowserFullscreenMode` uses
`FullscreenInternalOption::kBrowser` and never calls `MaybeToggleFullscreenWithinTab`,
so browser fullscreen is not affected by capture.

So: **press F11 first, then use the fill mode.** F11 removes Chrome's UI, which makes
the page viewport the whole screen, and `object-fit: cover` then makes the video fill
it. The site's own fullscreen button remains useless while the normalizer is on.

## The alternative

Process audio without capturing the tab, using `createMediaElementSource` on the page's
`<video>` from a content script. No capture means no capturer count and no
fullscreen-within-tab. The catch is that it cannot work on DRM-protected playback:
Widevine audio is not reachable from Web Audio, which rules out Disney+, HBO, Netflix
and Prime. It would work on YouTube and other unprotected sources.

For DRM services, a system-level compressor such as Equalizer APO is the only route
that leaves fullscreen alone. See the README.
