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

  let isCapturing = false;
  let startTime;
  let timerInterval;
  const MAX_CAPTURE_TIME = 30 * 60 * 1000;

  function updateUI() {
    startBtn.style.display = isCapturing ? 'none' : 'block';
    finishBtn.style.display = isCapturing ? 'block' : 'none';
    cancelBtn.style.display = isCapturing ? 'block' : 'none';
    statusEl.textContent = isCapturing ? 'Capture in progress...' : 'Ready to capture';
    if (!isCapturing) timeRemEl.textContent = '';
  }

  function updateTimeRemaining() {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, MAX_CAPTURE_TIME - elapsed);

    if (remaining <= 0) stopCapture();

    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);

    timeRemEl.textContent =
      `Time remaining: ${min}:${sec.toString().padStart(2, '0')}`;
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(updateTimeRemaining, 1000);
  }

  function startCapture() {
    isCapturing = true;
    startTime = Date.now();

    chrome.storage.local.set({ isCapturing, startTime }, () => {
      startTimer();
      updateUI();
      chrome.runtime.sendMessage({ action: "startCapture" });
    });
  }

  function stopCapture() {
    clearInterval(timerInterval);
    isCapturing = false;

    chrome.storage.local.remove(['isCapturing', 'startTime'], () => {
      updateUI();
      chrome.runtime.sendMessage({ action: "stopCapture" });
    });
  }

  startBtn.addEventListener('click', startCapture);
  finishBtn.addEventListener('click', stopCapture);
  cancelBtn.addEventListener('click', stopCapture);

  chrome.storage.local.get(['isCapturing', 'startTime'], res => {
    if (res.isCapturing) {
      isCapturing = true;
      startTime = res.startTime;
      startTimer();
    }
    updateUI();
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.action === "updateStatus") {
      statusEl.textContent = msg.text;
    }
  });
})();