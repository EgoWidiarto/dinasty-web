const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const NO_STORE_CACHE = "no-store, no-cache, must-revalidate, proxy-revalidate";

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://api.groq.com", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      },
    },
  }),
);
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (req.path === "/sw.js" || req.path === "/" || req.path === "/chatbot" || req.path === "/scanner" || req.path.endsWith(".html")) {
    res.setHeader("Cache-Control", NO_STORE_CACHE);
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  if (req.path.includes("qr-scanner")) {
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    // Force plain JavaScript, not module/transpiled
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  }

  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/sw.js", (req, res) => {
  res.setHeader("Cache-Control", NO_STORE_CACHE);
  res.sendFile(path.join(__dirname, "public", "sw.js"));
});

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/chatbot", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chatbot.html"));
});

app.get("/scanner", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "scanner.html"));
});

app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// API Routes
const chatbotRoutes = require("./routes/chatbot");
const qrRoutes = require("./routes/qr");

app.use("/api/chatbot", chatbotRoutes);
app.use("/api/qr", qrRoutes);

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Terjadi kesalahan pada server" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});
