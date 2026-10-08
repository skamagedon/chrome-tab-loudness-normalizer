const OFFSCREEN_DOCUMENT = "offscreen.html";
const MODES = ["native", "fill", "zoom115", "zoom130", "zoom150"];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "fullscreen-assist") return false;

  if (message.type === "ready") {
    chrome.storage.session.get(["activeTabId", "fullscreenMode"]).then(
      ({ activeTabId, fullscreenMode }) => {
        sendResponse({
          enabled: sender.tab?.id === activeTabId,
          mode: fullscreenMode || "native",
        });
      },
    );
    return true;
  }

  // Only the top frame can read document.fullscreenElement for the tab. Relay
  // its answer to every frame so iframes never have to guess from dimensions.
  if (message.type === "fsstate") {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.tabs
        .sendMessage(tabId, {
          target: "fullscreen-assist",
          type: "fsstate",
          active: !!message.active,
        })
        .catch(() => {});
    }
    return false;
  }

  // Shift+F arrives in whichever frame has focus, which is usually not the
  // frame holding the video. Advance the mode centrally and relay it to every
  // frame in the tab.
  if (message.type === "cycle") {
    const tabId = sender.tab?.id;
    if (!tabId) return false;

    chrome.storage.session.get("fullscreenMode").then(async ({ fullscreenMode }) => {
      const next = MODES[(MODES.indexOf(fullscreenMode || "native") + 1) % MODES.length];
      await chrome.storage.session.set({ fullscreenMode: next });
      // No frameId, so this reaches every frame in the tab.
      await chrome.tabs
        .sendMessage(tabId, { target: "fullscreen-assist", type: "mode", mode: next })
        .catch(() => {});
      sendResponse({ mode: next });
    });

    return true;
  }

  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    const capturedTabs = await chrome.tabCapture.getCapturedTabs();
    const isCaptured = capturedTabs.some(
      (captured) => captured.tabId === tab.id && captured.status === "active",
    );

    if (isCaptured) {
      await stopNormalizer(tab.id);
      return;
    }

    await startNormalizer(tab.id);
  } catch (error) {
    console.error("Could not toggle tab loudness normalizer:", error);
    await chrome.action.setBadgeText({ tabId: tab.id, text: "ERR" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#d93025" });
  }
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  if (info.status === "stopped" || info.status === "error") {
    chrome.action.setBadgeText({ tabId: info.tabId, text: "" });
  }
});

async function startNormalizer(tabId) {
  await ensureOffscreenDocument();

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    tabId,
    streamId,
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Chrome refused tab audio capture.");
  }

  await chrome.storage.session.set({ activeTabId: tabId, fullscreenMode: "fill" });
  await enableFullscreenAssist(tabId);
  await chrome.action.setBadgeText({ tabId, text: "ON" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#1677ff" });
}

async function stopNormalizer(tabId) {
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "stop",
    tabId,
  });

  await chrome.storage.session.remove(["activeTabId", "fullscreenMode"]);
  await chrome.action.setBadgeText({ tabId, text: "" });
  await disableFullscreenAssist(tabId);
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT)],
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["USER_MEDIA"],
    justification: "Capture and process the active tab audio for loudness normalization.",
  });
}

async function enableFullscreenAssist(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["fullscreen_assist.js"],
    });

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__tabLoudnessNormalizerFullscreenAssist?.enable?.("fill"),
    });
  } catch (error) {
    console.warn("Fullscreen assist could not be injected:", error);
  }
}

async function disableFullscreenAssist(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__tabLoudnessNormalizerFullscreenAssist?.disable?.(),
    });
  } catch (error) {
    console.warn("Fullscreen assist could not be disabled:", error);
  }
}
