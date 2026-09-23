# 📱 IT Asset Scanner - Build Guide (QR-Only, No ML Kit)

## 🎯 Tối ưu đã áp dụng

| Tối ưu | Trước | Sau |
|--------|-------|-----|
| Xóa `google_mlkit_barcode_scanning` | ~150-180MB | 0MB |
| Xóa `google_mlkit_commons` | ~5MB | 0MB |
| Chỉ hỗ trợ QR Code | Hỗ trợ tất cả barcode | Chỉ QR |
| **APK dự kiến** | **~200-260MB** | **~20-30MB** |

## 📦 Cách build APK

### Bước 1: Download và giải nén
```bash
# Download từ server (hoặc clone từ GitHub)
scp openclaw@100.86.164.103:/home/openclaw/collector/it-asset-scanner-qr-only.zip .
unzip it-asset-scanner-qr-only.zip
cd mobile-app
```

### Bước 2: Cài dependencies
```bash
flutter pub get
```

### Bước 3: Build APK release
```bash
flutter build apk --release --no-tree-shake-icons
```

### Bước 4: APK output
```
build/app/outputs/flutter-apk/app-release.apk
```

**Dự kiến size: ~20-30MB** (giảm 85-90% so với bản cũ!)

## 🔧 Build với split-per-abi (tối ưu hơn)

Nếu muốn APK nhỏ hơn nữa (~15-20MB):
```bash
flutter build apk --release --no-tree-shake-icons --split-per-abi
```

Sẽ tạo 3 file:
- `app-arm64-v8a-release.apk` (~15MB) - Cho Pixel 8
- `app-armeabi-v7a-release.apk` (~12MB) - Cho ARM 32-bit
- `app-x86_64-release.apk` (~15MB) - Cho emulator

## 📤 Upload lên GitHub Release

1. Vào: https://github.com/linhla-cmd/it-asset-scanner/releases/new
2. Tag: `v1.1.0`
3. Title: `IT Asset Scanner v1.1.0 - QR Only (No ML Kit)`
4. Upload: `build/app/outputs/flutter-apk/app-release.apk`

## 🧪 Test trên Pixel 8

```bash
# Cài APK
adb -s 100.76.97.48:5555 install app-release.apk

# Hoặc nếu đã cài trước đó
adb -s 100.76.97.48:5555 install -r app-release.apk
```

## ⚠️ Lưu ý quan trọng

- `mobile_scanner: ^5.2.3` đã tự xử lý QR scanning qua CameraX
- KHÔNG cần `google_mlkit_barcode_scanning` nữa
- Nếu build lỗi, chạy: `flutter clean && flutter pub get`
