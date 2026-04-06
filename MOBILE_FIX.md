# 📱 Cara Mengatasi Tampilan Berantakan & Scanner Tidak Muncul

## ✅ Yang Sudah Diperbaiki:

1. **Auto-reload saat ada update** - Service worker sekarang otomatis reload page
2. **Cache control** - Meta tags untuk disable aggressive caching
3. **Scanner optimization untuk mobile** - Settings khusus untuk mobile devices
4. **Better error handling** - Camera permission dan initialization lebih robust

## 🔧 Cara Clear Cache di Mobile (Sekali Saja):

### Android Chrome:

1. Buka app di browser: `https://dinasti-web.vercel.app`
2. Tap **titik tiga (⋮)** di pojok kanan atas
3. Pilih **"Settings"** / **"Setelan"**
4. Pilih **"Site settings"** / **"Setelan situs"**
5. Pilih **"Storage"** / **"Penyimpanan"**
6. Tap **"Clear data"** / **"Hapus data"**
7. **Refresh** halaman (swipe down atau tap refresh)

### iOS Safari:

1. Buka **Settings** iOS
2. Scroll ke **"Safari"**
3. Tap **"Advanced"** / **"Lanjutan"**
4. Tap **"Website Data"** / **"Data Situs Web"**
5. Swipe left pada domain `vercel.app` → **Delete**
6. Kembali ke Safari dan refresh

### Cara Cepat (Semua Browser):

1. **Long press** pada tombol refresh browser
2. Pilih **"Hard Reload"** atau **"Empty Cache and Hard Reload"**

Atau:

1. Tutup **semua tab** app dinasti
2. Tutup browser sepenuhnya (dari recent apps)
3. Buka lagi browser
4. Buka app lagi

## 🎥 Untuk Scanner QR Code:

### Pertama Kali Buka:

1. Browser akan minta **camera permission**
2. Tap **"Allow"** / **"Izinkan"**
3. Jika tidak muncul popup:
   - Tap **ikon kunci** 🔒 di address bar
   - Tap **"Permissions"** / **"Izin"**
   - Set **Camera** → **Allow**
   - Refresh halaman

### Jika Camera Masih Tidak Muncul:

1. Buka **Settings** HP
2. Pilih **"Apps"** → **Browser yang dipakai** (Chrome/Safari)
3. Pilih **"Permissions"** / **"Izin"**
4. Set **Camera** → **Allow**
5. Kembali ke app dan refresh

## ⚡ Setelah Update Berikutnya:

**Tidak perlu hard refresh lagi!**

App sekarang akan **otomatis reload** dalam 30 detik setelah ada update baru yang di-deploy.

Jika masih ada tampilan lama:

- Tutup tab app
- Buka lagi
- App otomatis update ✅

## 🆘 Jika Masih Bermasalah:

1. **Uninstall PWA** (jika sudah install):
   - Long press icon app di home screen
   - Tap **"Uninstall"** / **"Remove"**
   - Install ulang dari browser

2. **Try Different Browser**:
   - Chrome (recommended)
   - Firefox
   - Edge
   - Safari (iOS)

## 📊 Cek Versi:

Untuk memastikan sudah dapat update terbaru:

1. Buka **Developer Console** (jika bisa)
2. Cek log: `✅ Cache opened` dengan versi `dinasti-v5`

---

**Update ini sudah live di Vercel!** 🚀

Tinggal clear cache sekali, selanjutnya otomatis update.
