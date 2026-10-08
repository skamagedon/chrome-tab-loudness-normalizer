let audioContext;
let tabStream;
let currentTabId;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "start") {
    start(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "stop") {
    stop();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function start({ tabId, streamId }) {
  stop();
  currentTabId = tabId;

  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  audioContext = new AudioContext({ latencyHint: "interactive" });
  const source = audioContext.createMediaStreamSource(tabStream);

  const inputTrim = audioContext.createGain();
  inputTrim.gain.value = 0.9;

  const dialogueLift = audioContext.createDynamicsCompressor();
  dialogueLift.threshold.value = -46;
  dialogueLift.knee.value = 30;
  dialogueLift.ratio.value = 6;
  dialogueLift.attack.value = 0.004;
  dialogueLift.release.value = 0.28;

  const outputBoost = audioContext.createGain();
  outputBoost.gain.value = 1.45;

  const peakLimiter = audioContext.createDynamicsCompressor();
  peakLimiter.threshold.value = -9;
  peakLimiter.knee.value = 0;
  peakLimiter.ratio.value = 20;
  peakLimiter.attack.value = 0.001;
  peakLimiter.release.value = 0.08;

  const safetyTrim = audioContext.createGain();
  safetyTrim.gain.value = 0.615;

  source
    .connect(inputTrim)
    .connect(dialogueLift)
    .connect(outputBoost)
    .connect(peakLimiter)
    .connect(safetyTrim)
    .connect(audioContext.destination);

  tabStream.getAudioTracks().forEach((track) => {
    track.addEventListener("ended", () => {
      if (currentTabId === tabId) stop();
    });
  });
}

function stop() {
  currentTabId = undefined;

  if (tabStream) {
    tabStream.getTracks().forEach((track) => track.stop());
    tabStream = undefined;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = undefined;
  }
}
