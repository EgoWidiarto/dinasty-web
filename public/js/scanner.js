// QR Scanner Script
let html5QrcodeScanner;
let scannedResult = null;
let autoZoomIntervalId = null;
let scannerUiBootstrapTimer = null;
let scannerUiBootstrapAttempts = 0;
let hasAutoStartedScanner = false;
let currentZoomLevel = 1;
let lastTouchDistance = 0;

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function pickOptimalCameraOption(options, isMobile) {
  const validOptions = options.filter((opt) => {
    const value = (opt.value || "").trim();
    const label = (opt.textContent || "").toLowerCase();
    if (!value) return false;
    if (/select|pilih|choose/.test(label)) return false;
    return true;
  });

  if (validOptions.length === 0) {
    return null;
  }

  const scored = validOptions.map((opt) => {
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
  return scored[0]?.opt || validOptions[0];
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
    currentZoomLevel = targetZoom;
    await inner.applyVideoConstraints({ advanced: [{ zoom: targetZoom }] });
    updateZoomDisplay();
    return true;
  } catch (err) {
    console.warn("Zoom constraint tidak didukung kamera/browser:", err);
    return false;
  }
}

async function increaseZoom() {
  const inner = getInnerHtml5QrcodeInstance();
  if (!inner || typeof inner.getRunningTrackCapabilities !== "function") return;

  try {
    const capabilities = inner.getRunningTrackCapabilities();
    if (!capabilities?.zoom) return;

    const min = capabilities.zoom.min || 1;
    const max = capabilities.zoom.max || min;
    const step = (max - min) * 0.1; // 10% increment

    const newZoom = Math.min(max, currentZoomLevel + step);
    await inner.applyVideoConstraints({ advanced: [{ zoom: newZoom }] });
    currentZoomLevel = newZoom;
    updateZoomDisplay();
  } catch (err) {
    console.warn("Zoom increase failed:", err);
  }
}

async function decreaseZoom() {
  const inner = getInnerHtml5QrcodeInstance();
  if (!inner || typeof inner.getRunningTrackCapabilities !== "function") return;

  try {
    const capabilities = inner.getRunningTrackCapabilities();
    if (!capabilities?.zoom) return;

    const min = capabilities.zoom.min || 1;
    const max = capabilities.zoom.max || min;
    const step = (max - min) * 0.1; // 10% decrement

    const newZoom = Math.max(min, currentZoomLevel - step);
    await inner.applyVideoConstraints({ advanced: [{ zoom: newZoom }] });
    currentZoomLevel = newZoom;
    updateZoomDisplay();
  } catch (err) {
    console.warn("Zoom decrease failed:", err);
  }
}

function updateZoomDisplay() {
  const zoomDisplay = document.getElementById("zoomLevelDisplay");
  if (zoomDisplay) {
    zoomDisplay.textContent = `${Math.round(currentZoomLevel * 100)}%`;
  }
}

function setupPinchToZoom() {
  const readerEl = document.getElementById("reader");
  if (!readerEl) return;

  let lastTouchDistance = 0;

  readerEl.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 2) {
        e.preventDefault(); // Prevent default pinch behavior

        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);

        if (lastTouchDistance > 0) {
          const delta = distance - lastTouchDistance;
          if (delta > 5) {
            increaseZoom(); // Pinch out = zoom in
          } else if (delta < -5) {
            decreaseZoom(); // Pinch in = zoom out
          }
        }

        lastTouchDistance = distance;
      }
    },
    { passive: false },
  );

  readerEl.addEventListener("touchend", () => {
    lastTouchDistance = 0;
  });
}

function startAdaptiveAutoZoom() {
  stopAdaptiveAutoZoom();

  // Zoom levels lebih agresif untuk scan QR kecil
  const zoomLevels = [0.4, 0.55, 0.7, 0.82, 0.92];
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
  }, 1500); // Lebih sering cek (dari 1800ms jadi 1500ms)
}

function stopAdaptiveAutoZoom() {
  if (autoZoomIntervalId) {
    clearInterval(autoZoomIntervalId);
    autoZoomIntervalId = null;
  }
}

