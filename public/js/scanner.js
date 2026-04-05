/* global QrScanner */
let lastScannedValue = "";
let lastScanAt = 0;
let decodingBusy = false;

const statusEl = document.getElementById("statusMessage");
const cameraInfoEl = document.getElementById("cameraInfoMessage");
const capturePhotoBtn = document.getElementById("capturePhotoBtn");
const nativePhotoInput = document.getElementById("nativePhotoInput");
const backBtn = document.getElementById("backBtn");

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

  const qrEngine = window.QrScanner;
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

async function scanTinyQrFromNativePhoto(file) {
  if (!file || decodingBusy) return;
  if (!/^image\//i.test(file.type)) {
    setStatus("File bukan gambar.");
    return;
  }

  decodingBusy = true;
  setStatus("Memproses foto...");

  let bitmap = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
      setCameraInfo(`${bitmap.width}x${bitmap.height}`);
      const hit = await scanTinyQrFromImageSource(bitmap, bitmap.width, bitmap.height);
      if (hit?.data) {
        const qrUrl = hit.data;
        await logScannedUrl(qrUrl);
        setStatus(`QR terdeteksi: ${qrUrl}`);
        if (isLikelyUrl(qrUrl)) {
          setCameraInfo("Membuka link...");
          await new Promise((r) => setTimeout(r, 800));
          window.open(qrUrl, "_blank", "noopener,noreferrer");
          setStatus("Link dibuka. Ambil foto lagi untuk scan berikutnya.");
        }
      } else {
        setStatus("Tidak terbaca. Coba foto lebih terang & fokus.");
      }
      return;
    }

    const img = await loadImageElementFromBlob(file);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    setCameraInfo(`${width}x${height}`);
    const hit = await scanTinyQrFromImageSource(img, width, height);
    if (hit?.data) {
      const qrUrl = hit.data;
      await logScannedUrl(qrUrl);
      setStatus(`QR terdeteksi: ${qrUrl}`);
      if (isLikelyUrl(qrUrl)) {
        setCameraInfo("Membuka link...");
        await new Promise((r) => setTimeout(r, 800));
        window.open(qrUrl, "_blank", "noopener,noreferrer");
        setStatus("Link dibuka. Ambil foto lagi untuk scan berikutnya.");
      }
    } else {
      setStatus("Tidak terbaca. Coba foto lebih terang & fokus.");
    }
  } catch (err) {
    console.error(err);
    setStatus("Gagal memproses foto.");
  } finally {
    if (bitmap) bitmap.close();
    decodingBusy = false;
  }
}

function bindUi() {
  capturePhotoBtn?.addEventListener("click", () => {
    nativePhotoInput?.click();
  });

  nativePhotoInput?.addEventListener("change", async (event) => {
    const input = event.target;
    const file = input?.files?.[0];
    if (file) await scanTinyQrFromNativePhoto(file);
    if (input) input.value = "";
  });

  backBtn?.addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "/";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      decodingBusy = false;
    }
  });

  window.addEventListener("beforeunload", () => {
    decodingBusy = false;
  });
}

window.addEventListener("load", () => {
  bindUi();
  setStatus("Tekan tombol untuk ambil foto QR.");
});
