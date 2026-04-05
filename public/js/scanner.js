/* global QrScanner */
let lastScannedValue = "";
let lastScanAt = 0;
let decodingBusy = false;
let liveScanner = null;
let liveRunning = false;

const statusEl = document.getElementById("statusMessage");
const cameraInfoEl = document.getElementById("cameraInfoMessage");
const backBtn = document.getElementById("backBtn");

const modeLiveBtn = document.getElementById("modeLiveBtn");
const modeNativeBtn = document.getElementById("modeNativeBtn");
const liveModePanel = document.getElementById("liveModePanel");
const nativeModePanel = document.getElementById("nativeModePanel");

const startLiveScanBtn = document.getElementById("startLiveScanBtn");
const stopLiveScanBtn = document.getElementById("stopLiveScanBtn");
const liveVideoEl = document.getElementById("qrVideo");

const capturePhotoBtn = document.getElementById("capturePhotoBtn");
const nativePhotoInput = document.getElementById("nativePhotoInput");

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function setCameraInfo(message) {
  if (cameraInfoEl) cameraInfoEl.textContent = message;
}

function isLikelyUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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

async function handleDetectedValue(value) {
  const text = typeof value === "string" ? value : value?.data;
  if (!text) return;

  const now = Date.now();
  if (text === lastScannedValue && now - lastScanAt < 1800) return;

  lastScannedValue = text;
  lastScanAt = now;

  await logScannedUrl(text);
  setStatus(`QR terdeteksi: ${text}`);

  if (isLikelyUrl(text)) {
    setCameraInfo("Membuka link...");
    if (liveRunning) await stopLiveScan();
    window.location.href = text;
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
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
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
      reject(new Error("Gagal memuat foto."));
    };
    img.src = url;
  });
}

async function scanTinyQrFromImageSource(source, width, height) {
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  const srcCtx = src.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) return null;

  srcCtx.imageSmoothingEnabled = false;
  srcCtx.drawImage(source, 0, 0, width, height);

  const tryScan = async (target) => {
    try {
      return await QrScanner.scanImage(target, {
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

  return null;
}

async function scanTinyQrFromNativePhoto(file) {
  if (!file || decodingBusy) return;
  if (!/^image\//i.test(file.type)) {
    setStatus("File bukan gambar.");
    return;
  }

  decodingBusy = true;
  setStatus("Memproses foto native...");

  let bitmap = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
      setCameraInfo(`Native: ${bitmap.width}x${bitmap.height}`);
      const hit = await scanTinyQrFromImageSource(bitmap, bitmap.width, bitmap.height);
      if (hit?.data) await handleDetectedValue(hit.data);
      else setStatus("Tidak terbaca. Coba foto lebih terang & fokus.");
      return;
    }

    const img = await loadImageElementFromBlob(file);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    setCameraInfo(`Native: ${width}x${height}`);
    const hit = await scanTinyQrFromImageSource(img, width, height);
    if (hit?.data) await handleDetectedValue(hit.data);
    else setStatus("Tidak terbaca. Coba foto lebih terang & fokus.");
  } catch (err) {
    console.error(err);
    setStatus("Gagal memproses foto.");
  } finally {
    if (bitmap) bitmap.close();
    decodingBusy = false;
  }
}

async function setupLiveScanner() {
  if (liveScanner || !liveVideoEl) return;
  liveScanner = new QrScanner(
    liveVideoEl,
    async (result) => {
      await handleDetectedValue(typeof result === "string" ? result : result?.data);
    },
    {
      preferredCamera: "environment",
      maxScansPerSecond: 10,
      returnDetailedScanResult: true,
      highlightScanRegion: true,
      highlightCodeOutline: true,
    },
  );

  if (typeof liveScanner.setInversionMode === "function") {
    liveScanner.setInversionMode("both");
  }
}

async function startLiveScan() {
  try {
    await setupLiveScanner();
    if (!liveScanner) return;
    await liveScanner.start();
    liveRunning = true;
    if (startLiveScanBtn) startLiveScanBtn.disabled = true;
    if (stopLiveScanBtn) stopLiveScanBtn.disabled = false;

    const track = liveVideoEl?.srcObject?.getVideoTracks?.()[0];
    const settings = track?.getSettings ? track.getSettings() : null;
    if (settings?.width && settings?.height) {
      setCameraInfo(`Live: ${settings.width}x${settings.height}`);
    }
    setStatus("Scan live aktif. Arahkan kamera ke QR.");
  } catch (err) {
    console.error(err);
    setStatus("Gagal memulai scan live. Cek izin kamera.");
  }
}

async function stopLiveScan() {
  if (!liveScanner || !liveRunning) return;
  try {
    await liveScanner.stop();
  } catch {
    // ignore
  }
  liveRunning = false;
  if (startLiveScanBtn) startLiveScanBtn.disabled = false;
  if (stopLiveScanBtn) stopLiveScanBtn.disabled = true;
}

async function switchMode(mode) {
  if (mode === "live") {
    nativeModePanel?.classList.add("d-none");
    liveModePanel?.classList.remove("d-none");
    modeLiveBtn?.classList.remove("btn-outline-light");
    modeLiveBtn?.classList.add("btn-primary");
    modeNativeBtn?.classList.remove("btn-primary");
    modeNativeBtn?.classList.add("btn-outline-light");
    setStatus("Mode live dipilih.");
    return;
  }

  await stopLiveScan();
  liveModePanel?.classList.add("d-none");
  nativeModePanel?.classList.remove("d-none");
  modeNativeBtn?.classList.remove("btn-outline-light");
  modeNativeBtn?.classList.add("btn-primary");
  modeLiveBtn?.classList.remove("btn-primary");
  modeLiveBtn?.classList.add("btn-outline-light");
  setStatus("Mode native dipilih. Ambil foto QR.");
}

function bindUi() {
  modeLiveBtn?.addEventListener("click", async () => {
    await switchMode("live");
  });

  modeNativeBtn?.addEventListener("click", async () => {
    await switchMode("native");
  });

  startLiveScanBtn?.addEventListener("click", startLiveScan);
  stopLiveScanBtn?.addEventListener("click", stopLiveScan);

  capturePhotoBtn?.addEventListener("click", () => {
    nativePhotoInput?.click();
  });

  nativePhotoInput?.addEventListener("change", async (event) => {
    const input = event.target;
    const file = input?.files?.[0];
    if (file) await scanTinyQrFromNativePhoto(file);
    if (input) input.value = "";
  });

  backBtn?.addEventListener("click", async () => {
    await stopLiveScan();
    if (window.history.length > 1) window.history.back();
    else window.location.href = "/";
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
      decodingBusy = false;
      await stopLiveScan();
    }
  });

  window.addEventListener("beforeunload", async () => {
    decodingBusy = false;
    await stopLiveScan();
  });
}

window.addEventListener("load", () => {
  bindUi();
  switchMode("native");
  setStatus("Pilih mode scan: live atau native camera.");
});