function translateScannerTextToIndonesian(text) {
  const normalized = (text || "").trim();
  if (!normalized) return null;

  const translationRules = [
    [/^start scanning$/i, "Mulai Memindai"],
    [/^stop scanning$/i, "Hentikan Pemindaian"],
    [/^scan an image file$/i, "Unggah Gambar QR"],
    [/^scan using camera directly$/i, "Pindai Langsung dengan Kamera"],
    [/^camera based scan$/i, "Mode Kamera"],
    [/^file based scan$/i, "Mode File"],
    [/^select camera\s*\((\d+)\)$/i, "Pilih Kamera ($1)"],
    [/^select camera$/i, "Pilih Kamera"],
    [/^requesting camera permissions$/i, "Meminta Izin Kamera"],
    [/^no cameras found$/i, "Kamera Tidak Ditemukan"],
    [/^camera permission denied$/i, "Izin Kamera Ditolak"],
    [/^camera access is blocked$/i, "Akses Kamera Diblokir"],
    [/^launch camera$/i, "Meluncurkan Kamera"],
    [/^torch on$/i, "Nyalakan Senter"],
    [/^torch off$/i, "Matikan Senter"],
    [/^torch$/i, "Senter"],
  ];

  for (const [regex, replacement] of translationRules) {
    if (regex.test(normalized)) {
      return normalized.replace(regex, replacement);
    }
  }

  return null;
}

