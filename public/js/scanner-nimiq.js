import QrScanner from "https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner.min.js";

QrScanner.WORKER_PATH = "https://cdn.jsdelivr.net/npm/qr-scanner@1.4.2/qr-scanner-worker.min.js";

class DinastyMiniQrScanner {
  constructor() {
    this.readerEl = document.getElementById("reader");
    this.statusEl = document.getElementById("statusMessage");
    this.guideEl = document.getElementById("scanGuide");
    this.resultWrap = document.getElementById("resultContainer");
    this.resultText = document.getElementById("resultText");
    this.payloadType = document.getElementById("payloadType");
    this.payloadHint = document.getElementById("payloadHint");

    this.backBtn = document.getElementById("backBtn");
    this.openLinkBtn = document.getElementById("openLinkBtn");
    this.copyBtn = document.getElementById("copyPayloadBtn");
    this.resetBtn = document.getElementById("resetScannerBtn");
    this.fileInput = document.getElementById("qrFileInput");

    this.cameraSelectorWrap = document.getElementById("cameraSelectorWrap");
    this.cameraSelect = document.getElementById("cameraSelect");
    this.switchCameraBtn = document.getElementById("switchCameraBtn");

    this.normalModeBtn = document.getElementById("normalModeBtn");
    this.miniModeBtn = document.getElementById("miniModeBtn");

    this.zoomSlider = document.getElementById("zoomSlider");
    this.zoomInBtn = document.getElementById("zoomInBtn");
    this.zoomOutBtn = document.getElementById("zoomOutBtn");
    this.zoomLevelDisplay = document.getElementById("zoomLevelDisplay");

    this.video = document.createElement("video");
    this.video.setAttribute("playsinline", "true");
    this.video.setAttribute("muted", "true");
    this.video.style.width = "100%";
    this.video.style.height = "auto";
    this.video.style.display = "block";

    this.readerEl.innerHTML = "";
    this.readerEl.appendChild(this.video);

    this.qrScanner = null;
    this.cameras = [];
    this.currentCameraIdx = 0;

    this.scanMode = "mini";
    this.lastResult = "";
    this.lastResultAt = 0;

    this.zoomState = {
      min: 1,
      max: 1,
      step: 0.1,
      current: 1,
      supported: false,
    };

    this.bindEvents();
  }

