(function () {
    const form = document.getElementById("loginForm");
    const errorEl = document.getElementById("error");

    if (!form) {
        console.error("Login screen not loaded");
        return;
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value.trim();

        if (username === "root" && password === "1234") {
            chrome.storage.local.set({ isLoggedIn: true }, () => {
                window.location.reload(); // popup reload → capture screen
            });
        } else {
            errorEl.textContent = "Invalid username or password";
        }
    });
})();