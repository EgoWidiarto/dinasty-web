// Scanner QR baru (clean rewrite) fokus mini QR
let html5Qr = null;
let scannedResult = null;
let fallbackIntervalId = null;
let fallbackBusy = false;
let currentZoomLevel = 1;
let scanStartedAt = 0;
let fallbackPhase = 0;
let fallbackRegionCursor = 0;
let availableCameras = [];
let selectedCameraId = null;
let nativeBarcodeDetector = null;
let nativeDetectBusy = false;
let scanMode = "normal";
let miniAggressiveTick = 0;

const FALLBACK_INTERVAL_MS = 1300;
const FALLBACK_UPSCALE_SIZE = 900;
const MINI_UPSCALE_SIZE = 1200;
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

const MINI_QR_CONFIG = {
  mobile: { fps: 10, qrbox: { width: 160, height: 160 }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 } },
  desktop: { fps: 12, qrbox: { width: 200, height: 200 }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 } },
};

const NORMAL_QR_CONFIG = {
  mobile: { fps: 10, qrbox: { width: 260, height: 260 }, width: { ideal: 1280, min: 960 }, height: { ideal: 720, min: 540 } },
  desktop: { fps: 12, qrbox: { width: 320, height: 320 }, width: { ideal: 1280, min: 960 }, height: { ideal: 720, min: 540 } },
};

function getCurrentScanPreset() {
  const isMobile = isMobileDevice();
  return scanMode === "mini" ? (isMobile ? MINI_QR_CONFIG.mobile : MINI_QR_CONFIG.desktop) : isMobile ? NORMAL_QR_CONFIG.mobile : NORMAL_QR_CONFIG.desktop;
}

function setActiveMode(nextMode) {
  scanMode = nextMode === "mini" ? "mini" : "normal";
  const miniBtn = document.getElementById("miniModeBtn");
  const normalBtn = document.getElementById("normalModeBtn");

  if (miniBtn) miniBtn.classList.toggle("active", scanMode === "mini");
  if (normalBtn) normalBtn.classList.toggle("active", scanMode === "normal");

  const guideText = scanMode === "mini" ? "Mode Mini QR aktif: crop tengah, zoom lebih agresif, dan scan lebih sensitif untuk QR kecil." : "Mode Normal aktif: scan lebih ringan untuk QR ukuran biasa dan lebih cepat.";
  setGuide(guideText, scanMode === "mini" ? "warning" : "success");
}

function initNativeBarcodeDetector() {
  try {
    if (typeof BarcodeDetector === "undefined") return null;
    if (nativeBarcodeDetector) return nativeBarcodeDetector;

    const formats = Array.isArray(BarcodeDetector.getSupportedFormats?.()) ? BarcodeDetector.getSupportedFormats() : [];
    if (!formats.includes("qr_code")) return null;

    nativeBarcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
    return nativeBarcodeDetector;
  } catch {
    nativeBarcodeDetector = null;
    return null;
  }
}

function getStoredCameraId() {
  try {
    return localStorage.getItem("dinasty_scanner_camera_id") || null;
  } catch {
    return null;
  }
}

function saveStoredCameraId(cameraId) {
  try {
    if (cameraId) localStorage.setItem("dinasty_scanner_camera_id", cameraId);
  } catch {
    // ignore
  }
}

function formatCameraLabel(camera, index) {
  const label = (camera?.label || "").trim();
  if (!label) return `Kamera ${index + 1}`;
  return label;
}

function renderCameraSelector(cameras, activeId) {
  const wrap = document.getElementById("cameraSelectorWrap");
  const select = document.getElementById("cameraSelect");
  const switchBtn = document.getElementById("switchCameraBtn");
  if (!wrap || !select || !switchBtn) return;

  select.innerHTML = "";

  if (!cameras || cameras.length === 0) {
    wrap.classList.add("d-none");
    return;
  }

  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.id;
    option.textContent = formatCameraLabel(camera, index);
    select.appendChild(option);
  });

  if (activeId) select.value = activeId;
  wrap.classList.remove("d-none");
  switchBtn.disabled = cameras.length < 2;
}