  bindEvents() {
    this.backBtn?.addEventListener("click", () => {
      window.location.href = "index.html";
    });

    this.normalModeBtn?.addEventListener("click", () => this.setMode("normal"));
    this.miniModeBtn?.addEventListener("click", () => this.setMode("mini"));

    this.switchCameraBtn?.addEventListener("click", () => this.switchToNextCamera());
    this.cameraSelect?.addEventListener("change", async (e) => {
      const id = e.target.value;
      await this.useCameraById(id);
    });

    this.zoomInBtn?.addEventListener("click", () => this.adjustZoomBy(0.1));
    this.zoomOutBtn?.addEventListener("click", () => this.adjustZoomBy(-0.1));
    this.zoomSlider?.addEventListener("input", () => this.applyZoomFromSlider());

    this.openLinkBtn?.addEventListener("click", () => this.openIfUrl());
    this.copyBtn?.addEventListener("click", () => this.copyPayload());
    this.resetBtn?.addEventListener("click", () => this.resetForNextScan());

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

  setGuide(message) {
    if (this.guideEl) this.guideEl.textContent = message;
  }

  setMode(mode) {
    this.scanMode = mode === "normal" ? "normal" : "mini";

    this.normalModeBtn?.classList.toggle("active", this.scanMode === "normal");
    this.normalModeBtn?.classList.toggle("btn-outline-light", this.scanMode !== "normal");
    this.normalModeBtn?.classList.toggle("btn-light", this.scanMode === "normal");

    this.miniModeBtn?.classList.toggle("active", this.scanMode === "mini");
    this.miniModeBtn?.classList.toggle("btn-outline-warning", this.scanMode !== "mini");
    this.miniModeBtn?.classList.toggle("btn-warning", this.scanMode === "mini");

    if (this.scanMode === "mini") {
      this.setGuide("Mode Mini: fokuskan QR kecil di tengah kotak scanner, jarak 8–18 cm, naikkan zoom bila perlu.");
      this.setStatus("Mode Mini aktif. Mencari QR super kecil...", "warning");
      this.adjustZoomForMiniMode();
    } else {
      this.setGuide("Mode Normal: cocok untuk QR ukuran standar.");
      this.setStatus("Mode Normal aktif.", "info");
    }

    this.rebuildScanner();
  }

  getScanRegion() {
    const vw = this.video.videoWidth || 1280;
    const vh = this.video.videoHeight || 720;

    if (this.scanMode === "mini") {
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

    const side = Math.max(280, Math.round(Math.min(vw, vh) * 0.72));
    return {
      x: Math.round((vw - side) / 2),
      y: Math.round((vh - side) / 2),
      width: side,
      height: side,
      downScaledWidth: 960,
      downScaledHeight: 960,
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

  async start() {
    try {
      this.setStatus("Menyiapkan kamera...", "info");
      this.setGuide("Arahkan kamera ke QR dan usahakan stabil.");

      this.createScanner();
      await this.qrScanner.start();
      await this.loadCameraList();
      await this.setupZoomControl();

      this.setMode("mini");
      this.setStatus("Scanner siap. Sedang menunggu QR...", "success");
    } catch (err) {
      this.setStatus("Kamera gagal dibuka. Cek izin kamera browser.", "danger");
      console.error("Scanner start error:", err);
    }
  }

  async rebuildScanner() {
    if (!this.qrScanner) return;

    try {
      const cameraId = this.cameraSelect?.value || this.cameras[this.currentCameraIdx]?.id || null;
      this.createScanner();
      if (cameraId) {
        await this.qrScanner.start(cameraId);
      } else {
        await this.qrScanner.start();
      }
      await this.setupZoomControl();
    } catch (err) {
      console.error("Rebuild scanner failed:", err);
      this.setStatus("Gagal menerapkan mode scan.", "danger");
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

    this.showResult(data);
    this.setStatus("QR berhasil terdeteksi.", "success");

    if (this.qrScanner) this.qrScanner.stop();
  }

  classifyPayload(text) {
    const value = (text || "").trim();

    if (/^https?:\/\//i.test(value)) {
      return {
        type: "URL",
        hint: 'Klik "Buka Link" untuk menuju halaman tujuan.',
      };
    }

    if (/^WIFI:/i.test(value)) {
      return {
        type: "WiFi",
        hint: "Berisi konfigurasi jaringan WiFi.",
      };
    }

    if (/^(BEGIN:VCARD|MECARD:)/i.test(value)) {
      return {
        type: "Kontak",
        hint: "Berisi data kartu kontak.",
      };
    }

    if (/^mailto:/i.test(value)) {
      return {
        type: "Email",
        hint: "Berisi alamat email atau template email.",
      };
    }

    if (/^tel:/i.test(value)) {
      return {
        type: "Telepon",
        hint: "Berisi nomor telepon.",
      };
    }

    return {
      type: "Teks",
      hint: "Konten QR berupa teks biasa.",
    };
  }

  showResult(data) {
    const meta = this.classifyPayload(data);
    if (this.resultText) this.resultText.textContent = data;
    if (this.payloadType) this.payloadType.textContent = `Jenis: ${meta.type}`;
    if (this.payloadHint) this.payloadHint.textContent = meta.hint;
    this.resultWrap?.classList.remove("d-none");

    if (this.openLinkBtn) {
      this.openLinkBtn.style.display = /^https?:\/\//i.test(data) ? "block" : "none";
    }
  }

  async loadCameraList() {
    try {
      this.cameras = await QrScanner.listCameras(true);
      if (!Array.isArray(this.cameras) || this.cameras.length === 0) return;

      if (this.cameraSelect) {
        this.cameraSelect.innerHTML = "";

        this.cameras.forEach((cam, idx) => {
          const opt = document.createElement("option");
          opt.value = cam.id;
          opt.textContent = cam.label || `Kamera ${idx + 1}`;
          this.cameraSelect.appendChild(opt);
        });
      }

      const envIdx = this.cameras.findIndex((c) => /back|rear|environment|belakang/i.test(c.label || ""));
      this.currentCameraIdx = envIdx >= 0 ? envIdx : 0;

      if (this.cameraSelect && this.cameras[this.currentCameraIdx]) {
        this.cameraSelect.value = this.cameras[this.currentCameraIdx].id;
      }

      this.cameraSelectorWrap?.classList.remove("d-none");
    } catch (err) {
      console.warn("Camera list unavailable:", err);
    }
  }

  async useCameraById(cameraId) {
    if (!this.qrScanner || !cameraId) return;

    try {
      await this.qrScanner.setCamera(cameraId);
      const idx = this.cameras.findIndex((c) => c.id === cameraId);
      if (idx >= 0) this.currentCameraIdx = idx;
      await this.setupZoomControl();
      this.setStatus("Kamera berhasil diganti.", "success");
    } catch (err) {
      this.setStatus("Gagal ganti kamera.", "danger");
      console.error("Set camera error:", err);
    }
  }

  async switchToNextCamera() {
    if (!this.cameras.length) return;

    this.currentCameraIdx = (this.currentCameraIdx + 1) % this.cameras.length;
    const next = this.cameras[this.currentCameraIdx];
    if (this.cameraSelect) this.cameraSelect.value = next.id;
    await this.useCameraById(next.id);
  }

  getVideoTrack() {
    const stream = this.video?.srcObject;
    if (!(stream instanceof MediaStream)) return null;
    return stream.getVideoTracks?.()[0] || null;
  }

  async setupZoomControl() {
    const track = this.getVideoTrack();
    if (!track) {
      this.setZoomUiEnabled(false);
      return;
    }

    const caps = track.getCapabilities ? track.getCapabilities() : null;
    if (!caps?.zoom) {
      this.setZoomUiEnabled(false);
      return;
    }

    this.zoomState.supported = true;
    this.zoomState.min = caps.zoom.min ?? 1;
    this.zoomState.max = caps.zoom.max ?? 1;
    this.zoomState.step = caps.zoom.step ?? 0.1;

    const settings = track.getSettings ? track.getSettings() : {};
    this.zoomState.current = settings.zoom ?? this.zoomState.min;

    this.zoomSlider.min = String(this.zoomState.min);
    this.zoomSlider.max = String(this.zoomState.max);
    this.zoomSlider.step = String(this.zoomState.step);
    this.zoomSlider.value = String(this.zoomState.current);

    this.setZoomUiEnabled(true);
    this.updateZoomLabel();
  }

  setZoomUiEnabled(enabled) {
    [this.zoomSlider, this.zoomInBtn, this.zoomOutBtn].forEach((el) => {
      if (el) el.disabled = !enabled;
    });

    if (!enabled && this.zoomLevelDisplay) {
      this.zoomLevelDisplay.textContent = "N/A";
    }
  }

  updateZoomLabel() {
    if (!this.zoomLevelDisplay) return;

    if (!this.zoomState.supported) {
      this.zoomLevelDisplay.textContent = "N/A";
      return;
    }

    const min = this.zoomState.min || 1;
    const ratio = this.zoomState.current / min;
    this.zoomLevelDisplay.textContent = `${Math.round(ratio * 100)}%`;
  }

  clampZoom(value) {
    return Math.max(this.zoomState.min, Math.min(this.zoomState.max, value));
  }

  async applyZoom(value) {
    if (!this.zoomState.supported) return;

    const track = this.getVideoTrack();
    if (!track?.applyConstraints) return;

    const target = this.clampZoom(value);

    try {
      await track.applyConstraints({ advanced: [{ zoom: target }] });
      this.zoomState.current = target;
      if (this.zoomSlider) this.zoomSlider.value = String(target);
      this.updateZoomLabel();
    } catch (err) {
      console.warn("Zoom apply failed:", err);
    }
  }

  async adjustZoomBy(delta) {
    await this.applyZoom((this.zoomState.current || this.zoomState.min) + delta);
  }

  async applyZoomFromSlider() {
    const val = Number(this.zoomSlider?.value || this.zoomState.min);
    await this.applyZoom(val);
  }

  async adjustZoomForMiniMode() {
    if (!this.zoomState.supported) return;

    const suggested = this.zoomState.min + (this.zoomState.max - this.zoomState.min) * 0.35;
    if (this.zoomState.current < suggested) {
      await this.applyZoom(suggested);
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

      this.showResult(data);
      this.setStatus("QR dari gambar berhasil dibaca.", "success");
    } catch (err) {
      this.setStatus("QR pada gambar tidak terdeteksi.", "warning");
      console.warn("scanImage error:", err);
    }
  }

  async openIfUrl() {
    const value = (this.resultText?.textContent || "").trim();
    if (!/^https?:\/\//i.test(value)) return;

    try {
      window.open(value, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.warn("Open URL failed:", err);
    }
  }

  async copyPayload() {
    const value = (this.resultText?.textContent || "").trim();
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      this.setStatus("Isi QR disalin ke clipboard.", "success");
    } catch {
      this.setStatus("Gagal menyalin isi QR.", "warning");
    }
  }

  async resetForNextScan() {
    this.resultWrap?.classList.add("d-none");
    this.lastResult = "";
    this.lastResultAt = 0;

    if (!this.qrScanner) return;

    try {
      const cameraId = this.cameraSelect?.value || this.cameras[this.currentCameraIdx]?.id || null;
      if (cameraId) {
        await this.qrScanner.start(cameraId);
      } else {
        await this.qrScanner.start();
      }
      this.setStatus("Scanner aktif kembali. Siap scan.", "success");
    } catch (err) {
      this.setStatus("Gagal mengaktifkan ulang scanner.", "danger");
      console.error("Reset scanner error:", err);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const app = new DinastyMiniQrScanner();
  app.start();
});
