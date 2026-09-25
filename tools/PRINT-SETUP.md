# พิมพ์ใบเสร็จโดยไม่มีหน้าต่างพิมพ์เด้ง + เปิดลิ้นชักเก็บเงิน

คู่มือนี้ทำที่ **เครื่องหน้าร้าน** ใช้เวลาประมาณ 15 นาที **ไม่ต้องแก้โค้ดของระบบ POS เลย**
ทุกขั้นตอนย้อนกลับได้ ถ้าไม่ชอบก็เลิกได้ทันที

> ทำไมถึงเป็นวิธีนี้: ตอนนี้ใบเสร็จพิมพ์ภาษาไทยสวย เพราะ Chrome กับ Windows เป็นคนจัดสระ/วรรณยุกต์
> ให้แล้วส่งเป็นภาพเข้าไดรเวอร์เครื่องพิมพ์ — **เราจึงไม่ไปแตะวิธีพิมพ์ แก้แค่ให้มันไม่เด้งหน้าต่าง**
> ถ้าเปลี่ยนไปส่งคำสั่ง ESC/POS แบบตัวอักษร ภาษาไทยจะเสี่ยงสระลอย ซึ่งแก้ด้วยโค้ดไม่ได้

---

## ขั้นที่ 0 — เก็บหลักฐานว่าของเดิมพิมพ์ไทยสวย (ห้ามข้าม)

ก่อนเปลี่ยนอะไรทั้งสิ้น ให้ขายทดสอบ 1 บิลที่มีคำไทยยาก ๆ แล้ว **เก็บสลิปใบนั้นไว้**
เช่น `ปิ๊งซี่โครงหมู`, `น้ำแข็งใส่แก้ว`, `เสื้อผ้าสีน้ำเงิน`

สลิปใบนี้คือตัวเทียบ ถ้าหลังตั้งค่าแล้วภาษาไทยเพี้ยนไปจากใบนี้ **ให้หยุดทันที** แล้วรันไฟล์ยกเลิก

---

## ขั้นที่ 1 — เก็บข้อมูลเครื่อง

เปิด PowerShell ที่โฟลเดอร์ `tools` แล้วรัน:

```bash
powershell -ExecutionPolicy Bypass -File .\check-setup.ps1
```

สคริปต์นี้**อ่านอย่างเดียว ไม่แก้อะไรเลย** จะบอก:

| หัวข้อ | ใช้ทำอะไร |
|---|---|
| 1. PRINTERS | ชื่อเครื่องพิมพ์จริงที่ Windows ใช้ — ต้องเอาไปใส่ใน `open-drawer.ps1` |
| 2. DRIVER VERSION | ถ้า `MajorVersion` เป็น 4 ต้องส่งข้อมูลแบบ `XPS_PASS` (สคริปต์จัดการให้เอง) |
| 3. DEFAULT PRINTER | เครื่องพิมพ์ค่าเริ่มต้น + เตือนถ้า Windows ยังสลับเองอยู่ |
| 4. CHROME | เวอร์ชัน — ต้อง **144 ขึ้นไป** ถึงใช้แผน A ได้ |
| 5. POLICY | ตั้งค่าไปแล้วหรือยัง |
| 6. WINDOWS | รุ่นและสถาปัตยกรรม |

**ก๊อปผลทั้งหมดส่งกลับมาให้ผมดูได้** จะได้บอกได้ว่าเครื่องพิมพ์รุ่นนี้ต้องตั้งตรงไหน

---

## ขั้นที่ 2 — ตั้งเครื่องพิมพ์ความร้อนให้เป็นค่าเริ่มต้น