function pickCameraByPreference(cameras, preferredCameraId) {
  if (!cameras || cameras.length === 0) return null;

  if (preferredCameraId) {
    const preferred = cameras.find((cam) => cam.id === preferredCameraId);
    if (preferred) return preferred;
  }

  const storedId = getStoredCameraId();
  if (storedId) {
    const stored = cameras.find((cam) => cam.id === storedId);
    if (stored) return stored;
  }

  return pickBestCamera(cameras) || cameras[0];
}

async function probeCameraQuality(cameraId) {
  let stream = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: cameraId },
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });

    const track = stream.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() || {};
    const settings = track?.getSettings?.() || {};

    const width = Number.isFinite(capabilities?.width?.max) ? capabilities.width.max : Number(settings.width || 0);
    const height = Number.isFinite(capabilities?.height?.max) ? capabilities.height.max : Number(settings.height || 0);
    const frameRate = Number.isFinite(capabilities?.frameRate?.max) ? capabilities.frameRate.max : Number(settings.frameRate || 0);

    let score = width * height + frameRate * 2000;
    if (capabilities?.zoom) score += 150000;
    if (capabilities?.focusMode) score += 100000;
    if (capabilities?.torch) score += 50000;

    return { cameraId, score };
  } catch {
    return { cameraId, score: 0 };
  } finally {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
}

