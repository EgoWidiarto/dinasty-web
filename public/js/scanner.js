// Scanner QR baru (clean rewrite) fokus mini QR
let html5Qr = null;
let scannedResult = null;
let fallbackIntervalId = null;
let fallbackBusy = false;
let currentZoomLevel = 1;
let scanStartedAt = 0;

const MINI_QR_CONFIG = {
  mobile: { fps: 14, qrbox: { width: 170, height: 170 }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1440, min: 720 } },
  desktop: { fps: 20, qrbox: { width: 220, height: 220 }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 } },
};

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

function decodeWithVariants(imageData) {
  if (typeof jsQR === "undefined" || !imageData) return null;
  try {
    const raw = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
    if (raw) return raw;

    const gray = toGrayscale(imageData, 1.35);
    const grayHit = jsQR(gray.data, gray.width, gray.height, { inversionAttempts: "attemptBoth" });
    if (grayHit) return grayHit;

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

    let hit = decodeWithVariants(srcCtx.getImageData(0, 0, vw, vh));

    if (!hit) {
      for (const s of [0.7, 0.55, 0.42, 0.32, 0.24, 0.18]) {
        const cw = Math.floor(vw * s);
        const ch = Math.floor(vh * s);
        const sx = Math.floor((vw - cw) / 2);
        const sy = Math.floor((vh - ch) / 2);

        const up = document.createElement("canvas");
        up.width = 1200;
        up.height = 1200;
        const upCtx = up.getContext("2d", { willReadFrequently: true });
        if (!upCtx) continue;
        upCtx.imageSmoothingEnabled = false;
        upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, up.width, up.height);
        hit = decodeWithVariants(upCtx.getImageData(0, 0, up.width, up.height));
        if (hit) break;
      }
    }

    if (!hit) {
      const regions = [
        { x: 0.18, y: 0.18 }, { x: 0.5, y: 0.18 }, { x: 0.82, y: 0.18 },
        { x: 0.18, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.82, y: 0.5 },
        { x: 0.18, y: 0.82 }, { x: 0.5, y: 0.82 }, { x: 0.82, y: 0.82 },
      ];
      for (const region of regions) {
        const cw = Math.floor(vw * 0.28);
        const ch = Math.floor(vh * 0.28);
        const sx = Math.max(0, Math.min(vw - cw, Math.floor(vw * region.x - cw / 2)));
        const sy = Math.max(0, Math.min(vh - ch, Math.floor(vh * region.y - ch / 2)));

        const up = document.createElement("canvas");
        up.width = 1000;
        up.height = 1000;
        const upCtx = up.getContext("2d", { willReadFrequently: true });
        if (!upCtx) continue;
        upCtx.imageSmoothingEnabled = false;
        upCtx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, up.width, up.height);
        hit = decodeWithVariants(upCtx.getImageData(0, 0, up.width, up.height));
        if (hit) break;
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
  fallbackIntervalId = setInterval(detectMiniQrFromVideoFrame, 420);
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

async function startScanner() {
  if (typeof Html5Qrcode === "undefined") {
    showStatus("Library scanner gagal dimuat. Tutup tab lalu buka lagi.", "danger");
    return false;
  }

  try {
    if (!html5Qr) {
      html5Qr = new Html5Qrcode("reader", { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] });
    }

    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      showStatus("Kamera tidak ditemukan di perangkat ini.", "danger");
      return false;
    }

    const best = pickBestCamera(cameras);
    const cameraId = best?.id || cameras[0].id;
    const preset = isMobileDevice() ? MINI_QR_CONFIG.mobile : MINI_QR_CONFIG.desktop;

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
  showStatus("âœ… QR Code berhasil dibaca!", "success");
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
    showStatus("í³‹ Isi QR berhasil disalin.", "info");
  } catch {
    showStatus("âš ï¸ Tidak bisa menyalin otomatis. Silakan salin manual dari hasil scan.", "warning");
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

  if (backBtn) backBtn.addEventListener("click", () => window.history.back());
  if (openLinkBtn) openLinkBtn.addEventListener("click", openLink);
  if (copyPayloadBtn) copyPayloadBtn.addEventListener("click", copyPayload);
  if (resetScannerBtn) resetScannerBtn.addEventListener("click", resetScanner);
  if (zoomInBtn) zoomInBtn.addEventListener("click", increaseZoom);
  if (zoomOutBtn) zoomOutBtn.addEventListener("click", decreaseZoom);

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
    startScanner();
  }, 120);
});

window.addEventListener("beforeunload", async () => {
  await stopScanner();
});
