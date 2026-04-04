// Scanner berbasis ZXing (utama) + jsQR deep-pass (khusus Mini QR)
let zxingReader = null;
let zxingControls = null;
let activeVideoEl = null;
let scannedResult = null;
let selectedCameraId = null;
let cameras = [];
let scanMode = "normal"; // normal | mini
let miniPassIntervalId = null;
let currentZoom = 1;

function qs(id) {
  return document.getElementById(id);
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function setStatus(message, type = "secondary") {
  const el = qs("statusMessage");
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

function setGuide(message, tone = "warning") {
  const guideEl = qs("scanGuide");
  if (!guideEl) return;
  const toneClass = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-warning";
  guideEl.className = `mt-2 small text-center ${toneClass}`;
  guideEl.textContent = message || "";
}

function renderPayloadInfo(payload) {
  const payloadTypeEl = qs("payloadType");
  const payloadHintEl = qs("payloadHint");
  const openLinkBtn = qs("openLinkBtn");

  let type = "Teks/Data Biasa";
  let hint = "QR berisi teks umum.";
  let isUrl = false;

  if (!payload || typeof payload !== "string") {
    type = "Data tidak dikenal";
    hint = "QR terbaca tetapi format data tidak standar.";
  } else if (isValidHttpUrl(payload)) {
    type = "URL Web";
    hint = "Link valid dan bisa dibuka di tab baru.";
    isUrl = true;
  } else if (/(ar|marker|target|card|unity|vuforia|model|anchor|scene)/i.test(payload) || /^[A-Za-z0-9_\-:.|]{8,}$/.test(payload.trim())) {
    type = "ID/Token Aplikasi";
    hint = "Kemungkinan dipakai internal aplikasi AR.";
  }

  if (payloadTypeEl) payloadTypeEl.textContent = `Tipe: ${type}`;
  if (payloadHintEl) payloadHintEl.textContent = hint;
  if (openLinkBtn) {
    openLinkBtn.disabled = !isUrl;
    openLinkBtn.classList.toggle("d-none", !isUrl);
  }
}

function scoreCameraLabel(labelRaw) {
  const label = (labelRaw || "").toLowerCase();
  let score = 0;
  if (/back|rear|environment|belakang|world|main/.test(label)) score += 120;
  if (/front|selfie|user|depan/.test(label)) score -= 100;
  if (/wide|primary|default/.test(label)) score += 20;
  if (/virtual|obs|droidcam/.test(label)) score -= 80;
  if (/1080|4k|2160|fhd/.test(label)) score += 20;
  return score;
}

function pickDefaultCamera(devices) {
  if (!devices?.length) return null;
  const ranked = [...devices].sort((a, b) => scoreCameraLabel(b.label) - scoreCameraLabel(a.label));
  return ranked[0] || devices[0];
}

async function listVideoDevices() {
  try {
    const temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    temp.getTracks().forEach((t) => t.stop());
  } catch {
    // ignore, lanjut enumerate seadanya
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

function renderCameraSelector() {
  const wrap = qs("cameraSelectorWrap");
  const select = qs("cameraSelect");
  const switchBtn = qs("switchCameraBtn");
  if (!wrap || !select || !switchBtn) return;

  select.innerHTML = "";
  if (!cameras.length) {
    wrap.classList.add("d-none");
    return;
  }

  cameras.forEach((cam, i) => {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Kamera ${i + 1}`;
    select.appendChild(opt);
  });

  if (selectedCameraId) select.value = selectedCameraId;
  wrap.classList.remove("d-none");
  switchBtn.disabled = cameras.length < 2;
}

function updateModeButtons() {
  const normalBtn = qs("normalModeBtn");
  const miniBtn = qs("miniModeBtn");
  if (normalBtn) normalBtn.classList.toggle("active", scanMode === "normal");
  if (miniBtn) miniBtn.classList.toggle("active", scanMode === "mini");

  if (scanMode === "mini") {
    setGuide("Mode Mini QR aktif: deteksi lebih agresif untuk QR kecil.", "warning");
  } else {
    setGuide("Mode Normal aktif: stabil dan ringan untuk QR ukuran normal.", "success");
  }
}

async function stopMiniPass() {
  if (miniPassIntervalId) {
    clearInterval(miniPassIntervalId);
    miniPassIntervalId = null;
  }
}

function toGray(imageData) {
  const out = new ImageData(imageData.width, imageData.height);
  const src = imageData.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const g = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
    dst[i] = g;
    dst[i + 1] = g;
    dst[i + 2] = g;
    dst[i + 3] = 255;
  }
  return out;
}

function deepDecodeJsQr(imgData) {
  if (typeof jsQR === "undefined") return null;

  const raw = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "attemptBoth" });
  if (raw?.data) return raw.data;

  const gray = toGray(imgData);
  const hitGray = jsQR(gray.data, gray.width, gray.height, { inversionAttempts: "attemptBoth" });
  if (hitGray?.data) return hitGray.data;

  return null;
}

function startMiniPass() {
  stopMiniPass();
  if (scanMode !== "mini") return;

  miniPassIntervalId = setInterval(() => {
    if (scannedResult || !activeVideoEl || activeVideoEl.readyState < 2) return;

    const vw = activeVideoEl.videoWidth || 0;
    const vh = activeVideoEl.videoHeight || 0;
    if (!vw || !vh) return;

    const src = document.createElement("canvas");
    src.width = vw;
    src.height = vh;
    const sctx = src.getContext("2d", { willReadFrequently: true });
    if (!sctx) return;

    sctx.drawImage(activeVideoEl, 0, 0, vw, vh);

    const scales = [0.42, 0.34, 0.26, 0.2];
    for (const scale of scales) {
      const cw = Math.floor(vw * scale);
      const ch = Math.floor(vh * scale);
      const sx = Math.floor((vw - cw) / 2);
      const sy = Math.floor((vh - ch) / 2);

      const up = document.createElement("canvas");
      up.width = 1200;
      up.height = 1200;
      const uctx = up.getContext("2d", { willReadFrequently: true });
      if (!uctx) continue;
      uctx.imageSmoothingEnabled = false;
      uctx.drawImage(src, sx, sy, cw, ch, 0, 0, up.width, up.height);

      const decoded = deepDecodeJsQr(uctx.getImageData(0, 0, up.width, up.height));
      if (decoded) {
        handleScanSuccess(decoded, { source: "mini-jsqr" });
        return;
      }
    }
  }, 900);
}

async function stopScanner() {
  await stopMiniPass();

  if (zxingControls?.stop) {
    try {
      zxingControls.stop();
    } catch {
      // ignore
    }
  }

  zxingControls = null;
  zxingReader = null;
  activeVideoEl = null;
}

async function applyZoomPreset() {
  if (!activeVideoEl?.srcObject) return;
  const track = activeVideoEl.srcObject.getVideoTracks?.()[0];
  if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") return;

  try {
    const caps = track.getCapabilities();
    if (!caps?.zoom) return;

    const min = Number.isFinite(caps.zoom.min) ? caps.zoom.min : 1;
    const max = Number.isFinite(caps.zoom.max) ? caps.zoom.max : min;
    const target = scanMode === "mini" ? min + (max - min) * 0.45 : min + (max - min) * 0.18;

    await track.applyConstraints({ advanced: [{ zoom: target }] });
    currentZoom = target;
    const zoomDisplay = qs("zoomLevelDisplay");
    if (zoomDisplay) zoomDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
  } catch {
    // ignore
  }
}

async function startScanner() {
  if (typeof ZXingBrowser === "undefined") {
    setStatus("Library ZXing tidak termuat.", "danger");
    return;
  }

  await stopScanner();
  scannedResult = null;

  const readerEl = qs("reader");
  if (!readerEl) return;
  readerEl.innerHTML = "";

  const video = document.createElement("video");
  video.id = "zxingVideo";
  video.setAttribute("playsinline", "true");
  video.autoplay = true;
  video.muted = true;
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.objectFit = "cover";
  readerEl.appendChild(video);
  activeVideoEl = video;

  zxingReader = new ZXingBrowser.BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: scanMode === "mini" ? 25 : 80 });

  const targetCameraId = selectedCameraId || pickDefaultCamera(cameras)?.deviceId || undefined;
  selectedCameraId = targetCameraId;

  setStatus("Memulai scanner...", "secondary");

  try {
    zxingControls = await zxingReader.decodeFromVideoDevice(targetCameraId, video, (result) => {
      if (result) {
        const text = typeof result.getText === "function" ? result.getText() : String(result.text || "");
        if (text) handleScanSuccess(text, { source: "zxing" });
      }
    });

    await applyZoomPreset();
    startMiniPass();
    setStatus("Scanner aktif.", "secondary");
  } catch (e) {
    console.error(e);
    setStatus("Gagal memulai kamera scanner.", "danger");
  }
}

function handleScanSuccess(decodedText, decodedResult) {
  if (!decodedText || scannedResult) return;
  scannedResult = decodedText;

  stopMiniPass();
  if (zxingControls?.stop) {
    try {
      zxingControls.stop();
    } catch {
      // ignore
    }
  }

  const resultContainer = qs("resultContainer");
  const resultText = qs("resultText");
  if (resultContainer) resultContainer.classList.remove("d-none");
  if (resultText) resultText.textContent = decodedText;

  renderPayloadInfo(decodedText);
  setStatus("✅ QR Code berhasil dibaca!", "success");
  setGuide("QR terdeteksi. Anda bisa buka link atau scan lagi.", "success");

  if (isValidHttpUrl(decodedText) && decodedResult) {
    setTimeout(() => {
      window.open(decodedText, "_blank");
    }, 700);
  }
}

async function resetScanner() {
  const resultContainer = qs("resultContainer");
  const payloadTypeEl = qs("payloadType");
  const payloadHintEl = qs("payloadHint");
  const resultText = qs("resultText");

  if (resultContainer) resultContainer.classList.add("d-none");
  if (payloadTypeEl) payloadTypeEl.textContent = "";
  if (payloadHintEl) payloadHintEl.textContent = "";
  if (resultText) resultText.textContent = "";

  scannedResult = null;
  updateModeButtons();
  await startScanner();
}

function openLink() {
  if (!scannedResult) return;
  if (isValidHttpUrl(scannedResult)) {
    window.open(scannedResult, "_blank");
  } else {
    alert("QR ini bukan link web. Kemungkinan ID/token aplikasi tertentu.");
  }
}

async function copyPayload() {
  if (!scannedResult) return;
  try {
    await navigator.clipboard.writeText(scannedResult);
    setStatus("Isi QR berhasil disalin.", "info");
  } catch {
    setStatus("Tidak bisa menyalin otomatis.", "warning");
  }
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
          if (!ctx) return reject(new Error("Canvas error"));

          ctx.drawImage(img, 0, 0);
          const full = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let decoded = deepDecodeJsQr(full);
          if (decoded) return resolve(decoded);

          const scales = [0.85, 0.7, 0.55, 0.42, 0.3, 0.2];
          for (const s of scales) {
            const cw = Math.floor(canvas.width * s);
            const ch = Math.floor(canvas.height * s);
            const sx = Math.floor((canvas.width - cw) / 2);
            const sy = Math.floor((canvas.height - ch) / 2);

            const up = document.createElement("canvas");
            up.width = 1200;
            up.height = 1200;
            const uctx = up.getContext("2d", { willReadFrequently: true });
            if (!uctx) continue;
            uctx.imageSmoothingEnabled = false;
            uctx.drawImage(canvas, sx, sy, cw, ch, 0, 0, up.width, up.height);
            decoded = deepDecodeJsQr(uctx.getImageData(0, 0, up.width, up.height));
            if (decoded) return resolve(decoded);
          }

          reject(new Error("QR tidak ditemukan"));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("File gambar tidak valid"));
      img.src = event.target?.result;
    };
    reader.onerror = () => reject(new Error("Gagal baca file"));
    reader.readAsDataURL(file);
  });
}

window.addEventListener("load", async () => {
  const backBtn = qs("backBtn");
  const openLinkBtn = qs("openLinkBtn");
  const copyPayloadBtn = qs("copyPayloadBtn");
  const resetScannerBtn = qs("resetScannerBtn");
  const qrFileInput = qs("qrFileInput");
  const cameraSelect = qs("cameraSelect");
  const switchCameraBtn = qs("switchCameraBtn");
  const normalModeBtn = qs("normalModeBtn");
  const miniModeBtn = qs("miniModeBtn");

  cameras = await listVideoDevices();
  selectedCameraId = pickDefaultCamera(cameras)?.deviceId || null;
  renderCameraSelector();
  updateModeButtons();

  if (backBtn) backBtn.addEventListener("click", () => window.history.back());
  if (openLinkBtn) openLinkBtn.addEventListener("click", openLink);
  if (copyPayloadBtn) copyPayloadBtn.addEventListener("click", copyPayload);
  if (resetScannerBtn) resetScannerBtn.addEventListener("click", resetScanner);

  if (cameraSelect) {
    cameraSelect.addEventListener("change", async (e) => {
      selectedCameraId = e.target.value;
      await startScanner();
    });
  }

  if (switchCameraBtn) {
    switchCameraBtn.addEventListener("click", async () => {
      if (!cameras.length) return;
      const idx = cameras.findIndex((c) => c.deviceId === selectedCameraId);
      const next = cameras[(idx + 1 + cameras.length) % cameras.length];
      if (!next) return;
      selectedCameraId = next.deviceId;
      if (cameraSelect) cameraSelect.value = selectedCameraId;
      await startScanner();
    });
  }

  if (normalModeBtn) {
    normalModeBtn.addEventListener("click", async () => {
      if (scanMode === "normal") return;
      scanMode = "normal";
      updateModeButtons();
      await startScanner();
    });
  }

  if (miniModeBtn) {
    miniModeBtn.addEventListener("click", async () => {
      if (scanMode === "mini") return;
      scanMode = "mini";
      updateModeButtons();
      await startScanner();
    });
  }

  if (qrFileInput) {
    qrFileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await decodeQrFromFile(file);
        handleScanSuccess(text, { source: "file-upload" });
      } catch {
        alert("Gagal membaca QR dari gambar.");
      } finally {
        qrFileInput.value = "";
      }
    });
  }

  await startScanner();
});

window.addEventListener("beforeunload", async () => {
  await stopScanner();
});