async function pickBestCameraAsync(cameras, preferredCameraId = null) {
  if (!cameras || cameras.length === 0) return null;

  if (preferredCameraId) {
    const preferred = cameras.find((cam) => cam.id === preferredCameraId);
    if (preferred) return preferred;
  }

  const storedId = getStoredCameraId();
  if (storedId) {
    const stored = cameras.find((cam) => cam.id === storedId);
    if (stored) return stored;
  }

  const labelRanked = pickBestCamera(cameras);
  const candidates = cameras
    .map((camera) => ({ camera, labelScore: scoreCamera(camera, isMobileDevice()) }))
    .sort((a, b) => b.labelScore - a.labelScore)
    .slice(0, Math.min(3, cameras.length));

  const probed = await Promise.all(candidates.map((item) => probeCameraQuality(item.camera.id)));
  const bestProbe = probed.sort((a, b) => b.score - a.score)[0];
  if (bestProbe?.cameraId) {
    const camera = cameras.find((cam) => cam.id === bestProbe.cameraId);
    if (camera) return camera;
  }

  return labelRanked || cameras[0];
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function showStatus(message, type = "info") {
  const statusMsg = document.getElementById("statusMessage");
  if (statusMsg) statusMsg.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function setGuide(message, tone = "warning") {
  const guideEl = document.getElementById("scanGuide");
  if (!guideEl) return;
  const toneClass = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-warning";
  guideEl.className = `mt-2 small text-center ${toneClass}`;
  guideEl.textContent = message || "";
}

function showMiniQrGuideIntro() {
  setGuide("Mode mini QR aktif: posisikan QR di tengah, jaga kontras hitam-putih, lalu tahan 1-2 detik.", "warning");
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
    return { type: "Data tidak dikenal", hint: "QR terbaca, tetapi format datanya tidak standar.", isUrl: false };
  }
  if (isValidHttpUrl(payload)) {
    return { type: "URL Web", hint: "Link valid dan bisa dibuka di tab baru.", isUrl: true };
  }

  const normalized = payload.trim();
  const arKeywordRegex = /(ar|marker|target|card|unity|vuforia|model|anchor|scene)/i;
  const looksLikeToken = /^[A-Za-z0-9_\-:.|]{8,}$/;
  if (arKeywordRegex.test(normalized) || looksLikeToken.test(normalized)) {
    return { type: "ID/Token Aplikasi", hint: "Kemungkinan payload dipakai untuk sistem internal/AR.", isUrl: false };
  }

  return { type: "Teks/Data Biasa", hint: "QR berisi teks umum.", isUrl: false };
}

function renderPayloadInfo(payload) {
  const payloadTypeEl = document.getElementById("payloadType");
  const payloadHintEl = document.getElementById("payloadHint");
  const openLinkBtn = document.getElementById("openLinkBtn");
  const info = classifyPayload(payload);

  if (payloadTypeEl) payloadTypeEl.textContent = `Tipe: ${info.type}`;
  if (payloadHintEl) payloadHintEl.textContent = info.hint;
  if (openLinkBtn) {
    openLinkBtn.disabled = !info.isUrl;
    openLinkBtn.classList.toggle("d-none", !info.isUrl);
  }
}

function pickBestCamera(cameras) {
  const mobile = isMobileDevice();
  const scored = [...cameras].sort((a, b) => {
    const sa = scoreCamera(a, mobile);
    const sb = scoreCamera(b, mobile);
    return sb - sa;
  });
  return scored[0] || null;
}

function scoreCamera(camera, mobile) {
  const label = (camera?.label || "").toLowerCase();
  let score = 0;
  if (/back|rear|environment|belakang|world|main camera/.test(label)) score += 120;
  if (/main|primary|default|wide/.test(label)) score += 20;
  if (/front|selfie|user|depan/.test(label)) score -= 100;
  if (/virtual|obs|droidcam|epoccam/.test(label)) score -= 80;
  if (/4k|2160|1080|fhd/.test(label)) score += 20;
  if (mobile && /back|rear|environment|belakang/.test(label)) score += 30;
  return score;
}

function getActiveVideoElement() {
  return document.querySelector("#reader video");
}

function getSafeMaxZoom(capabilities) {
  const min = Number.isFinite(capabilities?.zoom?.min) ? capabilities.zoom.min : 1;
  const max = Number.isFinite(capabilities?.zoom?.max) ? capabilities.zoom.max : min;
  return max <= min ? min : min + (max - min) * 0.4;
}

function updateZoomDisplay() {
  const zoomDisplay = document.getElementById("zoomLevelDisplay");
  if (zoomDisplay) zoomDisplay.textContent = `${Math.round(currentZoomLevel * 100)}%`;
}

function setZoomControlsEnabled(enabled) {
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const zoomSlider = document.getElementById("zoomSlider");
  if (zoomInBtn) zoomInBtn.disabled = !enabled;
  if (zoomOutBtn) zoomOutBtn.disabled = !enabled;
  if (zoomSlider) zoomSlider.disabled = !enabled;
}

async function applyCameraEnhancements() {
  if (!html5Qr) return;
  try {
    const capabilities = html5Qr.getRunningTrackCapabilities?.();
    if (!capabilities) return;

    const advanced = [];
    if (Array.isArray(capabilities.focusMode)) {
      if (capabilities.focusMode.includes("continuous")) advanced.push({ focusMode: "continuous" });
      else if (capabilities.focusMode.includes("single-shot")) advanced.push({ focusMode: "single-shot" });
    }
    if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("continuous")) advanced.push({ exposureMode: "continuous" });
    if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" });
    if (capabilities.focusDistance && Number.isFinite(capabilities.focusDistance.min)) advanced.push({ focusDistance: capabilities.focusDistance.min });

    if (advanced.length > 0) await html5Qr.applyVideoConstraints({ advanced });

    if (capabilities.zoom) {
      currentZoomLevel = Number.isFinite(capabilities.zoom.min) ? capabilities.zoom.min : 1;
      updateZoomDisplay();
      setZoomControlsEnabled(true);
      if (scanMode === "mini") {
        const miniTarget = Math.min(getSafeMaxZoom(capabilities), currentZoomLevel + (getSafeMaxZoom(capabilities) - currentZoomLevel) * 0.25);
        try {
          await html5Qr.applyVideoConstraints({ advanced: [{ zoom: miniTarget }] });
          currentZoomLevel = miniTarget;
          updateZoomDisplay();
        } catch {
          // ignore
        }
      }
    } else {
      setZoomControlsEnabled(false);
    }
  } catch {
    setZoomControlsEnabled(false);
  }
}

