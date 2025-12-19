console.log("Background loaded");

// --- Configuration ---
const GEMINI_API_KEY = "AIzaSyC9xxQxTD1fRTu_-4XgkxEyImp1kxqaMZU";
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

  sendStatus("Sending audio to Gemini API...", null);

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
  } catch (err) {
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

function normalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== "string") return null;

  // Step 1: Lowercase and trim
  let text = rawPhone.toLowerCase().trim();

  // Step 2: Convert spoken words to digits/symbols
  const replacements = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "plus": "+",
    "double zero": "00"
  };

  for (const [word, digit] of Object.entries(replacements)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }

  // Step 3: Remove everything except digits and +
  text = text.replace(/[^0-9+]/g, "");

  // Step 4: Normalize leading 00 → +
  if (text.startsWith("00")) {
    text = "+" + text.slice(2);
  }

  // Step 5: Ensure E.164 style
  // Default to +1 if no country code (adjust if needed)
  if (!text.startsWith("+")) {
    if (text.length === 10) {
      text = "+1" + text;
    }
  }

  // Step 6: Final validation
  if (!/^\+\d{8,15}$/.test(text)) {
    return null;
  }

  return text;
}

function forceNormalizeUSPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== "string") return null;

  let text = rawPhone.toLowerCase();

  // Convert spoken words to digits
  const replacements = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "plus": "",
    "double zero": "00"
  };

  for (const [word, digit] of Object.entries(replacements)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }

  // Extract digits only
  let digits = text.replace(/\D/g, "");

  // Must have at least 10 digits
  if (digits.length < 10) return null;

  // Take last 10 digits
  digits = digits.slice(-10);

  // Force NANP compliance
  let areaCode = digits.slice(0, 3);
  let exchangeCode = digits.slice(3, 6);
  const subscriber = digits.slice(6);

  // Fix invalid area code
  if (areaCode[0] === "0" || areaCode[0] === "1") {
    areaCode = "213"; // safe default (LA)
  }

  // Fix invalid exchange code
  if (exchangeCode[0] === "0" || exchangeCode[0] === "1") {
    exchangeCode = "555"; // reserved but valid format-wise
  }

  return `+1${areaCode}${exchangeCode}${subscriber}`;
}

function downloadSummary(result) {
  if (!result || typeof result !== "object") {
    console.error("Invalid result passed to downloadSummary:", result);
    return;
  }

  const filename = `summary_${Date.now()}.json`;

  // EXPLICIT serialization (this is the key)
  const json = JSON.stringify(result, null, 2);

  const dataUrl =
    "data:application/json;charset=utf-8," +
    encodeURIComponent(json);

  chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false
  });
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
      console.log("Gemini result:", result);

      if (result.contact?.phone) {
        result.contact.phone = forceNormalizeUSPhone(result.contact.phone);
      }

      const hasValue = v => v !== null && v !== undefined && v !== "";

      if (hasValue(result.contact?.email) || hasValue(result.contact?.phone)) {
        // Create contact via API
        const apiResponse = await createContact(result.contact);
        console.log("Contact created:", apiResponse);
      }

      downloadSummary(result);
      console.log(result)
      chrome.runtime.sendMessage({ action: "summaryResult", result });
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

function buildContactPayload(contact) {
  return {
    first_name: contact.first_name ?? null,
    last_name: contact.last_name ?? null,
    name: contact.name ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    gender: contact.gender ?? null,
    address1: contact.address1 ?? null,
    city: contact.city ?? null,
    state: contact.state ?? null,
    postal_code: contact.postal_code ?? null,
    timezone: contact.timezone ?? null,

    // REQUIRED / COMMON FIELDS (adjust as needed)
    location_id: "S2SwEv6vg4Z8X369xNnM",

    tags: ["gemini", "audio-capture"]
  };
}

async function createContact(contact) {
  const MASSMARKETAI_TOKEN = "yHZ8SO5GZbDQbHwnCedQdd08S4Xaes-2hKaHM4O8QMs";

  const payload = buildContactPayload(contact);

  const response = await fetch(
    "https://api.massmarketai.com/api/v1/contacts/create/contact?version=2021-04-15&request-id=1234",
    {
      method: "POST",
      headers: {
        "Accept": "*/*",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MASSMARKETAI_TOKEN}`
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message || "Failed to create contact"
    );
  }

  return data;
}
