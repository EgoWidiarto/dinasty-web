const express = require("express");
const router = express.Router();

// Contoh data QR yang sudah dipindai (dalam praktik, ini bisa dari database)
const qrDatabase = {
  "https://example.com/sejarah-indonesia": {
    title: "Sejarah Indonesia",
    description: "Informasi lengkap tentang sejarah Indonesia",
  },
  "https://example.com/kemerdekaan": {
    title: "Proklamasi Kemerdekaan",
    description: "Peristiwa kemerdekaan Indonesia pada 17 Agustus 1945",
  },
};

// GET /api/qr/validate
router.get("/validate", (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "URL tidak ditemukan",
    });
  }

  // Check if URL is in database
  const qrInfo = qrDatabase[url];

  if (qrInfo) {
    return res.json({
      success: true,
      url: url,
      ...qrInfo,
    });
  }

  // Return generic response for unknown URLs
  return res.json({
    success: true,
    url: url,
    title: "Link Sejarah",
    description: "Link yang terbaca dari QR Code",
  });
});

// POST /api/qr/log
router.post("/log", (req, res) => {
  const { url, timestamp } = req.body;

  console.log(`📱 QR Code scanned: ${url} at ${timestamp}`);

  // Di sini bisa menyimpan ke database atau log file
  // const fs = require('fs');
  // fs.appendFileSync('qr-logs.txt', `${url} | ${timestamp}\n`);

  return res.json({
    success: true,
    message: "QR Code log tercatat",
  });
});

module.exports = router;