async function applyZoomFraction(level) {
  if (!html5Qr) return;
  try {
    const capabilities = html5Qr.getRunningTrackCapabilities?.();
    if (!capabilities?.zoom) return;
    const min = Number.isFinite(capabilities.zoom.min) ? capabilities.zoom.min : 1;
    const max = getSafeMaxZoom(capabilities);
    if (max <= min) return;

    const target = Math.max(min, Math.min(max, min + (max - min) * level));
    await html5Qr.applyVideoConstraints({ advanced: [{ zoom: target }] });
    currentZoomLevel = target;
    updateZoomDisplay();
  } catch {}
}

async function increaseZoom() {
  if (!html5Qr) return;
  try {
    const capabilities = html5Qr.getRunningTrackCapabilities?.();
    if (!capabilities?.zoom) return;
    const min = Number.isFinite(capabilities.zoom.min) ? capabilities.zoom.min : 1;
    const max = getSafeMaxZoom(capabilities);
    const target = Math.min(max, currentZoomLevel + (max - min) * 0.08);
    await html5Qr.applyVideoConstraints({ advanced: [{ zoom: target }] });
    currentZoomLevel = target;
    updateZoomDisplay();
  } catch {}
}

async function decreaseZoom() {
  if (!html5Qr) return;
  try {
    const capabilities = html5Qr.getRunningTrackCapabilities?.();
    if (!capabilities?.zoom) return;
    const min = Number.isFinite(capabilities.zoom.min) ? capabilities.zoom.min : 1;
    const max = getSafeMaxZoom(capabilities);
    const target = Math.max(min, currentZoomLevel - (max - min) * 0.08);
    await html5Qr.applyVideoConstraints({ advanced: [{ zoom: target }] });
    currentZoomLevel = target;
    updateZoomDisplay();
  } catch {}
}

function toGrayscale(imageData, contrast = 1.0) {
  const out = new ImageData(imageData.width, imageData.height);
  const src = imageData.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const gray = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    const adjusted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    dst[i] = adjusted;
    dst[i + 1] = adjusted;
    dst[i + 2] = adjusted;
    dst[i + 3] = 255;
  }
  return out;
}

function toBinary(imageData, threshold) {
  const out = new ImageData(imageData.width, imageData.height);
  const src = imageData.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const value = src[i] > threshold ? 255 : 0;
    dst[i] = value;
    dst[i + 1] = value;
    dst[i + 2] = value;
    dst[i + 3] = 255;
  }
  return out;
}

function sharpen(imageData, amount = 0.85) {
  const w = imageData.width;
  const h = imageData.height;
  const src = imageData.data;
  const out = new ImageData(w, h);
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = src[i];
      const l = src[(y * w + Math.max(0, x - 1)) * 4];
      const r = src[(y * w + Math.min(w - 1, x + 1)) * 4];
      const t = src[(Math.max(0, y - 1) * w + x) * 4];
      const b = src[(Math.min(h - 1, y + 1) * w + x) * 4];
      const edge = c * 5 - l - r - t - b;
      const value = Math.max(0, Math.min(255, Math.round(c * (1 - amount) + edge * amount)));
      dst[i] = value;
      dst[i + 1] = value;
      dst[i + 2] = value;
      dst[i + 3] = 255;
    }
  }
  return out;
}

function decodeWithVariants(imageData, mode = "normal") {
  if (typeof jsQR === "undefined" || !imageData) return null;
  try {
    const raw = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
    if (raw) return raw;

    const gray = toGrayscale(imageData, 1.35);
    const grayHit = jsQR(gray.data, gray.width, gray.height, { inversionAttempts: "attemptBoth" });
    if (grayHit) return grayHit;

    if (mode === "fast") {
      const bw = toBinary(gray, 120);
      return jsQR(bw.data, bw.width, bw.height, { inversionAttempts: "attemptBoth" });
    }

    const sharp = sharpen(gray, 0.9);
    const sharpHit = jsQR(sharp.data, sharp.width, sharp.height, { inversionAttempts: "attemptBoth" });
    if (sharpHit) return sharpHit;

    for (const t of [70, 90, 110, 130, 150, 170]) {
      const bw = toBinary(gray, t);
      const bwHit = jsQR(bw.data, bw.width, bw.height, { inversionAttempts: "attemptBoth" });
      if (bwHit) return bwHit;

      const bws = toBinary(sharp, t);
      const bwsHit = jsQR(bws.data, bws.width, bws.height, { inversionAttempts: "attemptBoth" });
      if (bwsHit) return bwsHit;
    }

    return null;
  } catch {
    return null;
  }
}

