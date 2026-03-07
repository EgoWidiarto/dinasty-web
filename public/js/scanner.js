// QR Scanner Script
let html5QrcodeScanner;
let scannedResult = null;

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function classifyPayload(payload) {
  if (!payload || typeof payload !== "string") {
    return {
      type: "Data tidak dikenal",
      hint: "QR terbaca, tapi format data tidak standar.",
      isUrl: false,
    };
  }

  if (isValidHttpUrl(payload)) {
    return {
      type: "URL Web",
      hint: "Link akan otomatis dibuka dalam tab baru...",
      isUrl: true,
    };
  }

  const normalized = payload.trim();
  const arKeywordRegex = /(ar|marker|target|card|unity|vuforia|model|anchor|scene)/i;
  const looksLikeToken = /^[A-Za-z0-9_\-:.|]{8,}$/;

  if (arKeywordRegex.test(normalized) || looksLikeToken.test(normalized)) {
    return {
      type: "ID/Token Aplikasi (kemungkinan AR)",
      hint: "QR ini kemungkinan dipakai internal oleh aplikasi AR, bukan link web langsung.",
      isUrl: false,
    };
  }

  return {
    type: "Teks/Data Biasa",
    hint: "QR berisi teks/data. Bisa jadi metadata kartu AR.",
    isUrl: false,
  };
}

function renderPayloadInfo(payload) {
  const payloadTypeEl = document.getElementById("payloadType");
  const payloadHintEl = document.getElementById("payloadHint");
  const openLinkBtn = document.getElementById("openLinkBtn");

  const info = classifyPayload(payload);

  if (payloadTypeEl) {
    payloadTypeEl.textContent = `Tipe: ${info.type}`;
  }

  if (payloadHintEl) {
    payloadHintEl.textContent = info.hint;
  }

  if (openLinkBtn) {
    openLinkBtn.disabled = !info.isUrl;
    openLinkBtn.classList.toggle("d-none", info.isUrl);
  }
}

