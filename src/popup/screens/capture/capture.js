(function () {
  const startBtn = document.getElementById("start");
  const finishBtn = document.getElementById("finish");
  const cancelBtn = document.getElementById("cancel");
  const downloadBtn = document.getElementById("download");
  const statusEl = document.getElementById("status");
  const timeRemEl = document.getElementById("timeRem");

  if (!startBtn) {
    console.error("Capture screen not loaded");
    return;
  }

  let currentTabId = null;
  let isCapturing = false;
  let startTime = null;
  let timerInterval = null;
  let transcriptionResult = null;
  const MAX_CAPTURE_TIME = 30 * 60 * 1000;

  // Get current tab ID
  async function getCurrentTabId() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab ? tab.id : null;
    } catch (err) {
      console.error("Error getting current tab:", err);
      return null;
    }
  }

  // Load recording state for current tab from background
  async function loadTabRecordingState() {
    if (!currentTabId) return;

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "getRecordingState", tabId: currentTabId },
          resolve
        );
      });

      if (response && response.success && response.state) {
        isCapturing = response.state.isRecording;
        startTime = response.state.startTime;

        if (isCapturing && startTime) {
          startTimer();
        }
      } else {
        isCapturing = false;
        startTime = null;
      }
    } catch (err) {
      console.error("Error loading recording state:", err);
      isCapturing = false;
      startTime = null;
    }

    updateUI();
  }

  function updateUI() {
    startBtn.style.display = isCapturing ? "none" : "block";
    finishBtn.style.display = isCapturing ? "block" : "none";
    cancelBtn.style.display = isCapturing ? "block" : "none";
    statusEl.textContent = isCapturing
      ? "Capture in progress..."
      : "Ready to capture";
    if (!isCapturing) timeRemEl.textContent = "";
    // Hide download button when not recording and no transcription available
    if (downloadBtn && !transcriptionResult) {
      downloadBtn.style.display = "none";
    }
  }

  function updateTimeRemaining() {
    if (!startTime) return;

    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, MAX_CAPTURE_TIME - elapsed);

    if (remaining <= 0) {
      stopCapture();
      return;
    }

    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);

    timeRemEl.textContent = `Time remaining: ${min}:${sec
      .toString()
      .padStart(2, "0")}`;
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimeRemaining, 1000);
    updateTimeRemaining(); // Update immediately
  }

  async function startCapture() {
    if (!currentTabId) {
      currentTabId = await getCurrentTabId();
      if (!currentTabId) {
        statusEl.textContent = "Error: Could not get current tab";
        return;
      }
    }

    // Clear previous transcription result
    transcriptionResult = null;
    if (downloadBtn) {
      downloadBtn.style.display = "none";
    }

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "startCapture", tabId: currentTabId },
          resolve
        );
      });

      if (response && response.success) {
        // Reload state from background to get actual startTime stored there
        await loadTabRecordingState();
        // State and UI will be updated by loadTabRecordingState
      } else {
        isCapturing = false;
        startTime = null;
        statusEl.textContent = response?.error || "Failed to start capture";
        updateUI();
      }
    } catch (err) {
      console.error("Error starting capture:", err);
      isCapturing = false;
      startTime = null;
      statusEl.textContent = "Error starting capture";
      updateUI();
    }
  }

  async function stopCapture() {
    if (!currentTabId) {
      currentTabId = await getCurrentTabId();
      if (!currentTabId) {
        statusEl.textContent = "Error: Could not get current tab";
        return;
      }
    }

    clearInterval(timerInterval);
    isCapturing = false;
    startTime = null;

    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "stopCapture", tabId: currentTabId },
          resolve
        );
      });
    } catch (err) {
      console.error("Error stopping capture:", err);
    }

    updateUI();
  }

  startBtn.addEventListener("click", startCapture);
  finishBtn.addEventListener("click", stopCapture);
  cancelBtn.addEventListener("click", stopCapture);
  if (downloadBtn) {
    downloadBtn.addEventListener("click", downloadTranscription);
  }

  // Initialize: Get current tab ID and load its recording state
  (async () => {
    currentTabId = await getCurrentTabId();
    if (currentTabId) {
      await loadTabRecordingState();
    } else {
      statusEl.textContent = "Error: Could not get current tab";
    }
  })();

  // Download transcription as text file
  async function downloadTranscription() {
    if (!transcriptionResult) {
      statusEl.textContent = "No transcription available to download";
      return;
    }

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "downloadTranscription",
            result: transcriptionResult,
            tabId: currentTabId,
          },
          resolve
        );
      });

      if (response && response.success) {
        statusEl.textContent = "Download started!";
      } else {
        statusEl.textContent = `Download failed: ${
          response?.error || "Unknown error"
        }`;
      }
    } catch (err) {
      console.error("Error downloading transcription:", err);
      statusEl.textContent = "Error downloading transcription";
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    // Only process messages for this tab
    if (msg.tabId && msg.tabId !== currentTabId) {
      return;
    }

    if (msg.action === "updateStatus") {
      statusEl.textContent = msg.text;
    } else if (msg.action === "summaryResult") {
      transcriptionResult = msg.result;
      statusEl.textContent = "Transcription complete!";

      // Show download button
      if (downloadBtn) {
        downloadBtn.style.display = "block";
      }

      // Auto-download the transcription
      downloadTranscription();
    } else if (msg.action === "error") {
      statusEl.textContent = `Error: ${msg.message}`;
      transcriptionResult = null;
    }
  });
})();
