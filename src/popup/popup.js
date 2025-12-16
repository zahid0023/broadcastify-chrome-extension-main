document.addEventListener("DOMContentLoaded", () => {
    chrome.storage.local.get(["isLoggedIn"], (res) => {
        loadScreen(res.isLoggedIn ? "capture" : "login");
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