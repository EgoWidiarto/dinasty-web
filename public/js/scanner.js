/* global QrScanner */
let scanner = null;
let scannerRunning = false;
let scannerTransitioning = false;
let torchEnabled = false;
let zoomSupported = false;
let lastScanAt = 0;
let lastScannedValue = "";
let aggressiveFallbackInterval = null;
let aggressiveFallbackBusy = false;
let hdScanBusy = false;
let fallbackPhase = 0;
let fallbackRegionCursor = 0;
let miniAggressiveTick = 0;

const FALLBACK_INTERVAL_MS = 1300;
const MINI_UPSCALE_SIZE = 1400;
const MINI_DEEP_PASS_EVERY = 3;
const MINI_CENTER_SCALES = [0.42, 0.34, 0.28, 0.22];
const FALLBACK_GRID = [
  { x: 0.2, y: 0.2 },
  { x: 0.5, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.2, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.8, y: 0.5 },
  { x: 0.2, y: 0.8 },
  { x: 0.5, y: 0.8 },
  { x: 0.8, y: 0.8 },
];

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
const hdScanBtn = document.getElementById("hdScanBtn");
const nativePhotoScanBtn = document.getElementById("nativePhotoScanBtn");
const nativePhotoInput = document.getElementById("nativePhotoInput");
const openBtn = document.getElementById("openResultBtn");
const copyBtn = document.getElementById("copyResultBtn");
const cameraInfoEl = document.getElementById("cameraInfoMessage");

