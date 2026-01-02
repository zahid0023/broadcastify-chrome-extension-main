// Map to store recording contexts per tab: Map<tabId, RecordingContext>
const recordingContexts = new Map();

/**
 * Creates a new recording context object
 * @returns {Object} New recording context
 */
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

/**
 * Cleans up resources for a specific tab
 * @param {number} tabId - The ID of the tab to clean up
 */
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

/**
 * Stops the active recording for a tab
 * @param {number} tabId - The ID of the tab to stop recording
 */
function stopRecording(tabId) {
  const context = recordingContexts.get(tabId);
  if (!context || !context.recorder || context.recorder.state === 'inactive') {
    console.log('No active recording found for tab', tabId);
    return;
  }

  console.log('Stopping recording for tab', tabId);
  context.recorder.stop();
}

// Set up message listener for extension messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'RECORD_AUDIO') {
    const { streamId, tabId } = msg;
    console.log('Offscreen: RECORD_AUDIO received for tab', tabId);

    // Check if tab is already recording
    if (recordingContexts.has(tabId)) {
      console.warn('Tab', tabId, 'is already recording');
      return sendResponse({ 
        success: false, 
        error: 'Tab is already recording' 
      });
    }

    const startRecording = async () => {
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

        // Set up audio playback
        const playback = new Audio();
        playback.srcObject = stream;
        playback.play().catch(console.warn);
        context.playback = playback;

        // Initialize audio context
        context.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Set up media recorder
        const options = { mimeType: 'audio/webm;codecs=opus' };
        try {
          context.recorder = new MediaRecorder(stream, options);
        } catch (e) {
          context.recorder = new MediaRecorder(stream);
        }

        context.chunks = [];

        // Store tabId in closure for onstop handler
        const contextTabId = tabId;

        // Handle data available event
        context.recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            const ctx = recordingContexts.get(contextTabId);
            if (ctx) {
              ctx.chunks.push(e.data);
            }
          }
        };

        // Handle recording stop
        context.recorder.onstop = async () => {
          try {
            const ctx = recordingContexts.get(contextTabId);
            if (!ctx) {
              console.error('No context found for tab', contextTabId);
              return;
            }

            const webmBlob = new Blob(ctx.chunks, { type: 'audio/webm' });

            // Convert to Base64 and send to background
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64Data = reader.result.split(',')[1];

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

        // Store context and start recording
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
        sendResponse({ 
          success: false, 
          error: error.message 
        });
      }
    };

    // Start the recording process
    startRecording();
    return true; // Keep the message channel open for async response
  }

  if (msg.action === 'STOP_RECORDING') {
    const { tabId } = msg;
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
