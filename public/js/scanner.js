/* global QrScanner */
let qrScanner = null;
let isScanning = false;
let torchEnabled = false;
let zoomSupported = false;
let autoZoomTimer = null;
let lastScanAt = 0;
let lastScannedValue = "";

const videoEl = document.getElementById("qrVideo");
const statusEl = document.getElementById("statusMessage");
const resultCardEl = document.getElementById("scanResultCard");
const resultTextEl = document.getElementById("scanResultText");
const resultMetaEl = document.getElementById("scanResultMeta");
const startBtn = document.getElementById("startScanBtn");
const stopBtn = document.getElementById("stopScanBtn");
const torchBtn = document.getElementById("toggleTorchBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomSlider = document.getElementById("zoomSlider");
const zoomLabel = document.getElementById("zoomLevelDisplay");
const openBtn = document.getElementById("openResultBtn");
const copyBtn = document.getElementById("copyResultBtn");

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function showResult(text, meta = "") {
  if (!resultCardEl || !resultTextEl || !resultMetaEl) return;
  resultCardEl.classList.remove("d-none");
  resultTextEl.textContent = text;
  resultMetaEl.textContent = meta;
}

function resetResult() {
  if (!resultCardEl || !resultTextEl || !resultMetaEl) return;
  resultCardEl.classList.add("d-none");
  resultTextEl.textContent = "";
  resultMetaEl.textContent = "";
}

function isLikelyUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getTrack() {
  const stream = videoEl?.srcObject;
  if (!stream) return null;
  const tracks = stream.getVideoTracks();
  return tracks.length ? tracks[0] : null;
}

function updateZoomLabel(value) {
  if (!zoomLabel) return;
  const numeric = Number(value) || 1;
  zoomLabel.textContent = `${Math.round(numeric * 100)}%`;
}

function setZoomControlsEnabled(enabled) {
  const hasControls = enabled && zoomSupported;
  if (zoomInBtn) zoomInBtn.disabled = !hasControls;
  if (zoomOutBtn) zoomOutBtn.disabled = !hasControls;
  if (zoomSlider) zoomSlider.disabled = !hasControls;
}

async function applyZoom(nextZoom) {
  const track = getTrack();
  if (!track || !zoomSupported || !zoomSlider) return;

  const min = Number(zoomSlider.min);
  const max = Number(zoomSlider.max);
  const clamped = Math.min(max, Math.max(min, nextZoom));

  try {
    await track.applyConstraints({ advanced: [{ zoom: clamped }] });
    zoomSlider.value = String(clamped);
    updateZoomLabel(clamped);
  } catch (error) {
    console.warn("Gagal set zoom:", error);
  }
}

async function setupZoomControls() {
  const track = getTrack();
  if (!track || !zoomSlider) return;

  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  const settings = track.getSettings ? track.getSettings() : {};

  if (!capabilities.zoom) {
    zoomSupported = false;
    updateZoomLabel(1);
    setZoomControlsEnabled(false);
    return;
  }

  zoomSupported = true;
  zoomSlider.min = String(capabilities.zoom.min ?? 1);
  zoomSlider.max = String(capabilities.zoom.max ?? 3);
  zoomSlider.step = String(capabilities.zoom.step ?? 0.1);

  const defaultZoom = settings.zoom ?? Number(zoomSlider.min);
  zoomSlider.value = String(defaultZoom);
  updateZoomLabel(defaultZoom);

  setZoomControlsEnabled(true);
}

function startAutoZoomAssist() {
  if (!zoomSupported || autoZoomTimer) return;

  const levels = [0.15, 0.3, 0.45, 0.6, 0.78, 0.9];
  let levelIndex = 0;

  autoZoomTimer = window.setInterval(async () => {
    if (!isScanning || !zoomSlider) return;

    const now = Date.now();
    const isRecentlyDetected = now - lastScanAt < 3000;
    if (isRecentlyDetected) return;

    const min = Number(zoomSlider.min);
    const max = Number(zoomSlider.max);
    const ratio = levels[levelIndex % levels.length];
    const targetZoom = min + (max - min) * ratio;

    await applyZoom(targetZoom);
    levelIndex += 1;
  }, 1300);
}

function stopAutoZoomAssist() {
  if (!autoZoomTimer) return;
  window.clearInterval(autoZoomTimer);
  autoZoomTimer = null;
}

async function setupTorchButton() {
  if (!torchBtn || !qrScanner) return;
  try {
    const hasFlash = await qrScanner.hasFlash();
    torchBtn.disabled = !hasFlash;
  } catch {
    torchBtn.disabled = true;
  }
}

async function logScannedUrl(value) {
  try {
    await fetch("/api/qr/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: value,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.warn("Gagal kirim log QR:", error);
  }
}

async function fetchQrInfo(value) {
  try {
    const response = await fetch(`/api/qr/validate?url=${encodeURIComponent(value)}`);
    const data = await response.json();

    if (data.success) {
      return `${data.title} — ${data.description}`;
    }
  } catch {
    // Silent fallback
  }
  return "QR terdeteksi.";
}

function onDecodeError(error) {
  if (!error) return;
  const text = String(error);
  if (text.includes("No QR code found")) return;
  console.debug("Decode issue:", error);
}

async function handleDecode(result) {
  const raw = typeof result === "string" ? result : result?.data;
  if (!raw) return;

  const now = Date.now();
  if (raw === lastScannedValue && now - lastScanAt < 1800) return;

  lastScannedValue = raw;
  lastScanAt = now;

  const meta = await fetchQrInfo(raw);
  showResult(raw, meta);
  setStatus("QR berhasil terbaca. Anda bisa scan lagi atau buka hasil.");

  await logScannedUrl(raw);
}

async function createScanner() {
  if (!window.QrScanner) {
    throw new Error("Library QR scanner tidak ditemukan.");
  }

  if (qrScanner) return;

  qrScanner = new QrScanner(
    videoEl,
    handleDecode,
    {
      preferredCamera: "environment",
      maxScansPerSecond: 25,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      returnDetailedScanResult: true,
      calculateScanRegion: (video) => {
        const smaller = Math.min(video.videoWidth, video.videoHeight);
        const scanSize = Math.floor(smaller * 0.92);
        return {
          x: Math.floor((video.videoWidth - scanSize) / 2),
          y: Math.floor((video.videoHeight - scanSize) / 2),
          width: scanSize,
          height: scanSize,
          downScaledWidth: 1200,
          downScaledHeight: 1200,
        };
      },
    },
    onDecodeError,
  );

  if (typeof qrScanner.setInversionMode === "function") {
    qrScanner.setInversionMode("both");
  }

  if (typeof QrScanner.setGrayscaleWeights === "function") {
    QrScanner.setGrayscaleWeights(77, 150, 29, true);
  }
}

async function startScanner() {
  try {
    await createScanner();
    resetResult();
    setStatus("Meminta izin kamera...");

    await qrScanner.start();
    isScanning = true;

    startBtn.disabled = true;
    stopBtn.disabled = false;

    await setupZoomControls();
    await setupTorchButton();
    startAutoZoomAssist();

    setStatus("Scanner aktif. Arahkan kamera ke QR mini pada kotak panduan.");
  } catch (error) {
    console.error(error);
    setStatus("Gagal memulai scanner. Pastikan izin kamera aktif.");
  }
}

async function stopScanner() {
  stopAutoZoomAssist();

  if (qrScanner && isScanning) {
    await qrScanner.stop();
  }

  isScanning = false;
  torchEnabled = false;

  startBtn.disabled = false;
  stopBtn.disabled = true;
  if (torchBtn) {
    torchBtn.textContent = "Senter";
    torchBtn.disabled = true;
  }
  setZoomControlsEnabled(false);

  setStatus("Scanner dihentikan.");
}

function bindUi() {
  const backBtn = document.getElementById("backBtn");

  backBtn?.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/";
    }
  });

  startBtn?.addEventListener("click", startScanner);
  stopBtn?.addEventListener("click", stopScanner);

  torchBtn?.addEventListener("click", async () => {
    if (!qrScanner || !isScanning || torchBtn.disabled) return;

    try {
      torchEnabled = !torchEnabled;
      if (torchEnabled) {
        await qrScanner.turnFlashOn();
        torchBtn.textContent = "Senter Off";
      } else {
        await qrScanner.turnFlashOff();
        torchBtn.textContent = "Senter";
      }
    } catch (error) {
      torchEnabled = false;
      torchBtn.textContent = "Senter";
      console.warn("Senter tidak didukung:", error);
    }
  });

  zoomSlider?.addEventListener("input", async (event) => {
    await applyZoom(Number(event.target.value));
  });

  zoomInBtn?.addEventListener("click", async () => {
    if (!zoomSlider) return;
    await applyZoom(Number(zoomSlider.value) + Number(zoomSlider.step || 0.1));
  });

  zoomOutBtn?.addEventListener("click", async () => {
    if (!zoomSlider) return;
    await applyZoom(Number(zoomSlider.value) - Number(zoomSlider.step || 0.1));
  });

  copyBtn?.addEventListener("click", async () => {
    const value = resultTextEl?.textContent?.trim();
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setStatus("Isi QR berhasil disalin.");
    } catch {
      setStatus("Gagal menyalin isi QR.");
    }
  });

  openBtn?.addEventListener("click", () => {
    const value = resultTextEl?.textContent?.trim();
    if (!value || !isLikelyUrl(value)) {
      setStatus("Hasil scan bukan URL yang valid.");
      return;
    }

    window.open(value, "_blank", "noopener,noreferrer");
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden && isScanning) {
      await stopScanner();
    }
  });

  window.addEventListener("beforeunload", async () => {
    if (qrScanner) {
      stopAutoZoomAssist();
      await qrScanner.stop();
      qrScanner.destroy();
      qrScanner = null;
    }
  });
}

window.addEventListener("load", () => {
  bindUi();
  setStatus('Siap memindai QR mini. Tekan "Mulai Scan".');
});