function getTrack() {
  const stream = document.getElementById("qrVideo")?.srcObject;
  if (!stream) return null;
  const tracks = stream.getVideoTracks();
  return tracks.length ? tracks[0] : null;
}

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function setCameraInfo(message) {
  if (cameraInfoEl) cameraInfoEl.textContent = message;
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

async function onDecode(decoded) {
  const text = typeof decoded === "string" ? decoded : decoded?.data;
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

function stopAggressiveFallbackAssist() {
  if (aggressiveFallbackInterval) {
    clearInterval(aggressiveFallbackInterval);
    aggressiveFallbackInterval = null;
  }
}

async function tryScanImageTarget(target, qrEngine) {
  try {
    return await QrScanner.scanImage(target, {
      qrEngine,
      returnDetailedScanResult: true,
      alsoTryWithoutScanRegion: true,
    });
  } catch {
    return null;
  }
}

function drawContrastVariant(srcCanvas, contrast = 1.45) {
  const out = document.createElement("canvas");
  out.width = srcCanvas.width;
  out.height = srcCanvas.height;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return srcCanvas;

  ctx.drawImage(srcCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const boosted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}

function drawBinaryVariant(srcCanvas, threshold = 145) {
  const out = document.createElement("canvas");
  out.width = srcCanvas.width;
  out.height = srcCanvas.height;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return srcCanvas;

  ctx.drawImage(srcCanvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, out.width, out.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const bw = gray >= threshold ? 255 : 0;
    data[i] = bw;
    data[i + 1] = bw;
    data[i + 2] = bw;
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}

async function scanTinyQrFromImageSource(source, width, height) {
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  const srcCtx = src.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) return null;

  srcCtx.imageSmoothingEnabled = false;
  srcCtx.drawImage(source, 0, 0, width, height);

  const qrEngine = scanner?._qrEnginePromise;
  const tryScan = async (target) => {
    try {
      return await QrScanner.scanImage(target, {
        qrEngine,
        returnDetailedScanResult: true,
        alsoTryWithoutScanRegion: true,
      });
    } catch {
      return null;
    }
  };

  const variants = [src, drawContrastVariant(src, 1.45), drawBinaryVariant(src, 140), drawBinaryVariant(src, 165)];
  for (const v of variants) {
    const hit = await tryScan(v);
    if (hit?.data) return hit;
  }

  const up = document.createElement("canvas");
  const upSize = Math.min(3600, Math.max(2600, Math.floor(Math.min(width, height) * 1.8)));
  up.width = upSize;
  up.height = upSize;
  const upCtx = up.getContext("2d", { willReadFrequently: true });
  if (!upCtx) return null;

  upCtx.imageSmoothingEnabled = false;

  for (const v of variants) {
    for (const scale of [0.72, 0.56, 0.42, 0.32, 0.24, 0.18, 0.14]) {
      const cw = Math.floor(width * scale);
      const ch = Math.floor(height * scale);
      const sx = Math.floor((width - cw) / 2);
      const sy = Math.floor((height - ch) / 2);
      upCtx.clearRect(0, 0, up.width, up.height);
      upCtx.drawImage(v, sx, sy, cw, ch, 0, 0, up.width, up.height);
      const hit = await tryScan(up);
      if (hit?.data) return hit;
    }
  }

  const grid = [
    [0.2, 0.2],
    [0.5, 0.2],
    [0.8, 0.2],
    [0.2, 0.5],
    [0.5, 0.5],
    [0.8, 0.5],
    [0.2, 0.8],
    [0.5, 0.8],
    [0.8, 0.8],
  ];

  const cw = Math.floor(width * 0.22);
  const ch = Math.floor(height * 0.22);
  for (const v of variants) {
    for (const [cx, cy] of grid) {
      const sx = Math.max(0, Math.min(width - cw, Math.floor(width * cx - cw / 2)));
      const sy = Math.max(0, Math.min(height - ch, Math.floor(height * cy - ch / 2)));
      upCtx.clearRect(0, 0, up.width, up.height);
      upCtx.drawImage(v, sx, sy, cw, ch, 0, 0, up.width, up.height);
      const hit = await tryScan(up);
      if (hit?.data) return hit;
    }
  }

  return null;
}

async function scanTinyQrFromNativePhoto(file) {
  if (!file) return;
  if (!/^image\//i.test(file.type)) {
    setStatus("File bukan gambar.");
    return;
  }

  setStatus("Memproses foto kamera asli...");

  let bitmap = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
      setCameraInfo(`Foto native: ${bitmap.width}x${bitmap.height}`);
      const hit = await scanTinyQrFromImageSource(bitmap, bitmap.width, bitmap.height);
      if (hit?.data) {
        await onDecode(hit);
        setStatus("QR mini terbaca dari foto kamera asli.");
      } else {
        setStatus("Masih belum terbaca. Coba foto lebih dekat dan terang, lalu ulangi.");
      }
      return;
    }

    const img = await loadImageElementFromBlob(file);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    setCameraInfo(`Foto native: ${width}x${height}`);
    const hit = await scanTinyQrFromImageSource(img, width, height);
    if (hit?.data) {
      await onDecode(hit);
      setStatus("QR mini terbaca dari foto kamera asli.");
    } else {
      setStatus("Masih belum terbaca. Coba foto lebih dekat dan terang, lalu ulangi.");
    }
  } catch {
    setStatus("Gagal memproses foto kamera.");
  } finally {
    if (bitmap) bitmap.close();
  }
}

async function runAggressiveMiniFallbackScan() {
  if (!scannerRunning || !scanner || aggressiveFallbackBusy) return;
  const videoEl = document.getElementById("qrVideo");
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;

  aggressiveFallbackBusy = true;
  try {
    const qrEngine = scanner._qrEnginePromise;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;

    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = vw;
    srcCanvas.height = vh;
    const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) return;
    srcCtx.imageSmoothingEnabled = false;
    srcCtx.drawImage(videoEl, 0, 0, vw, vh);

    const upCanvas = document.createElement("canvas");
    upCanvas.width = MINI_UPSCALE_SIZE;
    upCanvas.height = MINI_UPSCALE_SIZE;
    const upCtx = upCanvas.getContext("2d", { willReadFrequently: true });
    if (!upCtx) return;
    upCtx.imageSmoothingEnabled = false;

    let hit = null;

    if (fallbackPhase === 0) {
      hit = await tryScanImageTarget(srcCanvas, qrEngine);
    }

    if (!hit && fallbackPhase === 1) {
      const scale = 0.38;
      const cw = Math.floor(vw * scale);
      const ch = Math.floor(vh * scale);
      const sx = Math.floor((vw - cw) / 2);
      const sy = Math.floor((vh - ch) / 2);
      upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, upCanvas.width, upCanvas.height);
      hit = await tryScanImageTarget(upCanvas, qrEngine);
    }

    if (!hit && fallbackPhase === 2) {
      const region = FALLBACK_GRID[fallbackRegionCursor % FALLBACK_GRID.length];
      fallbackRegionCursor += 1;
      const cw = Math.floor(vw * 0.28);
      const ch = Math.floor(vh * 0.28);
      const sx = Math.max(0, Math.min(vw - cw, Math.floor(vw * region.x - cw / 2)));
      const sy = Math.max(0, Math.min(vh - ch, Math.floor(vh * region.y - ch / 2)));
      upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, upCanvas.width, upCanvas.height);
      hit = await tryScanImageTarget(upCanvas, qrEngine);
    }

    fallbackPhase = (fallbackPhase + 1) % 3;
    miniAggressiveTick += 1;

    if (!hit && miniAggressiveTick % MINI_DEEP_PASS_EVERY === 0) {
      for (const scale of MINI_CENTER_SCALES) {
        const cw = Math.floor(vw * scale);
        const ch = Math.floor(vh * scale);
        const sx = Math.floor((vw - cw) / 2);
        const sy = Math.floor((vh - ch) / 2);
        upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, upCanvas.width, upCanvas.height);
        hit = await tryScanImageTarget(upCanvas, qrEngine);
        if (hit) break;
      }
    }

    if (hit?.data) {
      await onDecode(hit);
    }
  } finally {
    aggressiveFallbackBusy = false;
  }
}