function localizeAndPolishScannerUi() {
  const readerEl = document.getElementById("reader");
  if (!readerEl) return;

  const applyUi = () => {
    const swapLink = readerEl.querySelector("#reader__dashboard_section_swaplink");
    if (swapLink) {
      swapLink.style.display = "none";
    }

    const fileScanSection = readerEl.querySelector("#reader__dashboard_section_fsr");
    if (fileScanSection) {
      fileScanSection.style.display = "none";
    }

    // Hilangkan teks "Select Camera (x)" tanpa menghapus tombol Start
    const cameraSection = readerEl.querySelector("#reader__dashboard_section_csr");
    if (cameraSection) {
      const walker = document.createTreeWalker(cameraSection, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      textNodes.forEach((node) => {
        const txt = (node.nodeValue || "").trim();
        if (/^select camera\s*\(\d+\)$/i.test(txt) || /^select camera$/i.test(txt) || /^pilih kamera\s*\(\d+\)$/i.test(txt) || /^pilih kamera$/i.test(txt)) {
          node.nodeValue = "";
        }
      });

      const labelCandidates = Array.from(cameraSection.querySelectorAll("label, span, p"));
      labelCandidates.forEach((el) => {
        if (el.children.length > 0) return;
        const txt = (el.textContent || "").trim();
        if (/^select camera\s*\(\d+\)$/i.test(txt) || /^select camera$/i.test(txt) || /^pilih kamera\s*\(\d+\)$/i.test(txt) || /^pilih kamera$/i.test(txt)) {
          el.style.display = "none";
        }
      });
    }

    const allButtons = Array.from(readerEl.querySelectorAll("button"));
    allButtons.forEach((btn) => {
      const label = (btn.textContent || "").trim().toLowerCase();

      if (/request camera permissions|minta izin kamera|izinkan kamera/.test(label)) {
        btn.textContent = "Izinkan Kamera";
        btn.classList.add("scanner-permission-btn");
      } else if (/stop scanning|hentikan scan|hentikan pemindaian/.test(label)) {
        btn.textContent = "Hentikan Pemindaian";
        btn.classList.add("scanner-stop-btn");
      } else if (/start scanning|start|mulai|scan|memindai/.test(label)) {
        btn.textContent = "Mulai Memindai";
        btn.classList.add("scanner-start-btn");
      } else if (/torch|senter/.test(label)) {
        // Update torch button text
        if (/off|matikan/i.test(label)) {
          btn.textContent = "Matikan Senter";
        } else {
          btn.textContent = "Nyalakan Senter";
        }
        btn.classList.add("scanner-torch-btn");
      }
    });

    // Terjemahkan semua teks bawaan html5-qrcode yang masih berbahasa Inggris
    const translatableElements = Array.from(readerEl.querySelectorAll("button, a, span, p, label"));
    translatableElements.forEach((el) => {
      if (el.children.length > 0) return;

      const raw = (el.textContent || "").trim();
      const translated = translateScannerTextToIndonesian(raw);
      if (translated && translated !== raw) {
        el.textContent = translated;
      }
    });

    // Sembunyikan teks bawaan "Select Camera (x)" jika masih muncul
    const maybeCameraLabels = Array.from(readerEl.querySelectorAll("span, p, label"));
    maybeCameraLabels.forEach((el) => {
      if (el.children.length > 0) return;
      const txt = (el.textContent || "").trim();
      if (/^select camera\s*\(\d+\)$/i.test(txt) || /^select camera$/i.test(txt)) {
        el.style.display = "none";
      }
    });
  };

  applyUi();
}

function autoSelectBackCameraAndStart() {
  if (hasAutoStartedScanner) return;

  const readerEl = document.getElementById("reader");
  if (!readerEl) return;

  const cameraSelect = readerEl.querySelector("select");
  const startButton = Array.from(readerEl.querySelectorAll("button")).find((btn) => /start|mulai|scan/i.test(btn.textContent || ""));

  if (!cameraSelect || cameraSelect.options.length === 0) {
    return;
  }

  const options = Array.from(cameraSelect.options);
  const targetOption = pickOptimalCameraOption(options, isMobileDevice());

  if (targetOption && cameraSelect.value !== targetOption.value) {
    cameraSelect.value = targetOption.value;
    cameraSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Jika belum ada kamera valid, tunggu render berikutnya
  if (!targetOption) {
    return;
  }

  // Beri jeda kecil agar UI internal selesai memproses event change
  setTimeout(() => {
    if (hasAutoStartedScanner) return;
    const startButtonAfterSelect = Array.from(readerEl.querySelectorAll("button")).find((btn) => /start|mulai|scan/i.test(btn.textContent || ""));
    if (startButtonAfterSelect && !startButtonAfterSelect.disabled) {
      hasAutoStartedScanner = true;
      startButtonAfterSelect.click();
      setTimeout(() => {
        startAdaptiveAutoZoom();
      }, 1200);
      stopScannerUiBootstrap();
    }
  }, 120);
}

function stopScannerUiBootstrap() {
  if (scannerUiBootstrapTimer) {
    clearInterval(scannerUiBootstrapTimer);
    scannerUiBootstrapTimer = null;
  }
}

function startScannerUiBootstrap() {
  stopScannerUiBootstrap();
  scannerUiBootstrapAttempts = 0;
  hasAutoStartedScanner = false;

  scannerUiBootstrapTimer = setInterval(() => {
    scannerUiBootstrapAttempts += 1;
    localizeAndPolishScannerUi();
    autoSelectBackCameraAndStart();

    // Batasi percobaan agar tidak membebani halaman
    if (hasAutoStartedScanner || scannerUiBootstrapAttempts >= 30) {
      stopScannerUiBootstrap();
    }
  }, 350);
}

function observeScannerUiForAutoStart() {
  const readerEl = document.getElementById("reader");
  if (!readerEl || typeof MutationObserver === "undefined") return;

  const observer = new MutationObserver(() => {
    // Coba auto-select berulang tiap ada perubahan UI scanner
    autoSelectBackCameraAndStart();
    localizeAndPolishScannerUi();
  });

  observer.observe(readerEl, {
    childList: true,
    subtree: true,
  });

  // Auto stop observer setelah fase inisialisasi untuk mencegah overhead
  setTimeout(() => {
    observer.disconnect();
  }, 12000);
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

    const scannerConfig = {
      fps: isMobile ? 15 : 20, // Lebih tinggi untuk deteksi lebih cepat
      qrbox: isMobile ? { width: 280, height: 280 } : { width: 350, height: 350 }, // Qr box lebih besar
      rememberLastUsedCamera: false,
      showTorchButtonIfSupported: true,
      aspectRatio: 1.0,
      videoConstraints: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 }, // Resolusi lebih tinggi
        height: { ideal: 1280 },
      },
      // Force camera untuk mobile
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    };

    // Hanya aktifkan mode kamera (hilangkan tombol "Scan an Image File")
    if (typeof Html5QrcodeScanType !== "undefined") {
      scannerConfig.supportedScanTypes = [Html5QrcodeScanType.SCAN_TYPE_CAMERA];
    }

    html5QrcodeScanner = new Html5QrcodeScanner("reader", scannerConfig, false);

    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
    startScannerUiBootstrap();
    setupPinchToZoom();
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
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const zoomSlider = document.getElementById("zoomSlider");

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

  // Zoom controls
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", increaseZoom);
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", decreaseZoom);
  }

  if (zoomSlider) {
    zoomSlider.addEventListener("input", async (e) => {
      const value = parseFloat(e.target.value);
      await applyZoomLevel(value);
    });
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
  stopScannerUiBootstrap();
  stopAdaptiveAutoZoom();
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear();
  }
});
