# 🚀 Deploy ke Vercel - Dinasti App

## 📋 Langkah Deploy (Super Cepat!)

### 1. Push ke GitHub

```bash
git init
git add .
git commit -m "Deploy to Vercel"
git branch -M main
git remote add origin https://github.com/username/dinasti.git
git push -u origin main
```

### 2. Deploy di Vercel (Tanpa Credit Card! ✅)

#### Via Website (Paling Mudah):

1. Buka: **https://vercel.com**
2. Klik **"Sign Up"** dengan GitHub
3. Klik **"Add New Project"**
4. Import repository: **dinasti**
5. **Environment Variables** → Tambahkan:
   ```
   GROQ_API_KEY = your_groq_api_key_here
   ```
6. Klik \*\*"Deploy""
7. Tunggu 1-2 menit → **DONE!** 🎉

#### Via CLI (Alternatif):

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel

# Follow prompts:
# - Link to existing project? No
# - What's your project's name? dinasti
# - In which directory is your code located? ./
# - Want to override settings? No

# Production deploy
vercel --prod
```

## ⚙️ Setup Environment Variable

### Via Dashboard:

1. Buka project di **Vercel Dashboard**
2. **Settings** → **Environment Variables**
3. Tambahkan:
   - **Key**: `GROQ_API_KEY`
   - **Value**: `[paste API key dari file .env kamu]`
   - **Environments**: Production, Preview, Development (pilih semua)
4. Klik \*\*"Save""

### Via CLI:

```bash
vercel env add GROQ_API_KEY
# Paste API key saat diminta
# Pilih: Production, Preview, Development
```

## 🌐 URL Deployment

Setelah deploy, kamu akan dapat:

- **Production**: `https://dinasti.vercel.app`
- **Preview**: `https://dinasti-xxx.vercel.app` (setiap git push)

## 🔄 Auto-Deploy

✅ **Otomatis!** Setiap kali push ke GitHub:

```bash
git add .
git commit -m "Update features"
git push origin main
```

→ Vercel langsung auto-deploy dalam 1 menit!

## ✨ Kelebihan Vercel

- ✅ **Tidak butuh credit card**
- ✅ **Unlimited bandwidth & deployments**
- ✅ **No cold start** (always fast)
- ✅ **Global CDN** (super cepat di seluruh dunia)
- ✅ **Auto HTTPS** (SSL gratis)
- ✅ **Preview deployments** untuk setiap branch

## 📱 Aktifkan PWA

1. Buka app di mobile browser: `https://dinasti.vercel.app`
2. Klik **"Add to Home Screen"**
3. Icon muncul di home screen ✨

## 🎨 Custom Domain (Optional)

1. **Settings** → **Domains**
2. Tambahkan domain kamu
3. Update DNS sesuai instruksi
4. SSL otomatis aktif!

## ⚠️ Catatan Penting

### Vercel Free Tier:

- ✅ Unlimited bandwidth
- ✅ 100GB bandwidth/bulan
- ✅ No cold start
- ⚠️ **Serverless timeout: 10 detik** (cukup untuk chatbot)

### Jika Ada Error:

1. Cek **Vercel Dashboard** → **Deployments** → **Logs**
2. Pastikan `GROQ_API_KEY` sudah diset
3. Cek `vercel.json` sudah ada ✓

## 🆘 Troubleshooting

### Build Error:

```bash
# Test build lokal dulu
vercel build
```

### API Timeout:

- Groq API biasanya cepat (<5 detik)
- Jika timeout, coba optimize prompt

### Environment Variable Tidak Terbaca:

1. Cek di **Settings** → **Environment Variables**
2. Pastikan apply ke **Production**
3. Redeploy: **Deployments** → klik **"Redeploy"**

## 📞 Support

- Vercel Docs: https://vercel.com/docs
- Vercel Discord: https://vercel.com/discord

---

**App kamu live dalam 2 menit! 🚀**

**URL**: `https://dinasti.vercel.app`
