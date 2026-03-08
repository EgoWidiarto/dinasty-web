// Chatbot Script
let conversationHistory = [];

const synth = window.speechSynthesis;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let currentSpeakButton = null;
let recognition = null;
let isListening = false;

function setVoiceStatus(text) {
  const voiceStatus = document.getElementById("voiceStatus");
  if (voiceStatus) {
    voiceStatus.textContent = text || "";
  }
}

function scrollChatToBottom() {
  const chatContainer = document.getElementById("chatContainer");
  if (chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function stopSpeaking() {
  if (synth && synth.speaking) {
    synth.cancel();
  }
  if (currentSpeakButton) {
    currentSpeakButton.textContent = "🔊 Dengarkan";
    currentSpeakButton.classList.remove("is-speaking");
    currentSpeakButton = null;
  }
}

function speakText(text, buttonEl) {
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    setVoiceStatus("Browser ini belum mendukung text-to-speech.");
    return;
  }

  if (!text || !text.trim()) return;

  if (currentSpeakButton === buttonEl && synth.speaking) {
    stopSpeaking();
    return;
  }

  stopSpeaking();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "id-ID";
  utterance.rate = 1;
  utterance.pitch = 1;

  utterance.onend = () => {
    if (buttonEl) {
      buttonEl.textContent = "🔊 Dengarkan";
      buttonEl.classList.remove("is-speaking");
    }
    if (currentSpeakButton === buttonEl) {
      currentSpeakButton = null;
    }
  };

  utterance.onerror = () => {
    if (buttonEl) {
      buttonEl.textContent = "🔊 Dengarkan";
      buttonEl.classList.remove("is-speaking");
    }
    if (currentSpeakButton === buttonEl) {
      currentSpeakButton = null;
    }
  };

  if (buttonEl) {
    buttonEl.textContent = "⏹ Hentikan";
    buttonEl.classList.add("is-speaking");
    currentSpeakButton = buttonEl;
  }

  synth.speak(utterance);
}

function createBotMessage(text, withTTS = true) {
  const chatContainer = document.getElementById("chatContainer");
  if (!chatContainer) return;

  const botMessageDiv = document.createElement("div");
  botMessageDiv.className = "message bot";

  const messageText = document.createElement("div");
  messageText.className = "bot-message-text";
  messageText.textContent = text;
  botMessageDiv.appendChild(messageText);

  if (withTTS) {
    const ttsButton = document.createElement("button");
    ttsButton.type = "button";
    ttsButton.className = "chatbot-tts-btn";
    ttsButton.textContent = "🔊 Dengarkan";
    ttsButton.setAttribute("aria-label", "Dengarkan jawaban");
    ttsButton.addEventListener("click", () => speakText(text, ttsButton));
    botMessageDiv.appendChild(ttsButton);
  }

  chatContainer.appendChild(botMessageDiv);
}

function setupVoiceRecognition() {
  const voiceBtn = document.getElementById("voiceBtn");
  const messageInput = document.getElementById("messageInput");

  if (!voiceBtn) return;

  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceBtn.title = "Browser tidak mendukung input suara";
    setVoiceStatus("Input suara tidak didukung di browser ini.");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "id-ID";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isListening = true;
    voiceBtn.classList.add("is-listening");
    voiceBtn.textContent = "🔴";
    setVoiceStatus("Sedang mendengarkan... Silakan bicara.");
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      transcript += event.results[i][0].transcript;
    }

    if (messageInput) {
      messageInput.value = transcript.trim();
    }
  };

  recognition.onend = () => {
    isListening = false;
    voiceBtn.classList.remove("is-listening");
    voiceBtn.textContent = "🎤";
    setVoiceStatus("Input suara selesai. Kamu bisa kirim atau edit dulu teksnya.");
    if (messageInput) {
      messageInput.focus();
    }
  };

  recognition.onerror = (event) => {
    isListening = false;
    voiceBtn.classList.remove("is-listening");
    voiceBtn.textContent = "🎤";
    if (event.error === "not-allowed") {
      setVoiceStatus("Izin mikrofon ditolak. Mohon izinkan akses mikrofon.");
    } else {
      setVoiceStatus("Input suara gagal. Coba lagi.");
    }
  };

  voiceBtn.addEventListener("click", () => {
    if (!recognition) return;
    if (isListening) {
      recognition.stop();
      return;
    }
    setVoiceStatus("");
    recognition.start();
  });
}

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
  scrollChatToBottom();

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
      // Add bot response to chat with TTS
      createBotMessage(data.response, true);

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
  scrollChatToBottom();
}

function handleKeyPress(event) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendMessage();
  }
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, 180);
  textarea.style.height = `${nextHeight}px`;
}

// Initial greeting and UI bindings
window.addEventListener("load", () => {
  const backBtn = document.getElementById("backBtn");
  const sendBtn = document.getElementById("sendBtn");
  const messageInput = document.getElementById("messageInput");

  setupVoiceRecognition();

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.history.back();
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", sendMessage);
  }

  if (messageInput) {
    messageInput.addEventListener("keydown", handleKeyPress);
    messageInput.addEventListener("input", () => autoResizeTextarea(messageInput));
    autoResizeTextarea(messageInput);
  }

  const chatContainer = document.getElementById("chatContainer");
  if (chatContainer) {
    const welcomeDiv = document.createElement("div");
    welcomeDiv.className = "message bot chatbot-greeting-message";
    welcomeDiv.textContent = "Halo! AKU DINASTI-AI. Tanyakan tentang sejarah Indonesia!";
    chatContainer.appendChild(welcomeDiv);
  }

  window.addEventListener("beforeunload", () => {
    stopSpeaking();
    if (recognition && isListening) {
      recognition.stop();
    }
  });
});