async function detectWithNativeBarcodeDetector(videoEl) {
  const detector = initNativeBarcodeDetector();
  if (!detector || !videoEl || videoEl.readyState < 2) return null;
  if (nativeDetectBusy) return null;

  nativeDetectBusy = true;

  try {
    const results = await detector.detect(videoEl);
    if (Array.isArray(results) && results.length > 0) {
      return results[0].rawValue || null;
    }

    const vw = videoEl.videoWidth || 0;
    const vh = videoEl.videoHeight || 0;
    if (!vw || !vh) return null;

    const cropScale = scanMode === "mini" ? 0.3 : 0.5;
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = FALLBACK_UPSCALE_SIZE;
    cropCanvas.height = FALLBACK_UPSCALE_SIZE;
    const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
    if (!cropCtx) return null;
    cropCtx.imageSmoothingEnabled = false;

    const sw = Math.floor(vw * cropScale);
    const sh = Math.floor(vh * cropScale);
    const sx = Math.floor((vw - sw) / 2);
    const sy = Math.floor((vh - sh) / 2);
    cropCtx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);

    const cropResults = await detector.detect(cropCanvas);
    if (Array.isArray(cropResults) && cropResults.length > 0) {
      return cropResults[0].rawValue || null;
    }

    return null;
  } catch {
    return null;
  } finally {
    nativeDetectBusy = false;
  }
}

function detectMiniQrFromVideoFrame() {
  if (fallbackBusy || scannedResult || !html5Qr) return;
  fallbackBusy = true;

  try {
    const video = getActiveVideoElement();
    if (!video || video.readyState < 2) return;

    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) return;

    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = vw;
    srcCanvas.height = vh;
    const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) return;
    srcCtx.drawImage(video, 0, 0, vw, vh);

    // Native browser detector dulu; ini biasanya paling kuat untuk QR normal-kecil.
    // Kalau browser mendukung, kita prioritaskan ini.
    if (nativeBarcodeDetector) {
      detectWithNativeBarcodeDetector(video).then((nativeValue) => {
        if (nativeValue && !scannedResult) {
          handleScanSuccess(nativeValue, { source: "barcode-detector" });
        }
      });
      if (scanMode === "normal") return;
    }

    const up = document.createElement("canvas");
    const upscaleSize = scanMode === "mini" ? MINI_UPSCALE_SIZE : FALLBACK_UPSCALE_SIZE;
    up.width = upscaleSize;
    up.height = upscaleSize;
    const upCtx = up.getContext("2d", { willReadFrequently: true });
    if (!upCtx) return;
    upCtx.imageSmoothingEnabled = false;

    let hit = null;

    // Mode normal: cukup full-frame + center-crop ringan, jangan grid berat.
    if (scanMode === "normal") {
      hit = decodeWithVariants(srcCtx.getImageData(0, 0, vw, vh), "fast");
      if (!hit) {
        const scale = 0.52;
        const cw = Math.floor(vw * scale);
        const ch = Math.floor(vh * scale);
        const sx = Math.floor((vw - cw) / 2);
        const sy = Math.floor((vh - ch) / 2);
        upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, up.width, up.height);
        hit = decodeWithVariants(upCtx.getImageData(0, 0, up.width, up.height), "fast");
      }
    }

    // Mode mini: fase penuh lebih agresif.
    if (scanMode === "mini" && fallbackPhase === 0) {
      hit = decodeWithVariants(srcCtx.getImageData(0, 0, vw, vh), "fast");
    }

    // Phase 1: crop tengah (umumnya mini QR ada di sini)
    if (scanMode === "mini" && !hit && fallbackPhase === 1) {
      const scale = 0.38;
      const cw = Math.floor(vw * scale);
      const ch = Math.floor(vh * scale);
      const sx = Math.floor((vw - cw) / 2);
      const sy = Math.floor((vh - ch) / 2);
      upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, up.width, up.height);
      hit = decodeWithVariants(upCtx.getImageData(0, 0, up.width, up.height), "fast");
    }

    // Phase 2: 1 region grid per tick (bukan semua sekaligus, biar tidak lag)
    if (scanMode === "mini" && !hit && fallbackPhase === 2) {
      const region = FALLBACK_GRID[fallbackRegionCursor % FALLBACK_GRID.length];
      fallbackRegionCursor += 1;
      const cw = Math.floor(vw * 0.28);
      const ch = Math.floor(vh * 0.28);
      const sx = Math.max(0, Math.min(vw - cw, Math.floor(vw * region.x - cw / 2)));
      const sy = Math.max(0, Math.min(vh - ch, Math.floor(vh * region.y - ch / 2)));
      upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, up.width, up.height);
      hit = decodeWithVariants(upCtx.getImageData(0, 0, up.width, up.height), "fast");
    }

    if (scanMode === "mini") {
      fallbackPhase = (fallbackPhase + 1) % 3;
      miniAggressiveTick += 1;

      // Deep-pass berkala untuk QR sangat kecil: multi center-crop + decode penuh.
      if (!hit && miniAggressiveTick % MINI_DEEP_PASS_EVERY === 0) {
        for (const scale of MINI_CENTER_SCALES) {
          const cw = Math.floor(vw * scale);
          const ch = Math.floor(vh * scale);
          const sx = Math.floor((vw - cw) / 2);
          const sy = Math.floor((vh - ch) / 2);
          upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, up.width, up.height);

          // normal mode decode (lebih berat) sengaja dipanggil berkala saja.
          hit = decodeWithVariants(upCtx.getImageData(0, 0, up.width, up.height), "normal");
          if (hit) break;
        }
      }
    }

    if (hit?.data) {
      handleScanSuccess(hit.data, { source: "jsqr-fallback" });
      return;
    }

    const elapsed = scanStartedAt ? Math.floor((Date.now() - scanStartedAt) / 1000) : 0;
    if (elapsed > 10) setGuide("Belum terbaca. Coba dekatkan 2-3 cm, lalu geser sedikit menjauh sambil tetap di tengah.", "warning");
  } finally {
    fallbackBusy = false;
  }
}

