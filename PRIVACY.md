# Privacy Policy

**Tab Loudness Normalizer**
Last updated: 2026-10-08

## Short version

This extension collects nothing, stores nothing about you, and sends nothing anywhere.
It has no server, no analytics, and makes no network requests.

## What the extension accesses

**Tab audio.** When you click the extension's button, it captures the audio of that tab
using Chrome's `tabCapture` API, routes it through a compressor and limiter built from
Web Audio nodes, and plays the result back through your normal output device. The audio
exists only as an in-memory stream for as long as processing is on. It is never written
to disk, never buffered for later, never analyzed for content, and never transmitted.
Turning the extension off stops the media tracks and closes the audio context, which
discards everything.

**Page content.** A content script runs on pages so it can adjust how video is sized in
fullscreen. It reads the dimensions and fullscreen state of `<video>` elements and sets
CSS properties on them. It does not read page text, form fields, cookies, credentials,
or browsing history, and it does not modify page content beyond those CSS properties.

**Session storage.** Chrome's `chrome.storage.session` holds two values: the ID of the
tab currently being processed, and which fullscreen fill mode is selected. Session
storage is cleared when Chrome closes and is never transmitted.

## What the extension does not do

- No data collection of any kind
- No analytics, telemetry, crash reporting, or usage statistics
- No network requests, to any server, including the author's
- No cookies, tracking identifiers, or fingerprinting
- No recording, saving, or uploading of audio or video
- No selling or sharing of data, because none is collected

## Permissions

See the [Permissions and privacy](README.md#permissions-and-privacy) section of the
README for a per-permission explanation.

## Source

The complete source is public at
https://github.com/skamagedon/chrome-tab-loudness-normalizer and is MIT licensed. The
extension is small enough to read end to end, and every claim above is verifiable from
the source.

## Contact

Open an issue at
https://github.com/skamagedon/chrome-tab-loudness-normalizer/issues
