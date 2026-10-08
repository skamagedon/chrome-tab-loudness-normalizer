(() => {
  const KEY = "__tabLoudnessNormalizerFullscreenAssist";

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
      // Set from the top frame's broadcast. Only consulted inside iframes.
      ancestorFullscreen: false,
    };

    window[KEY] = { enable, disable, setMode, probe };

    document.addEventListener("fullscreenchange", onFullscreenChange, true);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange, true);
    window.addEventListener("resize", schedule, true);
    document.addEventListener("keydown", handleKeydown, true);

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.target !== "fullscreen-assist") return;
      if (message.type === "mode") {
        state.enabled = true;
        setMode(message.mode);
      } else if (message.type === "fsstate") {
        state.ancestorFullscreen = !!message.active;
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
      schedule();
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

    function schedule() {
      if (state.rafId) return;
      state.rafId = requestAnimationFrame(() => {
        state.rafId = 0;
        apply();
      });
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

      // In the top frame the API answer is complete. No fullscreen element
      // means nothing in this tab is fullscreen, full stop.
      if (IS_TOP_FRAME) return false;

      // In an iframe we cannot read the parent's fullscreen state across
      // origins, so combine the top frame's broadcast with a tight size check:
      // a frame an ancestor fullscreened gets a viewport the size of the screen.
      if (!state.ancestorFullscreen) return false;

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

      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;

      state.writing = true;
      try {
        remember(video);

        // Geometry is only ours to set when the video is NOT the fullscreen
        // element. When it is, the UA owns every one of these properties.
        if (video !== fullscreenElement) {
          set(video, "position", "fixed");
          set(video, "inset", "0");
          set(video, "width", "100vw");
          set(video, "height", "100vh");
          set(video, "max-width", "100vw");
          set(video, "max-height", "100vh");
          set(video, "margin", "0");
          set(video, "z-index", "2147483647");
          set(video, "background", "black");
        }

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
      const request =
        target.requestFullscreen ||
        target.webkitRequestFullscreen ||
        target.webkitRequestFullScreen;
      if (!request) return false;

      try {
        const result = request.call(target);
        if (result && result.catch) {
          result.catch(() => {
            // Sandboxed or allow="fullscreen"-less iframes reject this. Fall
            // back to the top of this frame's own document.
            const root = document.documentElement;
            const rootRequest = root.requestFullscreen || root.webkitRequestFullscreen;
            if (rootRequest && target !== root) {
              try {
                const retry = rootRequest.call(root);
                if (retry && retry.catch) retry.catch(() => {});
              } catch {
                /* nothing further to try from here */
              }
            }
          });
        }
        return true;
      } catch {
        return false;
      }
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

    function remember(element) {
      if (state.styled.has(element)) return;
      state.styled.set(element, element.getAttribute("style"));
    }

    function restore() {
      stopObserving();
      state.writing = true;
      try {
        for (const [element, original] of state.styled) {
          if (!element.isConnected) continue;
          if (original === null) element.removeAttribute("style");
          else element.setAttribute("style", original);
        }
      } finally {
        state.writing = false;
      }
      state.styled.clear();
    }

    // Diagnostic hook. In the page console, with the frame selector on the
    // player frame:  window.__tabLoudnessNormalizerFullscreenAssist.probe()
    function probe() {
      const video = findLargestVisibleVideo();
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      const rect = video && video.getBoundingClientRect();
      return {
        frame: location.href,
        topFrame: IS_TOP_FRAME,
        enabled: state.enabled,
        mode: state.mode,
        nativeFullscreen: hasNativeFullscreen(),
        ancestorFullscreen: state.ancestorFullscreen,
        fullscreenHere: isFullscreenHere(),
        fullscreenElement: fullscreenElement
          ? fullscreenElement.tagName + "." + fullscreenElement.className
          : null,
        videoIsFullscreenElement: !!video && video === fullscreenElement,
        viewport: [window.innerWidth, window.innerHeight],
        video: video && {
          box: [rect.width, rect.height],
          intrinsic: [video.videoWidth, video.videoHeight],
          objectFit: getComputedStyle(video).objectFit,
          objectViewBox: getComputedStyle(video).objectViewBox,
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
