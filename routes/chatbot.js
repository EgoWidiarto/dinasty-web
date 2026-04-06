const express = require("express");
const axios = require("axios");
const router = express.Router();

// Groq API Configuration
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Instruksi sistem untuk chatbot
const SYSTEM_PROMPT = `Anda adalah DINASTI, sebuah chatbot ahli yang hanya membantu menjawab pertanyaan tentang sejarah kerajaan-kerajaan di Indonesia dengan BAHASA YANG MUDAH DIPAHAMI ANAK SD-SMP.

Peran Anda:
- Menjawab pertanyaan tentang sejarah kerajaan-kerajaan di Indonesia dengan BAHASA SEDERHANA dan MUDAH DIPAHAMI
- Menggunakan kalimat pendek dan tidak berbelit-belit
- Menjelaskan dengan ANALOGI atau CONTOH NYATA yang relatable untuk anak-anak
- HINDARI jargon/istilah rumit, jika perlu jelaskan dengan bahasa yang lebih simple
- Menggunakan bahasa Indonesia yang santai dan ramah

Panduan Jawaban:
- KALIMAT PENDEK: 1-2 baris per kalimat
- MUDAH DIPAHAMI: Seolah menjelaskan ke teman sebaya
- CONTOH KONKRET: Gunakan analogi atau contoh yang dekat dengan kehidupan sehari-hari
- HINDARI JARGON: Jangan gunakan istilah akademis yang rumit
- INTERAKTIF: Tanyakan balik jika perlu atau ajak untuk lebih penasaran

Batasan:
- Hanya jawab pertanyaan yang berhubungan dengan sejarah kerajaan-kerajaan di Indonesia
- Jika ada pertanyaan di luar topik SEJARAH KERAJAAN INDONESIA:
  * Jawab SANGAT SINGKAT (1-2 kalimat saja, jangan panjang)
  * Jangan jelaskan detail
  * LANGSUNG arahkan user ke sejarah kerajaan Indonesia
  * Contoh: "Maaf, aku cuma ahli sejarah kerajaan Indonesia. Yuk tanya tentang Sriwijaya, Majapahit, Demak, atau kerajaan lain ya 😊"
- Jangan berikan informasi yang tidak akurat

Contoh Gaya Jawaban:
❌ HINDARI: "Rajendra Chola melakukan ekspansi hegemoni ke wilayah Sriwijaya pada abad ke-11..."
✅ GUNAKAN: "Hayam Wuruk adalah raja Majapahit yang terkenal. Di masanya, Majapahit menjadi sangat besar dan kuat. Seperti kapten tim yang pintar, dia bisa memimpin banyak orang dengan baik!"`;

const KINGDOM_HISTORY_KEYWORDS = [
  "kerajaan",
  "kerajaan indonesia",
  "sejarah kerajaan",
  "raja",
  "ratu",
  "sultan",
  "sriwijaya",
  "majapahit",
  "singhasari",
  "mataram",
  "mataram islam",
  "demak",
  "aceh",
  "banten",
  "pajajaran",
  "kediri",
  "kahuripan",
  "tarumanegara",
  "kalingga",
  "kutai",
  "gowa",
  "tallo",
  "ternate",
  "tidore",
  "cirebon",
  "bali",
  "hindu-buddha",
  "islam di jawa",
  "prasasti",
  "candi",
];

function isKingdomHistoryQuestion(message) {
  const normalizedMessage = message.toLowerCase();
  return KINGDOM_HISTORY_KEYWORDS.some((keyword) => normalizedMessage.includes(keyword));
}

function getRefusalMessage() {
  return "Maaf, aku cuma bisa menjawab pertanyaan tentang sejarah kerajaan Indonesia. Yuk tanya tentang Sriwijaya, Majapahit, Demak, Mataram, atau kerajaan lain ya 😊";
}

// Instruksi sistem untuk chatbot

// POST /api/chatbot/ask
router.post("/ask", async (req, res) => {
  try {
    const { message, onlyHistory } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "Pesan tidak boleh kosong",
      });
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!isKingdomHistoryQuestion(message)) {
      return res.json({
        success: true,
        response: getRefusalMessage(),
        message,
      });
    }

    if (!apiKey) {
      console.error("❌ GROQ_API_KEY tidak ditemukan");
      return res.status(500).json({
        success: false,
        error: "API Key belum dikonfigurasi. Hubungi administrator.",
      });
    }

    // Buat prompt dengan instruksi tambahan
    const systemMessage = `${SYSTEM_PROMPT}\n\n[HANYA JAWAB TENTANG SEJARAH KERAJAAN INDONESIA]\n[TOLAK PERTANYAAN DI LUAR TOPIK DENGAN JAWABAN SINGKAT]`;

    // Call Groq API (OpenAI-compatible)
    const groqResponse = await axios.post(
      GROQ_API_URL,
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: systemMessage,
          },
          {
            role: "user",
            content: message,
          },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    // Extract response text
    const responseText = groqResponse.data?.choices?.[0]?.message?.content;

    if (responseText) {
      return res.json({
        success: true,
        response: responseText,
        message: message,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: "Tidak ada respons dari AI",
      });
    }
  } catch (error) {
    console.error("API Error:", error.response?.data || error.message);

    // Check if error is API key related
    if (error.response?.status === 401 || error.response?.status === 403) {
      return res.status(500).json({
        success: false,
        error: "API Key tidak valid. Periksa konfigurasi.",
      });
    }

    return res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || "Terjadi kesalahan saat memproses respons",
    });
  }
});

module.exports = router;
