document.addEventListener("DOMContentLoaded", () => {
    chrome.storage.local.get(["isLoggedIn"], (res) => {
        loadScreen(res.isLoggedIn ? "capture" : "login");
    });

    chrome.storage.local.get("captureStatus", (data) => {
        const statusEl = document.getElementById("status");
        if (statusEl && data.captureStatus) {
            statusEl.textContent = data.captureStatus;
        }
    });
});

async function loadScreen(screen) {
    const root = document.getElementById("screen-root");

    // Load CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `screens/${screen}/${screen}.css`;
    document.head.appendChild(link);

    // Load HTML
    const res = await fetch(`screens/${screen}/${screen}.html`);
    root.innerHTML = await res.text();

    // Load JS
    const script = document.createElement("script");
    script.src = `screens/${screen}/${screen}.js`;
    document.body.appendChild(script);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "SHOW_ALERT") {
    alert("Error:\n\n" + msg.message);
  }
});