function startAggressiveFallbackAssist() {
  stopAggressiveFallbackAssist();
  if (!scannerRunning) return;

  aggressiveFallbackInterval = setInterval(async () => {
    if (!scannerRunning) return;
    const idleMs = Date.now() - lastScanAt;
    if (idleMs < 700) return;
    await runAggressiveMiniFallbackScan();
  }, FALLBACK_INTERVAL_MS);
}

async function setupCamera() {
  if (!window.QrScanner) throw new Error("Nimiq QrScanner tidak tersedia.");

  if (!scanner) {
    const videoEl = document.getElementById("qrVideo");
    scanner = new QrScanner(
      videoEl,
      onDecode,
      {
        preferredCamera: "environment",
        maxScansPerSecond: 10,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        calculateScanRegion: (video) => {
          const smaller = Math.min(video.videoWidth, video.videoHeight);
          const scanSize = Math.floor(smaller * 0.62);
          return {
            x: Math.floor((video.videoWidth - scanSize) / 2),
            y: Math.floor((video.videoHeight - scanSize) / 2),
            width: scanSize,
            height: scanSize,
            downScaledWidth: 1400,
            downScaledHeight: 1400,
          };
        },
      },
      () => {
        // ignore no-qr frame
      },
    );

    if (typeof scanner.setInversionMode === "function") {
      scanner.setInversionMode("both");
    }

    if (typeof QrScanner.setGrayscaleWeights === "function") {
      QrScanner.setGrayscaleWeights(77, 150, 29, true);
    }
  }
}

async function setupZoomAndTorchCapabilities() {
  zoomSupported = false;
  torchEnabled = false;
  setZoomControlsEnabled(false);
  if (torchBtn) torchBtn.disabled = true;

  try {
    const track = getTrack();
    const capabilities = track?.getCapabilities ? track.getCapabilities() : {};

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
  } catch {
    // ignore capabilities errors
  }

  try {
    const hasFlash = await scanner.hasFlash();
    if (torchBtn) torchBtn.disabled = !hasFlash;
  } catch {
    if (torchBtn) torchBtn.disabled = true;
  }

  if (hdScanBtn) hdScanBtn.disabled = !scannerRunning;
}

async function optimizeCameraForMiniQr() {
  if (!scannerRunning || !scanner) return;

  try {
    const track = getTrack();
    if (!track || typeof track.getCapabilities !== "function") return;
    const caps = track.getCapabilities() || {};
    const advanced = [];

    const maxWidth = Number(caps.width?.max) || 1920;
    const maxHeight = Number(caps.height?.max) || 1920;
    const maxFps = Number(caps.frameRate?.max) || 30;

    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      advanced.push({ focusMode: "continuous" });
    }

    if (caps.focusDistance && Number.isFinite(caps.focusDistance.min)) {
      advanced.push({ focusDistance: caps.focusDistance.min });
    }

    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes("continuous")) {
      advanced.push({ exposureMode: "continuous" });
    }

    if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes("continuous")) {
      advanced.push({ whiteBalanceMode: "continuous" });
    }

    const constraints = {
      width: { ideal: maxWidth, max: maxWidth },
      height: { ideal: maxHeight, max: maxHeight },
      frameRate: { ideal: Math.min(30, maxFps), max: maxFps },
      advanced,
    };

    await track.applyConstraints(constraints);

    const settings = track.getSettings ? track.getSettings() : null;
    const width = settings?.width || "-";
    const height = settings?.height || "-";
    const fps = settings?.frameRate ? `${Math.round(settings.frameRate)}fps` : "fps ?";
    const facing = settings?.facingMode || "kamera";
    setCameraInfo(`Kamera aktif: ${facing} | ${width}x${height} | ${fps}`);
  } catch {
    // capability may not be available on all devices
  }
}

function loadImageElementFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Gagal memuat foto HD."));
    };
    img.src = url;
  });
}

async function captureHdSource(video) {
  const track = getTrack();
  if (track && typeof window.ImageCapture !== "undefined") {
    try {
      const imageCapture = new window.ImageCapture(track);
      const blob = await imageCapture.takePhoto();

      if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          sourceType: "photo",
          cleanup: () => bitmap.close(),
        };
      }

      const img = await loadImageElementFromBlob(blob);
      return {
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        sourceType: "photo",
        cleanup: () => {},
      };
    } catch {
      // fallback ke frame video jika takePhoto tidak didukung / gagal
    }
  }

  return {
    source: video,
    width: video.videoWidth,
    height: video.videoHeight,
    sourceType: "video",
    cleanup: () => {},
  };
}

async function applyZoom(nextZoom) {
  if (!scannerRunning || !zoomSupported || !zoomSlider) return;
  const track = getTrack();
  if (!track) return;

  const min = Number(zoomSlider.min);
  const max = Number(zoomSlider.max);
  const value = Math.max(min, Math.min(max, Number(nextZoom)));

  try {
    await track.applyConstraints({ advanced: [{ zoom: value }] });
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
    if (torchEnabled) {
      await scanner.turnFlashOn();
    } else {
      await scanner.turnFlashOff();
    }
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

    await scanner.start();

    scannerRunning = true;
    lastScanAt = Date.now();
    hdScanBusy = false;
    fallbackPhase = 0;
    fallbackRegionCursor = 0;
    miniAggressiveTick = 0;
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;

    await setupZoomAndTorchCapabilities();
    await optimizeCameraForMiniQr();
    startAggressiveFallbackAssist();
    setStatus("Mode agresif aktif. Jika QR mini sulit terbaca, tekan tombol Scan HD (QR Mini).");
  } catch (error) {
    console.error(error);
    setStatus("Gagal memulai scanner. Pastikan izin kamera aktif.");
    setCameraInfo("Kamera gagal diinisialisasi.");
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
      scanner.destroy();
      scanner = null;
    }

    stopAggressiveFallbackAssist();

    scannerRunning = false;
    torchEnabled = false;
    hdScanBusy = false;
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (hdScanBtn) hdScanBtn.disabled = true;
    if (torchBtn) {
      torchBtn.textContent = "Senter";
      torchBtn.disabled = true;
    }
    setZoomControlsEnabled(false);
    setStatus("Scanner dihentikan.");
    setCameraInfo("Kamera tidak aktif.");
  } finally {
    scannerTransitioning = false;
  }
}

async function scanMiniQrViaHdSnapshot() {
  if (!scannerRunning || !scanner || hdScanBusy) return;
  const video = document.getElementById("qrVideo");
  if (!video || !video.videoWidth || !video.videoHeight) return;

  hdScanBusy = true;
  if (hdScanBtn) hdScanBtn.disabled = true;
  setStatus("Memproses snapshot HD untuk QR mini...");

  let hdCapture = null;
  try {
    hdCapture = await captureHdSource(video);
    const vw = hdCapture.width;
    const vh = hdCapture.height;

    setCameraInfo(`Mode HD source: ${hdCapture.sourceType} | ${vw}x${vh}`);

    const hit = await scanTinyQrFromImageSource(hdCapture.source, vw, vh);

    if (hit?.data) {
      await onDecode(hit);
      setStatus("QR mini terbaca via snapshot HD.");
    } else {
      setStatus("Belum terbaca. Coba jarak 7-12 cm, lalu tekan Scan HD lagi.");
    }
  } finally {
    if (hdCapture?.cleanup) hdCapture.cleanup();
    hdScanBusy = false;
    if (hdScanBtn) hdScanBtn.disabled = !scannerRunning;
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
  hdScanBtn?.addEventListener("click", scanMiniQrViaHdSnapshot);
  nativePhotoScanBtn?.addEventListener("click", () => {
    nativePhotoInput?.click();
  });

  nativePhotoInput?.addEventListener("change", async (event) => {
    const input = event.target;
    const file = input?.files?.[0];
    if (file) await scanTinyQrFromNativePhoto(file);
    if (input) input.value = "";
  });

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
  setCameraInfo("Kamera belum aktif.");
  setStatus('Siap memindai QR mini. Tekan "Mulai Scan".');
});
