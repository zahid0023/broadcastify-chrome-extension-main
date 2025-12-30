(function init() {
  // DOM Elements
  const startBtn = document.getElementById('start');
  const finishBtn = document.getElementById('finish');
  const cancelBtn = document.getElementById('cancel');
  const statusEl = document.getElementById('status');
  const timeRemEl = document.getElementById('timeRem');

  // State
  let currentTabId = null;
  let isCapturing = false;
  let startTime = null;
  let timerInterval = null;
  
  // Constants
  const MAX_CAPTURE_TIME = 30 * 60 * 1000; // 30 minutes in milliseconds

  // ====================================
  //  DOM Initialization
  // ====================================
  if (!startBtn) {
    console.error('Capture screen DOM not ready');
    return;
  }

  // ====================================
  //  Tab Management
  // ====================================
  async function getCurrentTabId() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab ? tab.id : null;
    } catch (err) {
      console.error('Error getting current tab:', err);
      return null;
    }
  }

  // ====================================
  //  State Management
  // ====================================
  async function loadTabRecordingState() {
    if (!currentTabId) return;

    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'getRecordingState', tabId: currentTabId },
        (res) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res);
        }
      );
    });

    if (response?.success && response.state) {
      isCapturing = response.state.isRecording;
      startTime = response.state.startTime;

      if (isCapturing && startTime) {
        startTimer();
      }
    } else {
      isCapturing = false;
      startTime = null;
    }

    updateUI();
  }

  // ====================================
  //  UI Updates
  // ====================================
  function updateUI() {
    // Toggle button visibility
    startBtn.style.display = isCapturing ? 'none' : 'block';
    finishBtn.style.display = isCapturing ? 'block' : 'none';
    cancelBtn.style.display = isCapturing ? 'block' : 'none';

    // Update status text
    statusEl.textContent = isCapturing 
      ? 'Capture in progress...' 
      : 'Ready to capture';

    // Clear timer if not capturing
    if (!isCapturing) {
      timeRemEl.textContent = '';
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

    // Format time as MM:SS
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    timeRemEl.textContent = `Time remaining: ${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimeRemaining, 1000);
    updateTimeRemaining();
  }

  // ====================================
  //  Capture Control
  // ====================================
  async function startCapture() {
    if (!currentTabId) {
      currentTabId = await getCurrentTabId();
      if (!currentTabId) {
        statusEl.textContent = 'Error: Could not get current tab';
        return;
      }
    }

    // Update UI state
    isCapturing = true;
    startTime = Date.now();
    startTimer();
    updateUI();

    // Notify background script (fire and forget)
    chrome.runtime.sendMessage(
      { action: 'startCapture', tabId: currentTabId },
      () => {
        if (chrome.runtime.lastError) return; // Ignore if popup closed
      }
    );

    // Re-sync state after a short delay
    setTimeout(() => loadTabRecordingState().catch(console.error), 300);
  }

  async function stopCapture() {
    if (!currentTabId) {
      currentTabId = await getCurrentTabId();
      if (!currentTabId) {
        statusEl.textContent = 'Error: Could not get current tab';
        return;
      }
    }

    // Update UI state
    clearInterval(timerInterval);
    isCapturing = false;
    startTime = null;
    updateUI();

    // Notify background script (fire and forget)
    chrome.runtime.sendMessage(
      { action: 'stopCapture', tabId: currentTabId },
      () => {
        if (chrome.runtime.lastError) return; // Ignore if popup closed
      }
    );
  }

  // ====================================
  //  Event Listeners
  // ====================================
  startBtn.addEventListener('click', startCapture);
  finishBtn.addEventListener('click', stopCapture);
  cancelBtn.addEventListener('click', stopCapture);

  // Message handler for background script communication
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.tabId && msg.tabId !== currentTabId) return;

    switch (msg.action) {
      case 'updateStatus':
        statusEl.textContent = msg.text;
        break;
      case 'summaryResult':
        statusEl.textContent = 'Transcription complete!';
        break;
      case 'error':
        statusEl.textContent = `Error: ${msg.message}`;
        break;
      default:
        break;
    }
  });

  // Initialize
  (async () => {
    currentTabId = await getCurrentTabId();
    if (currentTabId) {
      await loadTabRecordingState();
    } else {
      statusEl.textContent = 'Error: Could not get current tab';
    }
  })();
})();