// Initialize QR Code Scanner
function initializeScanner() {
  html5QrcodeScanner = new Html5QrcodeScanner(
    "reader",
    {
      fps: 10,
      qrbox: { width: 300, height: 300 },
      rememberLastUsedCamera: true,
      showTorchButtonIfSupported: true,
    },
    false,
  );

  html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function onScanSuccess(decodedText, decodedResult) {
  console.log("✅ QR Code terdeteksi:", decodedText);

  // Stop scanning only if scanner is running
  if (html5QrcodeScanner) {
    try {
      const state = html5QrcodeScanner.getState();
      if (state === Html5QrcodeScannerState.SCANNING) {
        html5QrcodeScanner.pause(true);
      }
    } catch (e) {
      // Silently ignore pause errors from file upload
    }
  }

  // Store result
  scannedResult = decodedText;

  // Show result
  document.getElementById("resultContainer").classList.remove("d-none");
  document.getElementById("resultText").textContent = decodedText;
  renderPayloadInfo(decodedText);
  document.getElementById("statusMessage").innerHTML = '<div class="alert alert-success">✅ QR Code berhasil dibaca!</div>';

  // Auto-redirect if URL from camera scan
  if (isValidHttpUrl(decodedText) && decodedResult) {
    setTimeout(() => {
      window.open(decodedText, "_blank");
    }, 800);
  }
}

function onScanFailure(error) {
  // Scan failure is expected, ignore
  // console.log('QR Code tidak terdeteksi:', error);
}

function openLink() {
  if (scannedResult) {
    // Validate if it's a URL
    if (isValidHttpUrl(scannedResult)) {
      window.open(scannedResult, "_blank");
    } else {
      alert("QR ini bukan link web. Kemungkinan ini ID/token untuk aplikasi AR.");
    }
  }
}

async function copyPayload() {
  if (!scannedResult) return;

  try {
    await navigator.clipboard.writeText(scannedResult);
    document.getElementById("statusMessage").innerHTML = '<div class="alert alert-info">📋 Isi QR berhasil disalin.</div>';
  } catch (error) {
    console.error("Gagal menyalin payload:", error);
    document.getElementById("statusMessage").innerHTML = '<div class="alert alert-warning">⚠️ Tidak bisa menyalin otomatis. Salin manual dari hasil scan.</div>';
  }
}

function resetScanner() {
  document.getElementById("resultContainer").classList.add("d-none");
  document.getElementById("statusMessage").innerHTML = "";
  const payloadTypeEl = document.getElementById("payloadType");
  const payloadHintEl = document.getElementById("payloadHint");
  if (payloadTypeEl) payloadTypeEl.textContent = "";
  if (payloadHintEl) payloadHintEl.textContent = "";
  scannedResult = null;

  // Resume scanning
  if (html5QrcodeScanner) {
    html5QrcodeScanner.resume();
  }
}

// Initialize on load
window.addEventListener("load", () => {
  const backBtn = document.getElementById("backBtn");
  const openLinkBtn = document.getElementById("openLinkBtn");
  const copyPayloadBtn = document.getElementById("copyPayloadBtn");
  const resetScannerBtn = document.getElementById("resetScannerBtn");
  const qrFileInput = document.getElementById("qrFileInput");

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.history.back();
    });
  }

  if (openLinkBtn) {
    openLinkBtn.addEventListener("click", openLink);
  }

  if (copyPayloadBtn) {
    copyPayloadBtn.addEventListener("click", copyPayload);
  }

  if (resetScannerBtn) {
    resetScannerBtn.addEventListener("click", resetScanner);
  }

  // Handle file upload for QR code
  if (qrFileInput) {
    qrFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          let wasScannerPaused = false;
          img.onload = () => {
            try {
              // Pause camera scanner only if it's running
              if (html5QrcodeScanner && html5QrcodeScanner.getState) {
                try {
                  const state = html5QrcodeScanner.getState();
                  if (state === Html5QrcodeScannerState.SCANNING) {
                    html5QrcodeScanner.pause(true);
                    wasScannerPaused = true;
                  }
                } catch (stateErr) {
                  console.warn("Could not check scanner state:", stateErr);
                }
              }

              // Create canvas and draw image
              const canvas = document.createElement("canvas");
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(img, 0, 0);

              // Extract image data
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

              // Check if jsQR is available
              if (typeof jsQR !== "undefined") {
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code) {
                  console.log("✅ QR Code decoded:", code.data);
                  onScanSuccess(code.data, null);

                  // Auto-redirect if URL
                  if (isValidHttpUrl(code.data)) {
                    setTimeout(() => {
                      window.open(code.data, "_blank");
                    }, 500);
                  }
                } else {
                  throw new Error("No QR code found in image");
                }
              } else {
                // Fallback: Use html5-qrcode's built-in decoder if available
                console.warn("jsQR library not available, using html5-qrcode fallback");
                // Show user message
                const statusMsg = document.getElementById("statusMessage");
                if (statusMsg) {
                  statusMsg.innerHTML = '<div class="alert alert-warning">⚠️ File upload sedang dikembangkan. Gunakan kamera untuk hasil terbaik.</div>';
                }
                // Resume scanner only if we paused it
                if (wasScannerPaused && html5QrcodeScanner) {
                  try {
                    html5QrcodeScanner.resume();
                  } catch (e) {
                    console.warn("Could not resume scanner:", e);
                  }
                }
                qrFileInput.value = "";
              }
            } catch (err) {
              console.error("❌ Error decoding QR:", err);
              alert(
                "Gagal membaca QR Code dari gambar.\n\n" +
                  "Kemungkinan:\n" +
                  "- Gambar terlalu kecil atau blur\n" +
                  "- QR Code tidak jelas\n" +
                  "- Format gambar tidak cocok\n\n" +
                  "Coba gambar lain dengan QR Code yang lebih jelas.",
              );
              // Resume scanner only if we paused it
              if (wasScannerPaused && html5QrcodeScanner) {
                try {
                  html5QrcodeScanner.resume();
                } catch (e) {
                  console.warn("Could not resume scanner:", e);
                }
              }
              // Reset input
              qrFileInput.value = "";
            }
          };
          img.onerror = () => {
            alert("Gagal membaca file gambar. Cek format file Anda.");
            qrFileInput.value = "";
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  initializeScanner();
});

// Cleanup on unload
window.addEventListener("beforeunload", () => {
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear();
  }
});
