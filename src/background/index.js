console.log("Background loaded");

// --- Configuration ---
const GEMINI_API_KEY = "AIzaSyArMjOWMTmOBMnvY4zzY2vvmTa8hAA7SnQ";
const GENERATE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// --- Helper to send status updates to popup ---
function sendStatus(text) {
  // 1) Persist status
  chrome.storage.local.set({ captureStatus: text });

  // 2) Try live update (works only if popup is open)
  chrome.runtime.sendMessage({
    action: "updateStatus",
    text
  });
}

function downloadSummary(data) {
  const filename = `gemini-summary-${Date.now()}.json`;

  const jsonText = JSON.stringify(data, null, 2);

  const dataUrl =
    "data:application/json;charset=utf-8," + encodeURIComponent(jsonText);

  chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true
  });
}

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
            text: `
                  You are an information extraction system.

                  TASKS:
                  1. Transcribe the full audio content accurately.
                  2. Generate a concise 3-point executive summary.
                  3. Extract ALL contact-related information mentioned in the speech.

                  OUTPUT FORMAT (STRICT JSON ONLY — no markdown, no commentary):

                  {
                    "transcription": "full transcription text",
                    "summary": [
                      "point 1",
                      "point 2",
                      "point 3"
                    ],
                    "contact": {
                      "first_name": null,
                      "last_name": null,
                      "name": null,
                      "email": null,
                      "phone": null,
                      "gender": null,
                      "website": null,
                      "address1": null,
                      "city": null,
                      "state": null,
                      "postal_code": null,
                      "timezone": null,
                    }
                  }

                  RULES:
                  - Use null if a value is not explicitly mentioned.
                  - Do NOT guess or infer values.
                  - Extract phone numbers and emails exactly as spoken.
                  - If a full name is mentioned, also populate first_name and last_name.
                  - Return valid JSON only.
                  `
          }
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
  };

  sendStatus("Sending audio to Gemini API...");

  const response = await fetch(GENERATE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();
  console.log("Gemini API response:", data);

  if (data.error) throw new Error(data.error.message || "Gemini API error");

  const rawText = data.candidates[0].content.parts[0].text;

  let parsed;
  try {
    parsed = extractJson(rawText);
  } catch (e) {
    console.error("Invalid JSON from Gemini:", rawText);
    throw new Error("Gemini returned invalid JSON");
  }

  return parsed;
}

function extractJson(text) {
  // Remove ```json and ``` wrappers if present
  const cleaned = text
    .replace(/```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  return JSON.parse(cleaned);
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
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab) return sendResponse({ success: false });

      console.log("Starting capture for tab", tab.id);
      await ensureOffscreen();

      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id,
      });

      chrome.runtime.sendMessage({
        action: "RECORD_AUDIO",
        streamId,
        tabId: tab.id,
      });
      sendResponse({ success: true });
    } catch (err) {
      console.error("StartCapture error:", err);
      sendResponse({ success: false });
    }

    return true;
  }

  // 2) Stop capture
  if (msg.action === "stopCapture") {
    console.log("Stopping capture");
    chrome.runtime.sendMessage({
      action: "STOP_RECORDING"
    });
    sendResponse({ success: true });
    return true;
  }

  // 3) Audio is ready → send to Gemini for transcription & summary
  if (msg.action === "AUDIO_READY") {
    console.log("Background: Audio ready, sending to Gemini...");

    const { base64Data, mimeType } = msg;

    if (!base64Data) {
      console.error("No audio data received!");
      return;
    }

    chrome.runtime.sendMessage({ action: "updateStatus", text: "Sending to Gemini..." });

    try {
      const result = await generateSummaryInline(base64Data, mimeType);
      downloadSummary(result);
      console.log(result)
      chrome.runtime.sendMessage({ action: "summaryResult", result });
    } catch (err) {
      const message = err.message || "Unknown Gemini error";

      console.error("Gemini error:", message);

      // Send error to popup for alert
      chrome.runtime.sendMessage({
        action: "SHOW_ALERT",
        message
      });
    }
  }
  return false;
});