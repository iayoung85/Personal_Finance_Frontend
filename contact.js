let turnstileWidgetId = null;
let backendUrl = null;

async function ensureBackendUrl() {
  if (backendUrl) {
    return backendUrl;
  }
  if (window.BACKEND_URL_PROMISE) {
    await window.BACKEND_URL_PROMISE;
  }
  backendUrl = window.BACKEND_URL;
  return backendUrl;
}

function setStatus(message, isError = false) {
  const status = document.getElementById("contact-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function submitContactForm(token) {
  const name = document.getElementById("contact-name").value.trim();
  const email = document.getElementById("contact-email").value.trim();
  const requestType = document.getElementById("contact-type").value;
  const message = document.getElementById("contact-message").value.trim();

  if (!email || !message) {
    setStatus("Email and message are required.", true);
    return;
  }

  const apiBase = await ensureBackendUrl();
  if (!apiBase) {
    setStatus("Backend server not available.", true);
    return;
  }

  setStatus("Sending...");

  try {
    const response = await fetch(`${apiBase}/api/support/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        requestType,
        message,
        turnstileToken: token,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Request failed");
    }

    document.getElementById("contact-form").reset();
    setStatus("Thanks — we’ll get back to you soon.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  } finally {
    if (turnstileWidgetId !== null && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId);
    }
  }
}

window.turnstileReady = async function () {
  if (!window.turnstile) {
    return;
  }

  await ensureBackendUrl();
  const resolvedBackend = backendUrl || "";
  let siteKey = "0x4AAAAAACNX3qSz6p5n1wCN";

  if (resolvedBackend.includes("127.0.0.1")) {
    siteKey = "1x00000000000000000000AA";
  } else if (resolvedBackend.includes("railway.app")) {
    siteKey = "0x4AAAAAACNX3qSz6p5n1wCN";
  }

  turnstileWidgetId = window.turnstile.render("#turnstile-container", {
    sitekey: siteKey,
    size: "normal",
    execution: "execute",
    appearance: "execute",
    callback: submitContactForm,
    "error-callback": () => setStatus("Captcha error. Please try again.", true),
    "expired-callback": () => setStatus("Captcha expired. Please try again.", true),
  });
};

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contact-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");
    await ensureBackendUrl();
    if (turnstileWidgetId !== null && window.turnstile) {
      window.turnstile.execute(turnstileWidgetId);
    }
  });
});
