(() => {
  const KEY = "__tabLoudnessNormalizerFullscreenAssist";
  const VERSION = "2.5.0";

  // Chrome's UA stylesheet (blink/renderer/core/css/fullscreen.css) stamps
  // position, inset, width, height, min/max-width, min/max-height, margin and
  // transform onto the fullscreen element with !important. UA !important beats
  // author !important, so nothing we set on that element changes its geometry.
  // The same sheet sets `object-fit: contain` and comments it "intentionally
  // not !important", so object-fit and object-view-box are the two levers an
  // author actually gets. Everything below goes through those two.
  const MODES = ["native", "fill", "zoom115", "zoom130", "zoom150"];
  const ZOOM = { native: 1, fill: 1, zoom115: 1.15, zoom130: 1.3, zoom150: 1.5 };

  const IS_TOP_FRAME = window.top === window;

  if (!window[KEY]) {
    const state = {
      enabled: false,
      mode: "native",
      styled: new Map(),
      observer: undefined,
      writing: false,
      rafId: 0,
      timeoutId: 0,
      scheduled: false,
      // Set from the top frame's broadcast. Only consulted inside iframes.
      ancestorFullscreen: false,
      browserFullscreen: false,
      lastFullscreenError: "none",
      debugEl: undefined,
      debugTimer: 0,
    };

    window[KEY] = { enable, disable, setMode, probe, debug: toggleDebugOverlay };

    document.addEventListener("fullscreenchange", onFullscreenChange, true);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange, true);
    // F11 fires a resize but sets no fullscreen element, so a resize is the
    // cue to re-ask Chrome what the window state actually is.
    window.addEventListener("resize", onResize, true);
    document.addEventListener("keydown", handleKeydown, true);

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.target !== "fullscreen-assist") return;
      if (message.type === "mode") {
        state.enabled = true;
        setMode(message.mode);
      } else if (message.type === "fsstate") {
        state.ancestorFullscreen = !!message.active;
        schedule();
      } else if (message.type === "windowstate") {
        state.browserFullscreen = !!message.browserFullscreen;
        schedule();
      } else if (message.type === "disable") {
        disable();
      }
    });

    function onFullscreenChange() {
      // Only the top frame knows the truth for the whole tab. It tells the
      // others, so no frame has to infer fullscreen from its own dimensions.
      if (IS_TOP_FRAME) {
        chrome.runtime
          .sendMessage({
            target: "fullscreen-assist",
            type: "fsstate",
            active: hasNativeFullscreen(),
          })
          .catch(() => {});
      }
      schedule();
    }

    function enable(mode) {
      state.enabled = true;
      if (mode) state.mode = mode;
      requestWindowState();
      schedule();
    }

    function onResize() {
      requestWindowState();
      schedule();
    }

    // Only the service worker can call chrome.windows.get. Ask it, rather than
    // inferring browser fullscreen from innerHeight against screen.height:
    // every version of that comparison also matched a maximized window.
    function requestWindowState() {
      chrome.runtime
        .sendMessage({ target: "fullscreen-assist", type: "windowstate" })
        .then((response) => {
          if (!response) return;
          const next = !!response.browserFullscreen;
          if (next !== state.browserFullscreen) {
            state.browserFullscreen = next;
            schedule();
          }
          state.windowState = response.state;
        })
        .catch(() => {});
    }

    function disable() {
      state.enabled = false;
      state.mode = "native";
      stopObserving();
      restore();
    }

    function setMode(mode) {
      if (!MODES.includes(mode)) return;
      state.mode = mode;
      if (mode === "native") restore();
      schedule();
    }

    // rAF alone is not reliable here. Browsers throttle or suspend it whenever
    // the page is not being rendered, and a fullscreen transition is exactly
    // the moment rendering is in flux. Race a timer against it so a suspended
    // rAF cannot strand the state; whichever fires first wins and cancels the
    // other.
    function schedule() {
      if (state.scheduled) return;
      state.scheduled = true;

      const run = () => {
        if (!state.scheduled) return;
        state.scheduled = false;
        cancelAnimationFrame(state.rafId);
        clearTimeout(state.timeoutId);
        state.rafId = 0;
        state.timeoutId = 0;
        apply();
      };

      state.rafId = requestAnimationFrame(run);
      state.timeoutId = setTimeout(run, 100);
    }

    // The old build decided "are we fullscreen" from window.outerWidth against
    // screen.width, and 2.0.0 replaced that with innerWidth/innerHeight. Both
    // were guesses, and both returned true for a merely MAXIMIZED window, which
    // made the assist crop the video inside a normal windowed page while Chrome's
    // own UI was still on screen. There is no dimension test that separates
    // "maximized" from "fullscreen" reliably across taskbar and scaling setups,
    // so stop guessing: the top frame reads document.fullscreenElement, which is
    // authoritative, and broadcasts it. Iframes trust that broadcast.
    function hasNativeFullscreen() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    function isFullscreenHere() {
      if (hasNativeFullscreen()) return true;

      // In the top frame the answer is complete without guessing: either the
      // page is fullscreen (checked above) or the window is, and the window
      // state comes from chrome.windows.get via the service worker rather than
      // from any dimension comparison.
      if (IS_TOP_FRAME) return state.browserFullscreen;

      // In an iframe we cannot read the parent's fullscreen state across
      // origins, so combine the broadcast state with a tight size check: a
      // frame filling a fullscreen window gets a screen-sized viewport.
      if (!state.ancestorFullscreen && !state.browserFullscreen) return false;

      const sw = screen.width || 0;
      const sh = screen.height || 0;
      if (!sw || !sh) return false;
      return window.innerWidth >= sw * 0.98 && window.innerHeight >= sh * 0.98;
    }

    function apply() {
      if (!state.enabled || state.mode === "native" || !isFullscreenHere()) {
        restore();
        return;
      }

      const video = findLargestVisibleVideo();
      if (!video) {
        restore();
        return;
      }

      state.writing = true;
      try {
        remember(video);

        // NO GEOMETRY. Earlier builds stamped position:fixed, inset, 100vw/100vh
        // and z-index:2147483647 onto the video whenever it was not itself the
        // fullscreen element. That fired on the fullscreenchange event, which is
        // while the site's player is still mid-transition, and it tore the video
        // out of flow underneath the player's own layout code. On Disney+ that
        // stopped fullscreen working at all: it worked with the extension off
        // and failed with it on. It also covered the player's controls with an
        // opaque black box at the top of the stacking order.
        //
        // object-fit and object-view-box are enough. They are the only
        // properties Chrome's UA fullscreen rules leave overridable, they are
        // the only ones that had any effect in the first place, and neither
        // changes the element's box, so neither can disturb the player's layout.
        set(video, "object-fit", "cover");

        const zoom = ZOOM[state.mode] || 1;
        if (zoom > 1) {
          const inset = ((1 - 1 / zoom) / 2) * 100;
          set(video, "object-view-box", "inset(" + inset.toFixed(4) + "%)");
        } else {
          video.style.removeProperty("object-view-box");
        }
      } finally {
        state.writing = false;
      }

      observe(video);
    }

    function set(element, property, value) {
      element.style.setProperty(property, value, "important");
    }

    // Players rewrite inline styles on the video whenever they relayout, which
    // silently undid the old build's work between its 500ms polls. Watch the
    // style attribute instead of racing it on a timer.
    function observe(video) {
      if (state.observer) return;
      state.observer = new MutationObserver(() => {
        if (state.writing) return;
        schedule();
      });
      state.observer.observe(video, { attributes: true, attributeFilter: ["style"] });
    }

    function stopObserving() {
      if (!state.observer) return;
      state.observer.disconnect();
      state.observer = undefined;
    }

    function handleKeydown(event) {
      if (!state.enabled || event.defaultPrevented) return;
      if (isEditable(event.target)) return;

      if (event.key === "Escape") {
        setMode("native");
        return;
      }

      // Shift+D: on-screen diagnostic readout. Exists because reading this
      // state through DevTools means picking the right frame first, and the
      // frame that matters is usually not the one DevTools opens on.
      if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        event.stopPropagation();
        toggleDebugOverlay();
        return;
      }

      // Shift+V: fullscreen the <video> element itself rather than its
      // container. The UA stylesheet forces the fullscreen element to fill the
      // screen with !important, so this cannot be defeated by a transformed
      // ancestor or a container that sizes itself wrong. The cost is the site's
      // own controls and subtitle layer, which are siblings of the video and so
      // are not rendered inside its fullscreen subtree.
      if (event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        event.stopPropagation();
        const video = findLargestVisibleVideo();
        if (!video) return;
        if (hasNativeFullscreen()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) {
            try {
              const done = exit.call(document);
              if (done && done.then) {
                done.then(() => fullscreenElement(video)).catch(() => {});
                return;
              }
            } catch {
              /* fall through and try directly */
            }
          }
        }
        fullscreenElement(video);
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();

        // Two jobs on one key, and which one depends on where we are. If we are
        // not in fullscreen yet, enter it and leave the mode alone. Only once we
        // are already fullscreen does Shift+F advance through the fill modes.
        // requestFullscreen needs the user activation from this very keydown, so
        // it has to happen here, in the frame that received the key, and cannot
        // be relayed to another frame.
        // Gate on the real fullscreen state, not isFullscreenHere(). That
        // helper deliberately treats a screen-sized viewport as fullscreen so
        // it can style iframes an ancestor fullscreened, but a merely maximized
        // window can also satisfy it, which would swallow the request.
        if (!hasNativeFullscreen() && requestFullscreenHere()) return;

        // The focused frame is often not the frame holding the video, so the
        // service worker relays the new mode to every frame in the tab.
        chrome.runtime
          .sendMessage({ target: "fullscreen-assist", type: "cycle" })
          .catch(() => {
            setMode(MODES[(MODES.indexOf(state.mode) + 1) % MODES.length]);
          });
      }
    }

    // Returns true if a fullscreen request was actually issued from this frame.
    function requestFullscreenHere() {
      const video = findLargestVisibleVideo();
      if (!video) return false;

      const target = choosePlayerRoot(video);
      return fullscreenElement(target, video);
    }

    // Records why a request failed so the Shift+D readout can show it, since a
    // rejected fullscreen request is otherwise completely silent.
    function fullscreenElement(target, fallback) {
      const request =
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.webkitRequestFullScreen;
      if (!request) {
        state.lastFullscreenError = "no requestFullscreen on target";
        return false;
      }

      try {
        state.lastFullscreenError = "pending";
        const result = request.call(target);
        if (result && result.then) {
          result
            .then(() => {
              state.lastFullscreenError = "ok";
            })
            .catch((error) => {
              state.lastFullscreenError = (error && error.name) || "rejected";
              // Sandboxed iframes and iframes without allow="fullscreen" reject
              // this. Try the bare video, then this frame's documentElement.
              const next = fallback && fallback !== target ? fallback : document.documentElement;
              if (next && next !== target) {
                const retry =
                  next.requestFullscreen || next.webkitRequestFullscreen;
                if (retry) {
                  try {
                    const again = retry.call(next);
                    if (again && again.catch) {
                      again.catch((e2) => {
                        state.lastFullscreenError =
                          "both rejected: " + ((e2 && e2.name) || "unknown");
                      });
                    }
                  } catch {
                    /* nothing further to try from here */
                  }
                }
              }
            });
        }
        return true;
      } catch (error) {
        state.lastFullscreenError = "threw: " + ((error && error.name) || "unknown");
        return false;
      }
    }

    // position: fixed is relative to the viewport only if no ancestor creates a
    // containing block. transform, filter, backdrop-filter, perspective,
    // will-change on those, and contain: paint/layout/strict all do. Video
    // players use them constantly for compositing, and when one is present the
    // stamped 100vw/100vh box lands relative to that ancestor instead of the
    // screen. This is the prime suspect for "fills the old content area".
    function findContainingBlockAncestor(video) {
      let node = video.parentElement;
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        const reasons = [];
        if (cs.transform && cs.transform !== "none") reasons.push("transform");
        if (cs.filter && cs.filter !== "none") reasons.push("filter");
        if (cs.backdropFilter && cs.backdropFilter !== "none") reasons.push("backdrop-filter");
        if (cs.perspective && cs.perspective !== "none") reasons.push("perspective");
        if (cs.contain && /paint|layout|strict|content/.test(cs.contain)) reasons.push("contain:" + cs.contain);
        if (cs.willChange && /transform|filter|perspective/.test(cs.willChange)) reasons.push("will-change:" + cs.willChange);
        if (reasons.length) {
          return {
            tag: node.tagName.toLowerCase(),
            cls: String(node.className || "").slice(0, 60),
            reasons: reasons.join(", "),
          };
        }
        node = node.parentElement;
      }
      return null;
    }

    // Fullscreening the player's container rather than the bare <video> keeps
    // the site's own controls and subtitle layers on screen. Walk up until the
    // box stops growing meaningfully, then stop short of body/documentElement.
    function choosePlayerRoot(video) {
      let node = video.parentElement;
      let best = video;
      const viewportArea = window.innerWidth * window.innerHeight;

      while (node && node !== document.body && node !== document.documentElement) {
        const rect = node.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > viewportArea * 0.15) best = node;
        if (area > viewportArea * 0.95) break;
        node = node.parentElement;
      }

      return best;
    }

    function isEditable(target) {
      if (!target) return false;
      const tagName = target.tagName;
      return (
        target.isContentEditable ||
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT"
      );
    }

    function findLargestVisibleVideo() {
      let best;
      let bestArea = 0;

      for (const video of collectVideos(document)) {
        const rect = video.getBoundingClientRect();
        const style = window.getComputedStyle(video);
        const area = rect.width * rect.height;

        if (
          area > bestArea &&
          rect.width > 120 &&
          rect.height > 80 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        ) {
          best = video;
          bestArea = area;
        }
      }

      return best;
    }

    function collectVideos(root) {
      const videos = Array.from(root.querySelectorAll("video"));
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) videos.push(...collectVideos(element.shadowRoot));
      }
      return videos;
    }

    // The only two properties this script ever writes. Remember and restore
    // exactly these, rather than snapshotting and rewriting the whole style
    // attribute: players rewrite inline styles on the video constantly, and
    // restoring a stale snapshot wiped whatever the player had set since.
    const OWNED = ["object-fit", "object-view-box"];

    function remember(element) {
      if (state.styled.has(element)) return;
      const saved = {};
      for (const property of OWNED) {
        saved[property] = {
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        };
      }
      state.styled.set(element, saved);
    }

    function restore() {
      stopObserving();
      state.writing = true;
      try {
        for (const [element, saved] of state.styled) {
          if (!element.isConnected) continue;
          for (const property of OWNED) {
            element.style.removeProperty(property);
            const original = saved[property];
            if (original && original.value) {
              element.style.setProperty(property, original.value, original.priority);
            }
          }
        }
      } finally {
        state.writing = false;
      }
      state.styled.clear();
    }

    function toggleDebugOverlay() {
      if (state.debugEl) {
        state.debugEl.remove();
        state.debugEl = undefined;
        clearInterval(state.debugTimer);
        state.debugTimer = 0;
        return;
      }

      const el = document.createElement("div");
      el.style.cssText = [
        "position:fixed",
        "top:8px",
        "left:8px",
        "z-index:2147483647",
        "background:rgba(0,0,0,.88)",
        "color:#0f0",
        "font:12px/1.45 Consolas,monospace",
        "padding:10px 12px",
        "border:1px solid #0f0",
        "border-radius:4px",
        "white-space:pre",
        "pointer-events:none",
        "max-width:92vw",
        "max-height:92vh",
        "overflow:hidden",
      ].join(";");
      state.debugEl = el;
      mountDebugOverlay();
      renderDebug();
      state.debugTimer = setInterval(() => {
        mountDebugOverlay();
        renderDebug();
      }, 400);
    }

    // In fullscreen, only the fullscreen element's subtree is rendered. An
    // overlay parented to <body> is simply invisible, so it has to be moved
    // inside whatever element is currently fullscreen.
    function mountDebugOverlay() {
      if (!state.debugEl) return;
      const host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
      if (host && state.debugEl.parentNode !== host) host.appendChild(state.debugEl);
    }

    function renderDebug() {
      if (!state.debugEl) return;
      const p = probe();
      const lines = [
        "TAB LOUDNESS NORMALIZER " + VERSION + "  [Shift+D to hide]",
        "frame            " + (p.topFrame ? "TOP" : "IFRAME") + "  " + shorten(p.frame),
        "enabled / mode   " + p.enabled + " / " + p.mode,
        "nativeFullscreen " + p.nativeFullscreen,
        "ancestorFS       " + p.ancestorFullscreen,
        "browserFS (F11)  " + p.browserFullscreen + "   windowState=" + p.windowState,
        "fullscreenHere   " + p.fullscreenHere + (p.fullscreenHere ? "   <-- styles applied" : "   <-- styles NOT applied"),
        "fsElement        " + p.fullscreenElement,
        "videoIsFsElement " + p.videoIsFullscreenElement,
        "lastFSrequest    " + p.lastFullscreenError,
        "viewport         " + p.viewport.join(" x "),
        "screen           " + p.screen.join(" x "),
      ];
      if (p.video) {
        lines.push(
          "video box        " + p.video.box.map(Math.round).join(" x "),
          "video intrinsic  " + p.video.intrinsic.join(" x "),
          "object-fit       " + p.video.objectFit,
          "object-view-box  " + p.video.objectViewBox,
          "video position   " + p.video.position,
          "in shadow DOM    " + p.video.inShadowDOM,
        );
      } else {
        lines.push("video            NONE FOUND IN THIS FRAME");
      }
      lines.push(
        "fixed-pos broken " +
          (p.containingBlock
            ? "YES by <" + p.containingBlock.tag + " class=" + p.containingBlock.cls + "> (" + p.containingBlock.reasons + ")"
            : "no"),
      );
      state.debugEl.textContent = lines.join("\n");
    }

    function shorten(url) {
      return url.length > 58 ? url.slice(0, 55) + "..." : url;
    }

    // Diagnostic hook. In the page console, with the frame selector on the
    // player frame:  window.__tabLoudnessNormalizerFullscreenAssist.probe()
    function probe() {
      const video = findLargestVisibleVideo();
      // Named fsEl, not fullscreenElement, so it does not shadow the
      // fullscreenElement() helper declared above.
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      const rect = video && video.getBoundingClientRect();
      const cs = video && getComputedStyle(video);
      return {
        frame: location.href,
        topFrame: IS_TOP_FRAME,
        enabled: state.enabled,
        mode: state.mode,
        nativeFullscreen: hasNativeFullscreen(),
        ancestorFullscreen: state.ancestorFullscreen,
        browserFullscreen: state.browserFullscreen,
        windowState: state.windowState || "unknown",
        fullscreenHere: isFullscreenHere(),
        fullscreenElement: fsEl ? fsEl.tagName + "." + String(fsEl.className).slice(0, 50) : null,
        videoIsFullscreenElement: !!video && video === fsEl,
        lastFullscreenError: state.lastFullscreenError,
        viewport: [window.innerWidth, window.innerHeight],
        screen: [screen.width, screen.height],
        containingBlock: video ? findContainingBlockAncestor(video) : null,
        video: video && {
          box: [rect.width, rect.height],
          intrinsic: [video.videoWidth, video.videoHeight],
          objectFit: cs.objectFit,
          objectViewBox: cs.objectViewBox,
          position: cs.position,
          inShadowDOM: video.getRootNode() !== document,
        },
      };
    }
  }

  chrome.runtime
    .sendMessage({ target: "fullscreen-assist", type: "ready" })
    .then((response) => {
      if (response?.enabled) window[KEY].enable(response.mode);
    })
    .catch(() => {});
})();