function startFallbackLoop() {
  stopFallbackLoop();
  if (typeof jsQR === "undefined") return;
  const intervalMs = scanMode === "mini" ? FALLBACK_INTERVAL_MS : 1800;
  fallbackIntervalId = setInterval(detectMiniQrFromVideoFrame, intervalMs);
}

function stopFallbackLoop() {
  if (fallbackIntervalId) {
    clearInterval(fallbackIntervalId);
    fallbackIntervalId = null;
  }
}

async function stopScanner() {
  stopFallbackLoop();
  if (!html5Qr) return;

  try {
    const state = html5Qr.getState?.();
    if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
      await html5Qr.stop();
    }
  } catch {}

  try {
    await html5Qr.clear();
  } catch {}

  html5Qr = null;
}

async function startScanner(preferredCameraId = null) {
  if (typeof Html5Qrcode === "undefined") {
    showStatus("Library scanner gagal dimuat. Tutup tab lalu buka lagi.", "danger");
    return false;
  }

  try {
    initNativeBarcodeDetector();

    if (!html5Qr) {
      html5Qr = new Html5Qrcode("reader", { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    }

    const cameras = await Html5Qrcode.getCameras();
    availableCameras = Array.isArray(cameras) ? cameras : [];
    if (!availableCameras || availableCameras.length === 0) {
      showStatus("Kamera tidak ditemukan di perangkat ini.", "danger");
      return false;
    }

    const pickedCamera = await pickBestCameraAsync(availableCameras, preferredCameraId);
    const cameraId = pickedCamera?.id || availableCameras[0].id;
    selectedCameraId = cameraId;
    saveStoredCameraId(cameraId);
    renderCameraSelector(availableCameras, cameraId);

    const preset = getCurrentScanPreset();

    await html5Qr.start(
      cameraId,
      {
        fps: preset.fps,
        qrbox: preset.qrbox,
        aspectRatio: 1.3333333,
        disableFlip: true,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        videoConstraints: {
          facingMode: { ideal: "environment" },
          width: preset.width,
          height: preset.height,
        },
      },
      (decodedText, decodedResult) => {
        handleScanSuccess(decodedText, decodedResult || { source: "html5-qrcode" });
      },
      () => {},
    );

    scanStartedAt = Date.now();
    fallbackPhase = 0;
    fallbackRegionCursor = 0;
    miniAggressiveTick = 0;
    setActiveMode(scanMode);
    showMiniQrGuideIntro();
    showStatus("Scanner aktif. Arahkan kamera ke QR code.", "secondary");
    await applyCameraEnhancements();
    startFallbackLoop();
    return true;
  } catch (err) {
    console.error("Gagal memulai scanner:", err);
    showStatus("Gagal memulai kamera scanner. Coba refresh halaman.", "danger");
    return false;
  }
}

async function switchCamera(cameraId) {
  if (!cameraId) return;
  if (cameraId === selectedCameraId && html5Qr) return;

  showStatus("Mengganti kamera...", "secondary");
  const hadResult = !!scannedResult;
  if (hadResult) {
    const resultContainer = document.getElementById("resultContainer");
    if (resultContainer) resultContainer.classList.add("d-none");
    scannedResult = null;
  }

  await stopScanner();
  await startScanner(cameraId);
}

async function switchToNextCamera() {
  if (!availableCameras || availableCameras.length < 2) return;
  const currentIndex = availableCameras.findIndex((cam) => cam.id === selectedCameraId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % availableCameras.length;
  const nextCamera = availableCameras[nextIndex];
  if (!nextCamera) return;
  await switchCamera(nextCamera.id);
}

async function handleScanSuccess(decodedText, decodedResult) {
  if (!decodedText || scannedResult) return;

  scannedResult = decodedText;
  stopFallbackLoop();

  if (html5Qr) {
    try {
      html5Qr.pause(true);
    } catch {}
  }

  const resultContainer = document.getElementById("resultContainer");
  const resultText = document.getElementById("resultText");
  if (resultContainer) resultContainer.classList.remove("d-none");
  if (resultText) resultText.textContent = decodedText;

  renderPayloadInfo(decodedText);
  showStatus("✅ QR Code berhasil dibaca!", "success");
  setGuide("QR terdeteksi. Anda bisa buka link atau scan lagi.", "success");

  if (isValidHttpUrl(decodedText) && decodedResult) {
    setTimeout(() => {
      window.open(decodedText, "_blank");
    }, 700);
  }
}

function openLink() {
  if (!scannedResult) return;
  if (isValidHttpUrl(scannedResult)) {
    window.open(scannedResult, "_blank");
  } else {
    alert("QR ini bukan link web. Kemungkinan ID/token untuk aplikasi tertentu.");
  }
}

async function copyPayload() {
  if (!scannedResult) return;
  try {
    await navigator.clipboard.writeText(scannedResult);
    showStatus("Isi QR berhasil disalin.", "info");
  } catch {
    showStatus("⚠️ Tidak bisa menyalin otomatis. Silakan salin manual dari hasil scan.", "warning");
  }
}

async function resetScanner() {
  const resultContainer = document.getElementById("resultContainer");
  const payloadTypeEl = document.getElementById("payloadType");
  const payloadHintEl = document.getElementById("payloadHint");
  const resultText = document.getElementById("resultText");

  if (resultContainer) resultContainer.classList.add("d-none");
  if (payloadTypeEl) payloadTypeEl.textContent = "";
  if (payloadHintEl) payloadHintEl.textContent = "";
  if (resultText) resultText.textContent = "";

  scannedResult = null;
  scanStartedAt = Date.now();
  miniAggressiveTick = 0;
  showMiniQrGuideIntro();

  if (html5Qr) {
    try {
      html5Qr.resume();
      showStatus("Scanner aktif kembali.", "secondary");
      startFallbackLoop();
      return;
    } catch {}
  }

  await stopScanner();
  await startScanner();
}

function decodeQrFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            reject(new Error("Canvas context gagal dibuat"));
            return;
          }

          ctx.drawImage(img, 0, 0);
          let hit = decodeWithVariants(ctx.getImageData(0, 0, canvas.width, canvas.height));

          if (!hit) {
            for (const s of [0.85, 0.7, 0.55, 0.42, 0.3, 0.2]) {
              const cw = Math.floor(canvas.width * s);
              const ch = Math.floor(canvas.height * s);
              const sx = Math.floor((canvas.width - cw) / 2);
              const sy = Math.floor((canvas.height - ch) / 2);

              const up = document.createElement("canvas");
              up.width = 1200;
              up.height = 1200;
              const upCtx = up.getContext("2d", { willReadFrequently: true });
              if (!upCtx) continue;

              upCtx.imageSmoothingEnabled = false;
              upCtx.drawImage(canvas, sx, sy, cw, ch, 0, 0, up.width, up.height);
              hit = decodeWithVariants(upCtx.getImageData(0, 0, up.width, up.height));
              if (hit) break;
            }
          }

          if (hit?.data) resolve(hit.data);
          else reject(new Error("QR tidak ditemukan pada gambar"));
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = () => reject(new Error("File gambar tidak valid"));
      img.src = event.target?.result;
    };

    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.readAsDataURL(file);
  });
}

