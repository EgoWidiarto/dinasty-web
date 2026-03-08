// Chatbot Script
let conversationHistory = [];

async function sendMessage() {
  const messageInput = document.getElementById("messageInput");
  const chatContainer = document.getElementById("chatContainer");
  const message = messageInput.value.trim();
  const historyOnlyToggle = document.getElementById("historysOnly");

  if (!message) return;

  // Add user message to chat
  const userMessageDiv = document.createElement("div");
  userMessageDiv.className = "message user ms-auto";
  userMessageDiv.textContent = message;
  chatContainer.appendChild(userMessageDiv);

  // Clear input
  messageInput.value = "";
  messageInput.focus();

  // Scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // Show loading indicator
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "message bot";
  loadingDiv.innerHTML = '<span class="loading"></span><span class="loading"></span><span class="loading"></span>';
  chatContainer.appendChild(loadingDiv);

  try {
    // Send to backend API
    const response = await fetch("/api/chatbot/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: message,
        onlyHistory: historyOnlyToggle ? historyOnlyToggle.checked : true,
      }),
    });

    const data = await response.json();

    // Remove loading indicator
    loadingDiv.remove();

    if (data.success) {
      // Add bot response to chat
      const botMessageDiv = document.createElement("div");
      botMessageDiv.className = "message bot";
      botMessageDiv.textContent = data.response;
      chatContainer.appendChild(botMessageDiv);

      // Add to conversation history
      conversationHistory.push({
        user: message,
        bot: data.response,
      });
    } else {
      // Error message
      const errorDiv = document.createElement("div");
      errorDiv.className = "message bot";
      errorDiv.textContent = data.error || "Maaf, terjadi kesalahan. Silakan coba lagi.";
      chatContainer.appendChild(errorDiv);
    }
  } catch (error) {
    console.error("Error:", error);
    loadingDiv.remove();

    const errorDiv = document.createElement("div");
    errorDiv.className = "message bot";
    errorDiv.textContent = "Koneksi error. Pastikan server berjalan dan Gemini API key sudah diatur.";
    chatContainer.appendChild(errorDiv);
  }

  // Scroll to bottom
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function handleKeyPress(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

// Initial greeting and UI bindings
window.addEventListener("load", () => {
  const backBtn = document.getElementById("backBtn");
  const sendBtn = document.getElementById("sendBtn");
  const messageInput = document.getElementById("messageInput");

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.history.back();
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", sendMessage);
  }

  if (messageInput) {
    messageInput.addEventListener("keypress", handleKeyPress);
  }

  const chatContainer = document.getElementById("chatContainer");
  const welcomeDiv = document.createElement("div");
  welcomeDiv.className = "message bot chatbot-greeting-message";
  welcomeDiv.textContent = "Halo! AKU DINASTY-AI. Tanyakan tentang sejarah Indonesia!";
  chatContainer.appendChild(welcomeDiv);
});
