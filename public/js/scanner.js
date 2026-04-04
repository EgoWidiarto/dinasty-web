(() => {
  "use strict";

  const readerEl = document.getElementById("reader");
  const statusEl = document.getElementById("statusMessage");
  const fileInputEl = document.getElementById("qrFileInput");
  const backBtnEl = document.getElementById("backBtn");

  const zoomInBtnEl = document.getElementById("zoomInBtn");
  const zoomOutBtnEl = document.getElementById("zoomOutBtn");
  const zoomSliderEl = document.getElementById("zoomSlider");
  const zoomLevelDisplayEl = document.getElementById("zoomLevelDisplay");
  const torchBtnEl = document.getElementById("torchBtn");

  if (!readerEl || !statusEl || !fileInputEl || !backBtnEl) return;

  let scanner = null;
  let handledResult = false;
  let lastScannedText = "";
  let torchOn = false;

  const videoEl = document.createElement("video");
  videoEl.setAttribute("playsinline", "true");
  videoEl.style.width = "100%";
  videoEl.style.height = "100%";
  videoEl.style.objectFit = "cover";
  videoEl.style.borderRadius = "1rem";

  readerEl.innerHTML = "";
  readerEl.appendChild(videoEl);

  const isValidHttpUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

  const setStatus = (message, type = "info") => {
    const map = {
      info: "text-warning",
      success: "text-success",
      error: "text-danger",
      muted: "text-secondary",
    };

    statusEl.className = `mt-4 text-center ${map[type] || map.info}`;
    statusEl.textContent = message;
  };

  const logScan = async (urlText) => {
    try {
      await fetch("/api/qr/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: urlText,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      // Non-blocking
    }
  };

  const showCopyButton = (text) => {
    const wrapper = document.createElement("div");
    wrapper.className = "mt-2";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn-warning btn-sm";
    copyBtn.textContent = "Salin Isi QR";

    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        setStatus("Isi QR berhasil disalin.", "success");
      } catch {
        setStatus("Gagal menyalin isi QR.", "error");
      }
    });

    wrapper.appendChild(copyBtn);
    statusEl.appendChild(document.createElement("br"));
    statusEl.appendChild(wrapper);
  };

  const handleDecodedText = async (decodedText, source = "camera") => {
    const rawText = (decodedText || "").trim();
    if (!rawText) return;

    if (rawText === lastScannedText && handledResult) return;

    handledResult = true;
    lastScannedText = rawText;

    await logScan(rawText);

    if (source === "camera" && scanner) {
      await scanner.stop().catch(() => {});
    }

    if (isValidHttpUrl(rawText)) {
      setStatus("QR berhasil dibaca. Membuka link...", "success");
      setTimeout(() => {
        window.location.href = rawText;
      }, 500);
      return;
    }

    setStatus(`QR terbaca: ${rawText}`, "success");
    showCopyButton(rawText);
  };

  const getVideoTrack = () => {
    const stream = videoEl.srcObject;
    if (!stream || typeof stream.getVideoTracks !== "function") return null;
    return stream.getVideoTracks()[0] || null;
  };

  const getTrackZoomRange = () => {
    const track = getVideoTrack();
    if (!track || typeof track.getCapabilities !== "function") return null;

    const caps = track.getCapabilities();
    const zoomCap = caps?.zoom;

    if (zoomCap === undefined) return null;

    if (typeof zoomCap === "number") {
      return { min: 1, max: zoomCap, step: 0.1 };
    }

    if (typeof zoomCap === "object") {
      return {
        min: Number.isFinite(zoomCap.min) ? zoomCap.min : 1,
        max: Number.isFinite(zoomCap.max) ? zoomCap.max : 1,
        step: Number.isFinite(zoomCap.step) && zoomCap.step > 0 ? zoomCap.step : 0.1,
      };
    }

    return null;
  };

  const getCurrentZoom = () => {
    const track = getVideoTrack();
    if (!track || typeof track.getSettings !== "function") return null;
    const settings = track.getSettings();
    return Number.isFinite(settings.zoom) ? settings.zoom : null;
  };

  const updateZoomUi = (currentZoom, range) => {
    if (!zoomSliderEl || !zoomLevelDisplayEl) return;
    if (!range) {
      zoomSliderEl.disabled = true;
      zoomInBtnEl && (zoomInBtnEl.disabled = true);
      zoomOutBtnEl && (zoomOutBtnEl.disabled = true);
      zoomLevelDisplayEl.textContent = "100%";
      return;
    }

    const clamped = Math.min(range.max, Math.max(range.min, currentZoom ?? range.min));
    const normalized = range.max === range.min ? 0 : ((clamped - range.min) / (range.max - range.min)) * 100;

    zoomSliderEl.disabled = false;
    zoomSliderEl.value = String(Math.round(normalized));
    zoomInBtnEl && (zoomInBtnEl.disabled = false);
    zoomOutBtnEl && (zoomOutBtnEl.disabled = false);

    const ratio = range.min > 0 ? clamped / range.min : clamped;
    zoomLevelDisplayEl.textContent = `${Math.round(ratio * 100)}%`;
  };

  const setZoom = async (normalizedValue) => {
    const range = getTrackZoomRange();
    if (!range) return;

    const value = Math.min(100, Math.max(0, normalizedValue));
    const targetZoom = range.min + ((range.max - range.min) * value) / 100;

    const track = getVideoTrack();
    if (!track || typeof track.applyConstraints !== "function") return;

    try {
      await track.applyConstraints({
        advanced: [{ zoom: targetZoom }],
      });
      updateZoomUi(getCurrentZoom(), range);
    } catch {
      // ignore unsupported zoom operations
    }
  };

  const changeZoomStep = async (direction) => {
    const range = getTrackZoomRange();
    if (!range) return;

    const current = getCurrentZoom() ?? range.min;
    const target = direction > 0 ? current + range.step * 4 : current - range.step * 4;
    const normalized = ((target - range.min) / (range.max - range.min || 1)) * 100;
    await setZoom(normalized);
  };

  const setupZoomControls = () => {
    if (!zoomSliderEl) return;

    zoomSliderEl.addEventListener("input", (event) => {
      const value = Number(event.target.value || 0);
      setZoom(value);
    });

    zoomInBtnEl?.addEventListener("click", () => {
      changeZoomStep(1);
    });

    zoomOutBtnEl?.addEventListener("click", () => {
      changeZoomStep(-1);
    });
  };

  const setupTorchButton = async () => {
    if (!torchBtnEl || !scanner) return;

    try {
      const hasFlash = await scanner.hasFlash();
      if (!hasFlash) {
        torchBtnEl.classList.add("d-none");
        return;
      }

      torchBtnEl.classList.remove("d-none");
      torchBtnEl.textContent = "Nyalakan Senter";

      torchBtnEl.addEventListener("click", async () => {
        try {
          torchOn = !torchOn;
          await scanner.toggleFlash();
          torchBtnEl.textContent = torchOn ? "Matikan Senter" : "Nyalakan Senter";
        } catch {
          setStatus("Senter tidak tersedia di perangkat ini.", "muted");
        }
      });
    } catch {
      torchBtnEl.classList.add("d-none");
    }
  };

  const setupPinchToZoom = () => {
    let startDistance = null;
    let startNormalizedZoom = null;

    const getTouchDistance = (touches) => {
      const [a, b] = touches;
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.hypot(dx, dy);
    };

    readerEl.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length !== 2) return;
        const range = getTrackZoomRange();
        if (!range) return;

        startDistance = getTouchDistance(event.touches);
        const currentZoom = getCurrentZoom() ?? range.min;
        startNormalizedZoom = ((currentZoom - range.min) / (range.max - range.min || 1)) * 100;
      },
      { passive: true },
    );

    readerEl.addEventListener(
      "touchmove",
      (event) => {
        if (event.touches.length !== 2 || startDistance === null || startNormalizedZoom === null) return;

        const currentDistance = getTouchDistance(event.touches);
        const delta = ((currentDistance - startDistance) / startDistance) * 100;
        const target = startNormalizedZoom + delta;
        setZoom(target);
      },
      { passive: true },
    );

    readerEl.addEventListener(
      "touchend",
      () => {
        startDistance = null;
        startNormalizedZoom = null;
      },
      { passive: true },
    );
  };

  const setupFileScan = () => {
    fileInputEl.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setStatus("Memproses gambar QR...", "info");

      try {
        const result = await QrScanner.scanImage(file, {
          returnDetailedScanResult: true,
          alsoTryWithoutScanRegion: true,
        });

        await handleDecodedText(result?.data || "", "file");
      } catch {
        setStatus("QR tidak ditemukan pada gambar. Coba foto lain yang lebih jelas.", "error");
        handledResult = false;
      } finally {
        fileInputEl.value = "";
      }
    });
  };

  const initScanner = async () => {
    if (typeof window.QrScanner === "undefined") {
      setStatus("Library scanner tidak berhasil dimuat.", "error");
      return;
    }

    setupZoomControls();
    setupPinchToZoom();
    setupFileScan();

    setStatus("Memulai kamera...", "info");

    scanner = new QrScanner(
      videoEl,
      (result) => {
        const data = typeof result === "string" ? result : result?.data;
        handleDecodedText(data, "camera");
      },
      {
        preferredCamera: "environment",
        maxScansPerSecond: 25,
        returnDetailedScanResult: true,
        highlightScanRegion: true,
        calculateScanRegion: (video) => {
          const minEdge = Math.min(video.videoWidth || 0, video.videoHeight || 0);
          const size = Math.max(180, Math.round(minEdge * 0.52));

          return {
            x: Math.round(((video.videoWidth || size) - size) / 2),
            y: Math.round(((video.videoHeight || size) - size) / 2),
            width: size,
            height: size,
            downScaledWidth: 640,
            downScaledHeight: 640,
          };
        },
      },
    );

    try {
      await scanner.start();
      handledResult = false;
      setStatus("Scanner aktif. Dekatkan kamera ke QR kecil di area kotak tengah.", "info");

      updateZoomUi(getCurrentZoom(), getTrackZoomRange());
      await setupTorchButton();
    } catch (error) {
      const message = String(error?.message || error || "").toLowerCase();

      if (message.includes("permission") || message.includes("denied") || message.includes("notallowed")) {
        setStatus("Izin kamera ditolak. Aktifkan izin kamera lalu muat ulang halaman.", "error");
        return;
      }

      if (message.includes("notfound") || message.includes("no camera")) {
        setStatus("Kamera tidak ditemukan di perangkat ini.", "error");
        return;
      }

      setStatus("Gagal memulai scanner. Coba refresh halaman.", "error");
    }
  };

  backBtnEl.addEventListener("click", () => {
    window.location.href = "/";
  });

  window.addEventListener("beforeunload", () => {
    if (scanner) {
      scanner.stop().catch(() => {});
      scanner.destroy();
    }
  });

  initScanner();
})();