1. Settings → Bluetooth & devices → Printers & scanners
2. **ปิด** สวิตช์ "Let Windows manage my default printer" ← ห้ามลืม ไม่งั้น Windows จะสลับเครื่องพิมพ์เอง
3. คลิกเครื่องพิมพ์ความร้อน → **Set as default**
4. เข้า **Printer preferences** → ตั้งขนาดกระดาษเป็น **58mm หรือ 80mm** ให้เป็นค่าเริ่มต้น

   ข้อ 4 **ห้ามข้าม** — `@page { size: 58mm auto }` ใน `src/lib/receipt.ts` บอกแค่การจัดหน้า
   มันไม่ได้สั่งไดรเวอร์ให้เลือกกระดาษ ถ้าไม่ตั้ง จะได้ใบเสร็จย่อขนาด A4 ตัวหนังสือจิ๋ว

---

## ขั้นที่ 3 — เปิดโหมดพิมพ์เงียบ

คลิกขวาที่ `silent-print-on.reg` → **Run as administrator** → กด Yes

แล้ว **ปิด Chrome ให้หมดทุกหน้าต่าง** (รวมหน้าต่าง PWA ของ POS ด้วย) แล้วเปิดใหม่

ตรวจผล: พิมพ์ `chrome://policy` ที่แถบที่อยู่ → ต้องเห็น 3 บรรทัดนี้สถานะ **OK**

- `SilentPrintingEnabled` = true → พิมพ์ออกเลย ไม่เด้งหน้าต่าง
- `PrintPreviewUseSystemDefaultPrinter` = true → ยึดเครื่องพิมพ์เริ่มต้นของ Windows
- `PrintHeaderFooter` = false → ไม่พิมพ์ URL กับเลขหน้าลงบนสลิป

**ยกเลิก:** คลิกขวา `silent-print-off.reg` → Run as administrator → ปิด-เปิด Chrome ใหม่

> **ถ้า Chrome เก่ากว่า 144** ให้ใช้แผน B แทน: สร้าง shortcut ของ Chrome แล้วเติม
> `--kiosk-printing --user-data-dir=C:\POS-Profile --app=<URL ของ POS>`
> **ห้ามใส่ `--disable-print-preview`** เด็ดขาด — แฟล็กนั้นทำให้โหมดพิมพ์เงียบพัง
> (คู่มือเก่าบนเน็ตจำนวนมากแนะนำผิดข้อนี้)

---

## ขั้นที่ 4 — ทดสอบ

ขายทดสอบ 1 บิล แล้วเช็ค 2 อย่าง:

1. ☐ พิมพ์ออกโดย**ไม่มีหน้าต่างพิมพ์เด้ง**
2. ☐ **ภาษาไทยยังสวยเหมือนสลิปในขั้นที่ 0 เป๊ะ**

ถ้าข้อ 2 เพี้ยน → หยุด รันไฟล์ยกเลิก แล้วแจ้งผม

---

## ขั้นที่ 5 — ลิ้นชักเก็บเงิน

### ลองทางที่ไม่ต้องเขียนโค้ดก่อน

เข้า **Printer preferences** ของเครื่องพิมพ์ความร้อน แล้วหาเมนูตามยี่ห้อ:

| ยี่ห้อ | เส้นทาง |
|---|---|
| **Epson (APD)** | Preferences → แท็บ **Peripherals** → Cash Drawer → `Start/End of Document` → Cash Drawer #1 (2 Pins) = **Open**<br>(หรือแท็บ **Document Settings** → Cash Drawer = Open after Printing) |
| **Bixolon** | Preferences → แท็บ **Cut / Cash Drawer** → ติ๊ก **Open after printing #1** |
| **Star** (TSP100/143) | Printer **Properties** (ไม่ใช่ Preferences) → แท็บ **Device Settings** → Peripheral Unit Type = **Cash Drawer** → **Open Drawer 1** → **Set Default Options** |
| **XPrinter / POS-80 / POS-58 / Rongta / EPPOS** | **Print Settings** → **Basic Settings** → CashDrawer → **Open Drawer After Printing**<br>(ไดรเวอร์รุ่นเก่าอยู่ที่ **Paper/Quality** → **Media**) |

Apply → OK → สั่ง **Print Test Page** ถ้าลิ้นชักเด้ง = **จบ ไม่ต้องเขียนโค้ดเลย**

