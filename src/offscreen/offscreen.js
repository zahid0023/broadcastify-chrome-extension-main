// Map to store recording contexts per tab: Map<tabId, RecordingContext>
const recordingContexts = new Map();

// RecordingContext structure: { recorder, stream, chunks, audioContext, startTime, playback }
function createRecordingContext() {
  return {
    recorder: null,
    stream: null,
    chunks: [],
    audioContext: null,
    startTime: null,
    playback: null,
  };
}

// Clean up resources for a specific tab
function cleanupTab(tabId) {
  const context = recordingContexts.get(tabId);
  if (!context) return;

  if (context.recorder && context.recorder.state !== 'inactive') {
    try { 
      context.recorder.stop(); 
    } catch (e) { 
      console.warn('Error stopping recorder:', e);
    }
  }

  if (context.stream) {
    context.stream.getTracks().forEach(track => track.stop());
    context.stream = null;
  }

  if (context.audioContext && context.audioContext.state !== 'closed') {
    try {
      context.audioContext.close();
    } catch (e) { 
      console.warn('Error closing audio context:', e);
    }
  }

  if (context.playback) {
    try {
      context.playback.pause();
      context.playback.srcObject = null;
    } catch (e) {
      console.warn('Error cleaning up playback:', e);
    }
  }

  context.chunks = [];
  recordingContexts.delete(tabId);
  console.log('Cleaned up recording context for tab', tabId);
}

// Convert WebM to MP3 (placeholder)
async function convertToMp3(webmBlob) {
  return new Blob([webmBlob], { type: 'audio/mp3' });
}

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.action === 'RECORD_AUDIO') {
    const { streamId, tabId } = msg;
    console.log('Offscreen: RECORD_AUDIO received for tab', tabId);

    // Check if tab is already recording
    if (recordingContexts.has(tabId)) {
      console.warn('Tab', tabId, 'is already recording');
      return sendResponse({ success: false, error: 'Tab is already recording' });
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        }
      });

      // Create recording context for this tab
      const context = createRecordingContext();
      context.stream = stream;
      context.startTime = Date.now();

      const playback = new Audio();
      playback.srcObject = stream;
      playback.play().catch(console.warn);
      context.playback = playback;

      context.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      const options = { mimeType: 'audio/webm;codecs=opus' };
      try {
        context.recorder = new MediaRecorder(stream, options);
      } catch (e) {
        context.recorder = new MediaRecorder(stream);
      }

      context.chunks = [];

      // Store tabId in closure for onstop handler
      const contextTabId = tabId;

      context.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          const ctx = recordingContexts.get(contextTabId);
          if (ctx) {
            ctx.chunks.push(e.data);
          }
        }
      };

      context.recorder.onstop = async () => {
        try {
          const ctx = recordingContexts.get(contextTabId);
          if (!ctx) {
            console.error('No context found for tab', contextTabId);
            return;
          }

          const webmBlob = new Blob(ctx.chunks, { type: 'audio/webm' });

          // Convert to Base64 immediately
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Data = reader.result.split(',')[1]; // only Base64 part

            // Send Base64 and mime type to background with tabId
            chrome.runtime.sendMessage({
              action: 'AUDIO_READY',
              base64Data,
              mimeType: webmBlob.type,
              tabId: contextTabId
            });
          };

          reader.readAsDataURL(webmBlob);

        } catch (err) {
          console.error('Error in recorder.onstop:', err);
          chrome.runtime.sendMessage({ 
            action: 'RECORDING_ERROR', 
            error: err.message,
            tabId: contextTabId
          });
        } finally {
          cleanupTab(contextTabId);
        }
      };

      // Store context in Map
      recordingContexts.set(tabId, context);

      context.recorder.start(500); // Collect data every 500ms
      console.log('Recording started for tab', tabId);
      sendResponse({ success: true });

    } catch (error) {
      console.error('Error starting recording for tab', tabId, ':', error);
      cleanupTab(tabId);

      chrome.runtime.sendMessage({
        action: 'RECORDING_ERROR',
        error: error.message,
        tabId: tabId
      });
      sendResponse({ success: false, error: error.message });
    }
  }

  if (msg.action === 'STOP_RECORDING') {
    const tabId = msg.tabId;
    console.log('Offscreen: STOP_RECORDING for tab', tabId);
    
    if (!tabId) {
      console.warn('No tabId provided for STOP_RECORDING');
      return sendResponse({ success: false });
    }

    stopRecording(tabId);
    sendResponse({ success: true });
  }

  return true; // Keep the message channel open for async response
});

function stopRecording(tabId) {
  const context = recordingContexts.get(tabId);
  if (!context || !context.recorder || context.recorder.state === 'inactive') {
    console.log('No active recording found for tab', tabId);
    return;
  }

  console.log('Stopping recording for tab', tabId);
  context.recorder.stop();
}
