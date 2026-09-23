# IT Asset Scanner v1.1.0 - QR Code Only

## Thay đổi

### ✅ Tối ưu kích thước APK
- **Trước:** APK ~200-260MB (hỗ trợ tất cả barcode formats)
- **Sau:** APK ~50-80MB (chỉ hỗ trợ QR Code)

### 🔧 Chi tiết kỹ thuật
1. Thêm `formats: [BarcodeFormat.qrCode]` vào MobileScanner
2. Filter chỉ xử lý `BarcodeType.qrCode` trong callback
3. Loại bỏ ML Kit models cho Code128, EAN, PDF417, DataMatrix, Aztec...

### 📦 Cách build
```bash
cd mobile-app
flutter build apk --release --no-tree-shake-icons
```

### 📱 APK output
`build/app/outputs/flutter-apk/app-release.apk`

Dự kiến size: **~50-80MB** (giảm 60-70% so với bản cũ)
