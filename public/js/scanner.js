// QR Scanner Script
let html5QrcodeScanner;
let scannedResult = null;
let autoZoomIntervalId = null;

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function pickOptimalCameraOption(options, isMobile) {
  const scored = options.map((opt) => {
    const label = (opt.textContent || "").toLowerCase();
    let score = 0;

    // Prioritas utama: kamera belakang / environment
    if (/back|rear|environment|belakang|world|main camera/.test(label)) score += 120;
    if (/front|selfie|user|depan/.test(label)) score -= 90;

    // Prioritas kualitas kamera
    if (/4k|2160|uhd/.test(label)) score += 25;
    if (/1080|full hd|fhd/.test(label)) score += 20;
    if (/720|hd/.test(label)) score += 10;
    if (/wide|ultra wide|tele|macro/.test(label)) score += 8;

    // Hindari virtual camera di desktop
    if (/virtual|obs|droidcam|epoccam/.test(label)) score -= 80;

    // Mobile: dorong kamera belakang lebih agresif
    if (isMobile && /back|rear|environment|belakang|world/.test(label)) score += 40;

    return { opt, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.opt || options[0];
}

function getInnerHtml5QrcodeInstance() {
  if (!html5QrcodeScanner) return null;
  return html5QrcodeScanner.html5Qrcode || html5QrcodeScanner.html5Qrcode_ || null;
}

async function applyZoomLevel(level) {
  const inner = getInnerHtml5QrcodeInstance();
  if (!inner || typeof inner.getRunningTrackCapabilities !== "function" || typeof inner.applyVideoConstraints !== "function") {
    return false;
  }

  try {
    const capabilities = inner.getRunningTrackCapabilities();
    if (!capabilities?.zoom) return false;

    const min = Number.isFinite(capabilities.zoom.min) ? capabilities.zoom.min : 1;
    const max = Number.isFinite(capabilities.zoom.max) ? capabilities.zoom.max : min;
    if (max <= min) return false;

    const targetZoom = Math.max(min, Math.min(max, min + (max - min) * level));
    await inner.applyVideoConstraints({ advanced: [{ zoom: targetZoom }] });
    return true;
  } catch (err) {
    console.warn("Zoom constraint tidak didukung kamera/browser:", err);
    return false;
  }
}

function startAdaptiveAutoZoom() {
  stopAdaptiveAutoZoom();

  const zoomLevels = [0.55, 0.7, 0.82, 0.92];
  let idx = 0;

  // Coba sekali cepat saat awal scan
  setTimeout(() => {
    applyZoomLevel(zoomLevels[0]);
  }, 500);

  autoZoomIntervalId = setInterval(async () => {
    if (scannedResult) {
      stopAdaptiveAutoZoom();
      return;
    }

    const applied = await applyZoomLevel(zoomLevels[idx]);
    if (applied) {
      idx = (idx + 1) % zoomLevels.length;
    }
  }, 1800);
}

function stopAdaptiveAutoZoom() {
  if (autoZoomIntervalId) {
    clearInterval(autoZoomIntervalId);
    autoZoomIntervalId = null;
  }
}

function autoSelectBackCameraAndStart(maxRetry = 12) {
  const readerEl = document.getElementById("reader");
  if (!readerEl) return;

  const cameraSelect = readerEl.querySelector("select");
  const startButton = Array.from(readerEl.querySelectorAll("button")).find((btn) => /start|mulai|scan/i.test(btn.textContent || ""));

  if (!cameraSelect || cameraSelect.options.length === 0) {
    if (maxRetry > 0) {
      setTimeout(() => autoSelectBackCameraAndStart(maxRetry - 1), 250);
    }
    return;
  }

  const options = Array.from(cameraSelect.options);
  const targetOption = pickOptimalCameraOption(options, isMobileDevice());

  if (targetOption && cameraSelect.value !== targetOption.value) {
    cameraSelect.value = targetOption.value;
    cameraSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (startButton && !startButton.disabled) {
    startButton.click();
    setTimeout(() => {
      startAdaptiveAutoZoom();
    }, 1200);
  }
}

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
  try {
    if (typeof Html5QrcodeScanner === "undefined" || typeof Html5QrcodeSupportedFormats === "undefined") {
      showError("Library scanner gagal dimuat. Tutup tab lalu buka lagi.");
      return;
    }

    const isMobile = isMobileDevice();

    html5QrcodeScanner = new Html5QrcodeScanner(
      "reader",
      {
        fps: isMobile ? 10 : 15,
        qrbox: isMobile ? { width: 250, height: 250 } : { width: 300, height: 300 },
        rememberLastUsedCamera: false,
        showTorchButtonIfSupported: true,
        aspectRatio: 1.0,
        videoConstraints: {
          facingMode: { ideal: "environment" },
        },
        // Force camera untuk mobile
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      },
      false,
    );

    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
    setTimeout(() => autoSelectBackCameraAndStart(), 300);
    console.log("✅ Scanner initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing scanner:", error);
    showError("Gagal memulai scanner. Mohon refresh halaman.");
  }
}

// Helper function untuk show error
function showError(message) {
  const statusMsg = document.getElementById("statusMessage");
  if (statusMsg) {
    statusMsg.innerHTML = `<div class="alert alert-danger">${message}</div>`;
  }
}

function onScanSuccess(decodedText, decodedResult) {
  console.log("✅ QR Code terdeteksi:", decodedText);
  stopAdaptiveAutoZoom();

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
    setTimeout(() => {
      startAdaptiveAutoZoom();
    }, 600);
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

  // Tambahkan delay untuk pastikan DOM ready di mobile
  setTimeout(() => {
    initializeScanner();
  }, 100);
});

// Cleanup on unload
window.addEventListener("beforeunload", () => {
  stopAdaptiveAutoZoom();
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear();
  }
});
