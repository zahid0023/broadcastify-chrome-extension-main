(function () {
  const startBtn = document.getElementById('start');
  const finishBtn = document.getElementById('finish');
  const cancelBtn = document.getElementById('cancel');
  const statusEl = document.getElementById('status');
  const timeRemEl = document.getElementById('timeRem');

  if (!startBtn) {
    console.error("Capture screen not loaded");
    return;
  }

  let currentTabId = null;
  let isCapturing = false;
  let startTime = null;
  let timerInterval = null;
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
    startBtn.style.display = isCapturing ? 'none' : 'block';
    finishBtn.style.display = isCapturing ? 'block' : 'none';
    cancelBtn.style.display = isCapturing ? 'block' : 'none';
    statusEl.textContent = isCapturing ? 'Capture in progress...' : 'Ready to capture';
    if (!isCapturing) timeRemEl.textContent = '';
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

    timeRemEl.textContent =
      `Time remaining: ${min}:${sec.toString().padStart(2, '0')}`;
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

    isCapturing = true;
    startTime = Date.now();

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "startCapture", tabId: currentTabId },
          resolve
        );
      });

      if (response && response.success) {
        startTimer();
        updateUI();
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

  startBtn.addEventListener('click', startCapture);
  finishBtn.addEventListener('click', stopCapture);
  cancelBtn.addEventListener('click', stopCapture);

  // Initialize: Get current tab ID and load its recording state
  (async () => {
    currentTabId = await getCurrentTabId();
    if (currentTabId) {
      await loadTabRecordingState();
    } else {
      statusEl.textContent = "Error: Could not get current tab";
    }
  })();

  chrome.runtime.onMessage.addListener((msg) => {
    // Only process messages for this tab
    if (msg.tabId && msg.tabId !== currentTabId) {
      return;
    }

    if (msg.action === "updateStatus") {
      statusEl.textContent = msg.text;
    } else if (msg.action === "summaryResult") {
      statusEl.textContent = "Transcription complete!";
      // You could display the result here if needed
      console.log("Summary result:", msg.result);
    } else if (msg.action === "error") {
      statusEl.textContent = `Error: ${msg.message}`;
    }
  });
})();