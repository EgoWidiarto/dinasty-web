# 🚀 Deploy ke Render - Dinasty App

## 📋 Persiapan

### 1. Push Project ke GitHub

```bash
git init
git add .
git commit -m "Initial commit for Render deployment"
git branch -M main
git remote add origin https://github.com/username/dinasty.git
git push -u origin main
```

## 🌐 Deploy di Render

### 1. Buat Akun Render

- Kunjungi: https://render.com
- Sign up dengan GitHub (recommended)

### 2. Deploy Web Service

#### Cara Otomatis (Recommended):

1. Klik **"New +"** → **"Web Service"**
2. Connect repository GitHub kamu: **dinasty**
3. Render akan otomatis detect `render.yaml` ✅
4. Klik **"Apply"** atau **"Create Web Service"**

#### Cara Manual:

1. Klik **"New +"** → **"Web Service"**
2. Pilih repository **dinasty**
3. Isi konfigurasi:
   - **Name**: `dinasty-app` (atau nama lain)
   - **Region**: Singapore (terdekat)
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free

### 3. Setup Environment Variables

1. Scroll ke **"Environment Variables"**
2. Tambahkan:
   ```
   Key: GROQ_API_KEY
   Value: [paste API key Groq kamu]
   ```
3. Klik **"Add"**

### 4. Deploy

1. Klik **"Create Web Service"**
2. Tunggu ~3-5 menit untuk build pertama kali
3. URL app kamu akan muncul: `https://dinasty-app.onrender.com`

## ✅ Verifikasi Deployment

1. **Buka URL** yang diberikan Render
2. **Test features**:
   - Homepage loading ✓
   - ASK HISTORIA (chatbot) ✓
   - SCAN HISTORIA (QR scanner) ✓

## 🔧 Update/Redeploy

### Update Code:

```bash
git add .
git commit -m "Update features"
git push origin main
```

→ Render akan **auto-deploy** otomatis!

### Update Environment Variables:

1. Dashboard → **"Environment"** tab
2. Edit/tambah variables
3. Klik **"Save Changes"**
   → Auto-redeploy dalam 1-2 menit

## 📱 Aktifkan PWA (Progressive Web App)

Setelah deploy:

1. Buka app di **mobile browser**
2. Klik **"Add to Home Screen"**
3. Icon app akan muncul di home screen ✨

## ⚠️ Catatan Penting

### Free Tier Limits:

- ✅ 750 jam/bulan (cukup untuk 1 bulan penuh)
- ⚠️ **Sleep setelah 15 menit inaktif**
- ⚠️ **Cold start ~30 detik** saat pertama diakses
- ✅ Bandwidth: 100GB/bulan

### Tips Menghindari Sleep:

1. Gunakan **UptimeRobot** (gratis): ping app setiap 5 menit
2. Atau akses manual setiap beberapa jam

### Custom Domain (Optional):

1. Dashboard → **"Settings"** → **"Custom Domain"**
2. Tambahkan domain kamu (gratis SSL otomatis)

## 🆘 Troubleshooting

### App tidak jalan:

1. Cek **"Logs"** di dashboard Render
2. Pastikan `GROQ_API_KEY` sudah diset
3. Cek `package.json` → `"start": "node server.js"` ✓

### Chatbot error:

1. Verify API key Groq masih valid
2. Cek quota API Groq

### QR Scanner tidak jalan:

1. Pastikan akses HTTPS (Render otomatis provide)
2. Browser perlu permission camera

## 📞 Support

- Render Docs: https://render.com/docs
- Render Community: https://community.render.com

---

**Selamat! App kamu sudah live! 🎉**