window.addEventListener("load", () => {
  const backBtn = document.getElementById("backBtn");
  const openLinkBtn = document.getElementById("openLinkBtn");
  const copyPayloadBtn = document.getElementById("copyPayloadBtn");
  const resetScannerBtn = document.getElementById("resetScannerBtn");
  const qrFileInput = document.getElementById("qrFileInput");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const zoomSlider = document.getElementById("zoomSlider");
  const cameraSelect = document.getElementById("cameraSelect");
  const switchCameraBtn = document.getElementById("switchCameraBtn");
  const normalModeBtn = document.getElementById("normalModeBtn");
  const miniModeBtn = document.getElementById("miniModeBtn");

  if (backBtn) backBtn.addEventListener("click", () => window.history.back());
  if (openLinkBtn) openLinkBtn.addEventListener("click", openLink);
  if (copyPayloadBtn) copyPayloadBtn.addEventListener("click", copyPayload);
  if (resetScannerBtn) resetScannerBtn.addEventListener("click", resetScanner);
  if (zoomInBtn) zoomInBtn.addEventListener("click", increaseZoom);
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", decreaseZoom);

  if (cameraSelect) {
    cameraSelect.addEventListener("change", async (e) => {
      const cameraId = e.target.value;
      await switchCamera(cameraId);
    });
  }

  if (switchCameraBtn) {
    switchCameraBtn.addEventListener("click", async () => {
      await switchToNextCamera();
      if (cameraSelect && selectedCameraId) cameraSelect.value = selectedCameraId;
    });
  }

  if (normalModeBtn) {
    normalModeBtn.addEventListener("click", async () => {
      if (scanMode === "normal") return;
      setActiveMode("normal");
      await resetScanner();
    });
  }

  if (miniModeBtn) {
    miniModeBtn.addEventListener("click", async () => {
      if (scanMode === "mini") return;
      setActiveMode("mini");
      await resetScanner();
    });
  }

  if (zoomSlider) {
    zoomSlider.addEventListener("input", async (e) => {
      const value = parseFloat(e.target.value || "0");
      await applyZoomFraction(value);
    });
  }

  if (qrFileInput) {
    qrFileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const fromFile = await decodeQrFromFile(file);
        await handleScanSuccess(fromFile, { source: "file-upload" });
      } catch {
        alert("Gagal membaca QR dari gambar. Pastikan gambar tajam, tidak blur, dan QR terlihat jelas.");
      } finally {
        qrFileInput.value = "";
      }
    });
  }

  setTimeout(() => {
    setActiveMode(scanMode);
    startScanner();
  }, 120);
});

window.addEventListener("beforeunload", async () => {
  await stopScanner();
});