**ถ้าไม่เจอเมนูนี้** มักเป็นเพราะ Windows หาไดรเวอร์ generic มาให้เอง
ให้ถอนออกแล้วติดตั้งไดรเวอร์ตัวเต็มจากเว็บผู้ผลิตก่อน

> ข้อแลกของวิธีนี้: ลิ้นชักจะเด้ง **ทุกครั้งที่พิมพ์** รวมสลิปครัวและการพิมพ์ซ้ำ
> ถ้าอยากให้เด้งเฉพาะบิลเงินสด ต้องมีตัวช่วยฝั่งเครื่อง (คุยกันต่อได้)

### ถ้าไดรเวอร์ไม่มีเมนูลิ้นชัก — ใช้สคริปต์ทดสอบ

```bash
powershell -ExecutionPolicy Bypass -File .\open-drawer.ps1 -PrinterName "ชื่อจากข้อ 1"
```

สคริปต์ส่งคำสั่ง `ESC p` เข้าคิวพิมพ์เดิมของ Windows — **ไม่ต้องถอดไดรเวอร์**
เครื่องพิมพ์ยังพิมพ์ใบกำกับภาษี A4 ได้ตามปกติ

ถ้าขึ้น OK แต่ลิ้นชักไม่เด้ง ลองเรียงตามนี้:

```bash
powershell -ExecutionPolicy Bypass -File .\open-drawer.ps1 -PrinterName "ชื่อเครื่องพิมพ์" -Drawer2
```

```bash
powershell -ExecutionPolicy Bypass -File .\open-drawer.ps1 -PrinterName "ชื่อเครื่องพิมพ์" -Star
```

---

## ข้อจำกัดที่วิธีนี้แก้ไม่ได้

| เรื่อง | สถานะ |
|---|---|
| พิมพ์ไม่เด้งหน้าต่าง | ✅ ได้ |
| เปิดลิ้นชัก | ✅ ได้ (แต่เด้งทุกใบ ถ้าตั้งที่ไดรเวอร์) |
| สำรองข้อมูลอัตโนมัติไม่ต้องกดอนุญาต | ❌ **ยังไม่ได้** — เบราว์เซอร์บังคับให้มีการกดจากผู้ใช้ |
| แยกเครื่องพิมพ์สลิป 80mm กับ A4 | ❌ **ทำไม่ได้** — `window.print()` เลือกเครื่องพิมพ์ไม่ได้ และโหมดพิมพ์เงียบใช้เครื่องเริ่มต้นตัวเดียว |

2 ข้อล่างคือเหตุผลเดียวที่จะต้องทำแอป Electron หรือโปรแกรมช่วยฝั่งเครื่องในอนาคต
ถ้าร้านพิมพ์ใบกำกับภาษีเต็มรูปที่เครื่อง A4 คนละตัว ต้องคุยกันต่อ

---

## ที่มา

ตรวจจากซอร์สโค้ด Chromium และเอกสารทางการ (ส.ค. 2026)

- นโยบาย `SilentPrintingEnabled` — Chrome 144+, ยังไม่ deprecated
  <https://chromeenterprise.google/policies/silent-printing-enabled/>
- `DefaultPrinterSelection` — <https://chromeenterprise.google/policies/default-printer-selection/>
- Epson APD6 (แท็บ Peripherals / Cash Drawer)
  <https://files.support.epson.com/pdf/pos/bulk/apd6_printer_en_revc.pdf>
- ไดรเวอร์ v4 ส่ง RAW แล้วได้ไฟล์ 0 ไบต์ ต้องใช้ XPS_PASS
  <https://learn.microsoft.com/en-us/previous-versions/troubleshoot/windows/win32/v4-print-driver-raw-mode-pcl-postscript>
- ฟอนต์ไทยในตัวเครื่องมีเฉพาะ Epson TM รุ่น South Asia และ Star MC
  <https://github.com/receiptline/receiptline>
