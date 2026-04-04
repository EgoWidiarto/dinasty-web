let QrScanner = window.QrScanner;

async function ensureQrScannerLoaded() {
  if (window.QrScanner) {
    QrScanner = window.QrScanner;
    return QrScanner;
  }

  const candidates = ["https://unpkg.com/qr-scanner@1.4.2/qr-scanner.umd.min.js", "https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.umd.min.js"];

  for (const src of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Gagal memuat ${src}`));
        document.head.appendChild(script);
      });

      if (window.QrScanner) {
        QrScanner = window.QrScanner;
        return QrScanner;
      }
    } catch {
      // coba URL berikutnya
    }
  }

  throw new Error("QrScanner tidak tersedia. Gagal memuat library qr-scanner.");
}

class DinastyMiniQrScanner {
  constructor() {
    this.readerEl = document.getElementById("reader");
    this.statusEl = document.getElementById("statusMessage");
    this.guideEl = document.getElementById("scanGuide");
    this.normalModeBtn = document.getElementById("normalModeBtn");
    this.miniModeBtn = document.getElementById("miniModeBtn");
    this.fileInput = document.getElementById("qrFileInput");
    this.backBtn = document.getElementById("backBtn");

    this.video = document.createElement("video");
    this.video.setAttribute("playsinline", "true");
    this.video.setAttribute("muted", "true");
    this.video.style.width = "100%";
    this.video.style.height = "auto";
    this.video.style.display = "block";

    this.readerEl.innerHTML = "";
    this.readerEl.appendChild(this.video);

    this.qrScanner = null;
    this.scanMode = "mini";
    this.lastResult = "";
    this.lastResultAt = 0;

    this.bindEvents();
  }

  bindEvents() {
    this.backBtn?.addEventListener("click", () => {
      window.location.href = "index.html";
    });

    this.normalModeBtn?.addEventListener("click", () => this.setMode("normal"));
    this.miniModeBtn?.addEventListener("click", () => this.setMode("mini"));

    this.fileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await this.scanImageFile(file);
      e.target.value = "";
    });
  }

  setGuide(message) {
    if (this.guideEl) this.guideEl.textContent = message;
  }

  syncModeButtons() {
    const isMini = this.scanMode === "mini";

    this.normalModeBtn?.classList.toggle("active", !isMini);
    this.normalModeBtn?.classList.toggle("btn-light", !isMini);
    this.normalModeBtn?.classList.toggle("btn-outline-light", isMini);

    this.miniModeBtn?.classList.toggle("active", isMini);
    this.miniModeBtn?.classList.toggle("btn-warning", isMini);
    this.miniModeBtn?.classList.toggle("btn-outline-warning", !isMini);
  }

  async setMode(mode) {
    const nextMode = mode === "normal" ? "normal" : "mini";
    if (this.scanMode === nextMode) return;

    this.scanMode = nextMode;
    this.syncModeButtons();

    if (this.scanMode === "mini") {
      this.setGuide("Mode Mini aktif: fokuskan QR kecil di tengah.");
    } else {
      this.setGuide("Mode Normal aktif: cocok untuk QR ukuran standar.");
    }

    await this.start();
  }

  setStatus(message, type = "info") {
    if (!this.statusEl) return;
    const color =
      {
        info: "text-info",
        success: "text-success",
        warning: "text-warning",
        danger: "text-danger",
      }[type] || "text-info";

    this.statusEl.className = `mt-4 text-center ${color}`;
    this.statusEl.textContent = message;
  }

  getScanRegion() {
    const vw = this.video.videoWidth || 1280;
    const vh = this.video.videoHeight || 720;

    const ratio = this.scanMode === "mini" ? 0.38 : 0.72;
    const minSide = this.scanMode === "mini" ? 200 : 280;
    const side = Math.max(minSide, Math.round(Math.min(vw, vh) * ratio));
    return {
      x: Math.round((vw - side) / 2),
      y: Math.round((vh - side) / 2),
      width: side,
      height: side,
      downScaledWidth: this.scanMode === "mini" ? 1280 : 960,
      downScaledHeight: this.scanMode === "mini" ? 1280 : 960,
    };
  }

  createScanner() {
    if (this.qrScanner) {
      this.qrScanner.destroy();
      this.qrScanner = null;
    }

    this.qrScanner = new QrScanner(this.video, (result) => this.onDecode(result), {
      preferredCamera: "environment",
      maxScansPerSecond: this.scanMode === "mini" ? 35 : 22,
      returnDetailedScanResult: true,
      calculateScanRegion: () => this.getScanRegion(),
      highlightScanRegion: true,
      highlightCodeOutline: true,
    });
  }

  async pickBestRearCameraId() {
    try {
      const cameras = await QrScanner.listCameras(true);
      if (!Array.isArray(cameras) || cameras.length === 0) return null;

      const score = (labelRaw) => {
        const label = (labelRaw || "").toLowerCase();
        let s = 0;

        if (/back|rear|environment|belakang/.test(label)) s += 100;
        if (/main|utama|primary/.test(label)) s += 120;
        if (/tele|zoom/.test(label)) s += 20;
        if (/wide|ultra|macro|depth|tof|iris|front|selfie/.test(label)) s -= 220;

        return s;
      };

      const sorted = [...cameras].sort((a, b) => score(b.label) - score(a.label));
      return sorted[0]?.id || null;
    } catch {
      return null;
    }
  }

  async applyCameraQualityConstraints() {
    const stream = this.video?.srcObject;
    if (!(stream instanceof MediaStream)) return;

    const track = stream.getVideoTracks?.()[0];
    if (!track?.applyConstraints) return;

    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const advanced = [];

    if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      advanced.push({ focusMode: "continuous" });
    }

    try {
      await track.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
        advanced,
      });
    } catch {
      try {
        await track.applyConstraints({
          width: { ideal: 1280 },
          height: { ideal: 720 },
          advanced,
        });
      } catch {
        // abaikan jika perangkat membatasi constraints
      }
    }
  }

  async start() {
    try {
      this.setStatus("Menyiapkan kamera...", "info");
      this.syncModeButtons();

      if (this.qrScanner) {
        this.qrScanner.stop();
      }
      this.createScanner();
      const bestRearCameraId = await this.pickBestRearCameraId();
      if (bestRearCameraId) {
        await this.qrScanner.start(bestRearCameraId);
      } else {
        await this.qrScanner.start();
      }

      await this.applyCameraQualityConstraints();

      if (this.scanMode === "mini") {
        this.setGuide("Mode Mini aktif: fokuskan QR kecil di tengah.");
      } else {
        this.setGuide("Mode Normal aktif: cocok untuk QR ukuran standar.");
      }

      this.setStatus("Scanner siap. Arahkan ke QR Code...", "success");
    } catch (err) {
      this.setStatus("Kamera gagal dibuka. Cek izin kamera browser.", "danger");
      console.error("Scanner start error:", err);
    }
  }

  normalizeResultData(result) {
    if (!result) return "";
    if (typeof result === "string") return result.trim();
    if (typeof result?.data === "string") return result.data.trim();
    return "";
  }

  onDecode(result) {
    const data = this.normalizeResultData(result);
    if (!data) return;

    const now = Date.now();
    if (this.lastResult === data && now - this.lastResultAt < 1500) return;

    this.lastResult = data;
    this.lastResultAt = now;

    if (this.qrScanner) this.qrScanner.stop();

    if (/^https?:\/\//i.test(data)) {
      window.open(data, "_blank", "noopener,noreferrer");
    } else {
      this.setStatus(`QR terdeteksi: ${data}`, "success");
    }
  }

  async scanImageFile(file) {
    try {
      this.setStatus("Memproses gambar...", "info");
      const result = await QrScanner.scanImage(file, {
        returnDetailedScanResult: true,
        alsoTryWithoutScanRegion: true,
      });

      const data = this.normalizeResultData(result);
      if (!data) throw new Error("Data QR kosong");

      if (/^https?:\/\//i.test(data)) {
        window.open(data, "_blank", "noopener,noreferrer");
      } else {
        this.setStatus(`QR dari gambar: ${data}`, "success");
      }
    } catch (err) {
      this.setStatus("QR pada gambar tidak terdeteksi.", "warning");
      console.warn("scanImage error:", err);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  ensureQrScannerLoaded()
    .then(() => {
      QrScanner.WORKER_PATH = "https://unpkg.com/qr-scanner@1.4.2/qr-scanner-worker.min.js";
      const app = new DinastyMiniQrScanner();
      app.start();
    })
    .catch((err) => {
      console.error(err);
      const statusEl = document.getElementById("statusMessage");
      if (statusEl) {
        statusEl.className = "mt-4 text-center text-danger";
        statusEl.textContent = "Library scanner gagal dimuat. Coba refresh halaman (Ctrl+F5).";
      }
    });
});
