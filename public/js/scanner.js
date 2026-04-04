/* global Html5Qrcode */
let scanner = null;
let scannerRunning = false;
let scannerTransitioning = false;
let torchEnabled = false;
let zoomSupported = false;
let cameraId = null;
let lastScanAt = 0;
let lastScannedValue = "";

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

function setZoomControlsEnabled(enabled) {
  const active = enabled && zoomSupported;
  if (zoomInBtn) zoomInBtn.disabled = !active;
  if (zoomOutBtn) zoomOutBtn.disabled = !active;
  if (zoomSlider) zoomSlider.disabled = !active;
}

function updateZoomLabel(value) {
  if (!zoomLabel) return;
  zoomLabel.textContent = `${Math.round((Number(value) || 1) * 100)}%`;
}

async function logScannedUrl(value) {
  try {
    await fetch("/api/qr/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: value, timestamp: new Date().toISOString() }),
    });
  } catch {
    // non-blocking
  }
}

async function fetchQrInfo(value) {
  try {
    const response = await fetch(`/api/qr/validate?url=${encodeURIComponent(value)}`);
    const data = await response.json();
    if (data.success) return `${data.title} — ${data.description}`;
  } catch {
    // fallback
  }
  return "QR terdeteksi.";
}

async function onDecode(text) {
  if (!text) return;
  const now = Date.now();
  if (text === lastScannedValue && now - lastScanAt < 1800) return;

  lastScannedValue = text;
  lastScanAt = now;

  const meta = await fetchQrInfo(text);
  showResult(text, meta);
  setStatus("QR berhasil terbaca. Anda bisa scan lagi atau buka hasil.");
  await logScannedUrl(text);
}

async function setupCamera() {
  if (!window.Html5Qrcode) throw new Error("html5-qrcode tidak tersedia.");

  if (!scanner) {
    scanner = new Html5Qrcode("qrVideo", { formatsToSupport: [0] });
  }

  const cameras = await Html5Qrcode.getCameras();
  if (!cameras || !cameras.length) throw new Error("Kamera tidak ditemukan.");
  cameraId = cameras.find((cam) => /back|rear|environment/i.test(cam.label))?.id || cameras[0].id;
}

async function setupZoomAndTorchCapabilities() {
  zoomSupported = false;
  torchEnabled = false;
  setZoomControlsEnabled(false);
  if (torchBtn) torchBtn.disabled = true;

  try {
    const capabilities = scanner.getRunningTrackCapabilities?.() || {};

    if (capabilities.zoom && zoomSlider) {
      zoomSupported = true;
      zoomSlider.min = String(capabilities.zoom.min ?? 1);
      zoomSlider.max = String(capabilities.zoom.max ?? 3);
      zoomSlider.step = String(capabilities.zoom.step ?? 0.1);
      const initial = capabilities.zoom.min ?? 1;
      zoomSlider.value = String(initial);
      updateZoomLabel(initial);
      setZoomControlsEnabled(true);
    } else {
      updateZoomLabel(1);
    }

    if (capabilities.torch && torchBtn) {
      torchBtn.disabled = false;
    }
  } catch {
    // ignore capabilities errors
  }
}

async function applyZoom(nextZoom) {
  if (!scannerRunning || !zoomSupported || !zoomSlider) return;
  const min = Number(zoomSlider.min);
  const max = Number(zoomSlider.max);
  const value = Math.max(min, Math.min(max, Number(nextZoom)));

  try {
    await scanner.applyVideoConstraints({ advanced: [{ zoom: value }] });
    zoomSlider.value = String(value);
    updateZoomLabel(value);
  } catch {
    // ignore
  }
}

async function toggleTorch() {
  if (!scannerRunning || !torchBtn || torchBtn.disabled) return;

  try {
    torchEnabled = !torchEnabled;
    await scanner.applyVideoConstraints({ advanced: [{ torch: torchEnabled }] });
    torchBtn.textContent = torchEnabled ? "Senter Off" : "Senter";
  } catch {
    torchEnabled = false;
    torchBtn.textContent = "Senter";
    setStatus("Senter tidak didukung di perangkat ini.");
  }
}

async function startScanner() {
  if (scannerRunning || scannerTransitioning) return;
  scannerTransitioning = true;

  try {
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;

    resetResult();
    setStatus("Meminta izin kamera...");

    await setupCamera();

    await scanner.start(
      cameraId,
      {
        fps: 20,
        qrbox: (vw, vh) => {
          const side = Math.floor(Math.min(vw, vh) * 0.62);
          return { width: side, height: side };
        },
        aspectRatio: 1,
        disableFlip: false,
        videoConstraints: {
          width: { ideal: 1920 },
          height: { ideal: 1920 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: "environment",
        },
      },
      onDecode,
      () => {
        // ignore decode miss
      },
    );

    scannerRunning = true;
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;

    await setupZoomAndTorchCapabilities();
    setStatus("Scanner aktif (tanpa auto zoom). Dekatkan QR mini 8-12 cm dan tahan stabil.");
  } catch (error) {
    console.error(error);
    setStatus("Gagal memulai scanner. Pastikan izin kamera aktif.");
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  } finally {
    scannerTransitioning = false;
  }
}

async function stopScanner() {
  if (scannerTransitioning) return;
  scannerTransitioning = true;

  try {
    if (scanner && scannerRunning) {
      await scanner.stop();
      await scanner.clear();
    }

    scannerRunning = false;
    torchEnabled = false;
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (torchBtn) {
      torchBtn.textContent = "Senter";
      torchBtn.disabled = true;
    }
    setZoomControlsEnabled(false);
    setStatus("Scanner dihentikan.");
  } finally {
    scannerTransitioning = false;
  }
}

function bindUi() {
  const backBtn = document.getElementById("backBtn");

  backBtn?.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "/";
  });

  startBtn?.addEventListener("click", startScanner);
  stopBtn?.addEventListener("click", stopScanner);
  torchBtn?.addEventListener("click", toggleTorch);

  zoomSlider?.addEventListener("input", async (event) => {
    await applyZoom(event.target.value);
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
    if (document.hidden && scannerRunning) await stopScanner();
  });

  window.addEventListener("beforeunload", async () => {
    if (scannerRunning) await stopScanner();
  });
}

window.addEventListener("load", () => {
  bindUi();
  setStatus('Siap memindai QR mini. Tekan "Mulai Scan".');
});
