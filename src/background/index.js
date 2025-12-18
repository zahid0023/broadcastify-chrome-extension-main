console.log("Background loaded");

// --- Configuration ---
const GEMINI_API_KEY = "AIzaSyCuxwOg9dvDELmcAYeXb1776SGG_kNAFW4";
const GENERATE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// --- Per-tab recording state tracking ---
const activeRecordings = new Map(); // Map<tabId, { startTime, isRecording, streamId }>

// --- Helper to send status updates to popup ---
function sendStatus(text, tabId = null) {
  chrome.runtime.sendMessage({ action: "updateStatus", text, tabId });
}

// --- Load persisted recording states on startup ---
async function loadPersistedStates() {
  try {
    const data = await chrome.storage.local.get(["activeRecordings"]);
    if (data.activeRecordings) {
      Object.entries(data.activeRecordings).forEach(([tabId, state]) => {
        activeRecordings.set(Number(tabId), state);
      });
    }
  } catch (err) {
    console.error("Error loading persisted states:", err);
  }
}

// --- Persist recording states to storage ---
async function persistStates() {
  const states = {};
  activeRecordings.forEach((state, tabId) => {
    states[tabId] = state;
  });
  await chrome.storage.local.set({ activeRecordings: states });
}

// --- Cleanup recording state for a tab ---
function cleanupTabState(tabId) {
  activeRecordings.delete(tabId);
  persistStates();
}

// --- Get recording state for a tab ---
function getTabRecordingState(tabId) {
  return activeRecordings.get(tabId) || null;
}

// Initialize on startup
loadPersistedStates();

// --- Generate transcription + summary using Gemini ---
async function generateSummaryInline(base64Data, mimeType) {
  const requestBody = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: "Transcribe the full audio content. After the transcription, write a concise, three-point executive summary. Format the output with the transcription first, followed by a '---' separator, and then the summary.",
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  sendStatus("Sending audio to Gemini API...", null);

  const response = await fetch(GENERATE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();
  console.log("Gemini API response:", data);

  if (data.error) throw new Error(data.error.message || "Gemini API error");

  return data.candidates[0].content.parts[0].text;
}

// --- Ensure Offscreen document exists for audio capture ---
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("src/offscreen/offscreen.html")],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "src/offscreen/offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record audio from tab",
  });
}

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  // 1) Start capture
  if (msg.action === "startCapture") {
    try {
      let tabId = msg.tabId;

      // If no tabId provided, get active tab
      if (!tabId) {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab) return sendResponse({ success: false });
        tabId = tab.id;
      }

      // Check if tab is already recording
      if (activeRecordings.has(tabId)) {
        console.log("Tab", tabId, "is already recording");
        return sendResponse({
          success: false,
          error: "Tab is already recording",
        });
      }

      console.log("Starting capture for tab", tabId);
      await ensureOffscreen();

      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId,
      });

      // Store recording state
      const recordingState = {
        tabId,
        startTime: Date.now(),
        isRecording: true,
        streamId,
      };
      activeRecordings.set(tabId, recordingState);
      await persistStates();

      chrome.runtime.sendMessage({
        action: "RECORD_AUDIO",
        streamId,
        tabId: tabId,
      });
      sendResponse({ success: true, tabId });
    } catch (err) {
      console.error("StartCapture error:", err);
      sendResponse({ success: false, error: err.message });
    }

    return true;
  }

  // 2) Stop capture
  if (msg.action === "stopCapture") {
    try {
      let tabId = msg.tabId;

      if (!tabId) {
        // Fallback to active tab if no tabId provided
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab) return sendResponse({ success: false });
        tabId = tab.id;
      }

      console.log("Stopping capture for tab", tabId);

      // Cleanup state
      cleanupTabState(tabId);

      chrome.runtime.sendMessage({
        action: "STOP_RECORDING",
        tabId: tabId,
      });
      sendResponse({ success: true, tabId });
    } catch (err) {
      console.error("StopCapture error:", err);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  // 3) Get recording state for a tab
  if (msg.action === "getRecordingState") {
    const tabId = msg.tabId;
    const state = getTabRecordingState(tabId);
    sendResponse({ success: true, state });
    return true;
  }

  // 4) Audio is ready → send to Gemini for transcription & summary
  if (msg.action === "AUDIO_READY") {
    console.log("Background: Audio ready, sending to Gemini...");

    const { base64Data, mimeType, tabId } = msg;

    if (!base64Data) {
      console.error("No audio data received!");
      return;
    }

    // Cleanup recording state
    if (tabId) {
      cleanupTabState(tabId);
    }

    sendStatus("Sending to Gemini...", tabId);

    try {
      const result = await generateSummaryInline(base64Data, mimeType);
      console.log(result);
      chrome.runtime.sendMessage({ action: "summaryResult", result, tabId });
    } catch (err) {
      chrome.runtime.sendMessage({
        action: "error",
        message: err.message,
        tabId,
      });
    }
  }
  return false;
});

// --- Cleanup recording state when tabs are closed ---
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeRecordings.has(tabId)) {
    console.log("Tab", tabId, "closed, cleaning up recording state");
    cleanupTabState(tabId);

    // Notify offscreen to stop recording for this tab
    chrome.runtime.sendMessage({
      action: "STOP_RECORDING",
      tabId: tabId,
    });
  }
});
