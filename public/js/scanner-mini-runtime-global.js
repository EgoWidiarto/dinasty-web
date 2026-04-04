const QrScanner = window.QrScanner;

if (!QrScanner) {
  throw new Error("QrScanner global tidak tersedia");
}

class DinastyMiniQrScanner {
  constructor() {
    this.readerEl = document.getElementById("reader");
    this.statusEl = document.getElementById("statusMessage");
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
    this.lastResult = "";
    this.lastResultAt = 0;

    this.bindEvents();
  }

  bindEvents() {
    this.backBtn?.addEventListener("click", () => {
      window.location.href = "index.html";
    });

    this.fileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await this.scanImageFile(file);
      e.target.value = "";
    });
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
    const side = Math.max(200, Math.round(Math.min(vw, vh) * 0.38));

    return {
      x: Math.round((vw - side) / 2),
      y: Math.round((vh - side) / 2),
      width: side,
      height: side,
      downScaledWidth: 1280,
      downScaledHeight: 1280,
    };
  }

  createScanner() {
    if (this.qrScanner) {
      this.qrScanner.destroy();
      this.qrScanner = null;
    }

    this.qrScanner = new QrScanner(this.video, (result) => this.onDecode(result), {
      preferredCamera: "environment",
      maxScansPerSecond: 35,
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

  async start() {
    try {
      this.setStatus("Menyiapkan kamera...", "info");

      if (this.qrScanner) this.qrScanner.stop();
      this.createScanner();

      const bestRearCameraId = await this.pickBestRearCameraId();
      if (bestRearCameraId) await this.qrScanner.start(bestRearCameraId);
      else await this.qrScanner.start();

      this.setStatus("Scanner mini siap. Arahkan QR kecil ke tengah.", "success");
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
  const app = new DinastyMiniQrScanner();
  app.start();
});
