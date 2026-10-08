# Chrome Web Store submission pack

Everything the listing form asks for, pre-written. You still need to create the
developer account and submit; nobody else can do that for you.

## Before you start

- One-time **$5 USD** developer registration fee at
  https://chrome.google.com/webstore/devconsole
- The account must have 2-Step Verification enabled
- Review takes anywhere from a few days to several weeks. Extensions using
  `tabCapture` with `<all_urls>` reliably draw extra scrutiny, so expect the
  longer end and possibly a request for clarification

## Package to upload

Build it with:

```
git archive --format=zip --prefix= -o chrome-tab-loudness-normalizer-X.Y.Z.zip HEAD
```

The store wants a zip whose **root** contains `manifest.json`, which is what that
command produces. Do not zip the enclosing folder.

## Listing fields

**Name**

```
Tab Loudness Normalizer
```

**Short description** (132 character limit)

```
Compresses tab audio so quiet dialogue stays audible and loud action scenes stop blowing out your speakers.
```

**Category**: Accessibility
**Language**: English

**Detailed description**

```
Streaming audio has a problem: dialogue is mixed quiet and action is mixed loud. You
turn it up to hear what someone said, then an explosion takes the roof off. This fixes
that for whatever tab you are watching.

Click the button once and the tab's audio runs through a dialogue-focused compressor
and a peak limiter, then plays back through your normal speakers or headphones. Click
again to turn it off.

It also fixes a second annoyance: video that does not fill the screen in fullscreen.
Press Shift+F while fullscreen to crop the letterbox bars, with several zoom steps.

WHAT IT DOES NOT DO

No audio is recorded, saved, or uploaded. There are no analytics, no telemetry, and no
network requests at all. The extension has no server. Audio is processed in memory and
played straight back out. The complete source is public and MIT licensed:
https://github.com/skamagedon/chrome-tab-loudness-normalizer

NOTES

There is a small latency cost, since audio is routed through the Web Audio API.
Some DRM-protected playback may refuse tab audio capture entirely.
Requires Chrome 116 or newer.
```

**Single purpose** (required field, keep it to one sentence)

```
Normalize the loudness of the active browser tab's audio so that quiet dialogue and
loud peaks sit closer together in volume.
```

## Permission justifications

The console asks for these one at a time. Each must explain why the extension cannot
work without it.

**tabCapture**

```
This is the core function of the extension. It captures the active tab's audio stream
so it can be passed through a compressor and limiter and played back at a more even
volume. No other API provides access to tab audio.
```

**offscreen**

```
A Manifest V3 service worker cannot hold a live AudioContext, since it is terminated
when idle. The audio processing graph is therefore hosted in an offscreen document,
which is the mechanism Chrome documents for exactly this case.
```

**activeTab**

```
Grants access to the tab the user clicked the toolbar button on, so audio capture and
the fullscreen helper can be started on that tab specifically.
```

**scripting**

```
Injects the fullscreen helper into tabs that were already open before the extension was
installed or reloaded, which declarative content scripts do not cover.
```

**storage**

```
Stores two values in session storage: which tab is currently being processed, and which
fullscreen fill mode is selected. Both are cleared when the browser closes. No user data
is stored.
```

**Host permission `<all_urls>`**

```
The fullscreen helper must run on whichever video site the user is watching. The
extension deliberately ships no hardcoded site list, because any such list would
silently fail on services not included in it. The content script only reads video
element dimensions and fullscreen state and sets CSS properties on video elements. It
does not read page text, form input, cookies, or credentials, and makes no network
requests. The full source is public at
https://github.com/skamagedon/chrome-tab-loudness-normalizer
```

Expect this one to be the sticking point. If the reviewer pushes back, the fallback is
to narrow `content_scripts.matches` to a named list of streaming domains and accept that
the fullscreen assist stops working on anything not listed.

## Privacy tab

- **Single purpose**: as above
- **Data usage**: tick nothing. The extension collects no user data in any of Chrome's
  listed categories
- You must check all three certification boxes (no selling data, no unrelated use, no
  creditworthiness use); all three are true
- **Privacy policy URL**:
  `https://github.com/skamagedon/chrome-tab-loudness-normalizer/blob/main/PRIVACY.md`

## What is still missing

**Screenshots are mandatory and I could not make them.** The store requires at least one
at 1280x800 or 640x400. These have to be real captures of the extension working, which
means you taking them:

1. A streaming tab playing with the badge showing `ON`
2. The same video in fullscreen with the bars cropped, ideally beside the uncropped version
3. `chrome://extensions` showing the extension card

A 440x280 small promo tile is optional but improves placement.

Do not submit screenshots that misrepresent what the extension does; that is a common
rejection reason.
