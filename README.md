# RoV (Arena of Valor) Pro Draft AI — SOTA GNN-Transformer

ระบบรวบรวมข้อมูลฮีโร่ครบ **130 ตัว (ถึงตัวล่าสุด Evita)**, สถิติการแข่งขันระดับอาชีพ **4,208 เกม (RPL, APL, AIC, AOG, GCS ปี 2024–2026)** และโมเดลระดับ State-of-the-Art (**`RoVDraftGNNTransformer`**) สำหรับทำนายลำดับการดราฟต์ (Next-Pick / Next-Ban) พร้อมประเมินโอกาสชนะ (`PredWin%`) ภายใต้กติกา **Global Ban Pick**

---

## โครงสร้างโปรเจกต์

* `data/heroes_130_full.json` & `data/heroes_130_summary.csv` — ข้อมูลฮีโร่ทั้ง 130 ตัว พร้อมรายละเอียดสกิลครบทุกสกิลและ Feature Flags 10 ด้าน
* `data/matches_draft_full.json` & `data/matches_draft_flat.csv` — ข้อมูลลำดับการแบน/เลือกทั้ง 4,208 เกม พร้อม Global Ban Pool ในแต่ละซีรีส์
* `data/hero_draft_stats.csv`, `data/synergy_matrix.csv`, `data/counter_matrix.csv` — ตารางสถิติการเล่นแยกตาม 5 เลนหลัก, คู่หู Synergy (2,605 คู่) และตัวแก้ทาง Counter (6,234 คู่)
* `src/train_sota_model.py` — โมเดล SOTA **`RoVDraftGNNTransformer`** (Multi-Relational Hero GNN + Multi-Head Draft Transformer + Dual Policy & Win-Value Heads)
* `src/predict_draft_cli.py` — ระบบจำลองและทำนายการดราฟต์ผ่าน CLI
* `src/api.py` — FastAPI (`/health`, `/heroes`, `/draft/steps`, `/predict`) และเสิร์ฟหน้าเว็บจาก `frontend/dist`
* `frontend/` — หน้าเว็บดราฟต์ (React + Vite + Tailwind) ธีมถ่ายทอดสด แสดงชื่อฮีโร่ตามเซิร์ฟไทย (เช่น Mortos, Celica, Riktor)
* `scripts/fetch_hero_icons.py` — ดาวน์โหลดไอคอนฮีโร่สี่เหลี่ยม 130 ตัวลง `frontend/public/avatars/`
* `data/items.json` — ไอเทม 114 ชิ้น (สเตตัสเป็นตัวเลข, ราคา, passive) จาก rovmeta.com แล้วแก้ทับด้วย `data/items_overrides.json` ที่อ้างอิง Patch Note ทางการ (rov.in.th) สร้างด้วย `python scripts/fetch_items.py`
* `run_sota_rov_h100.sbatch` — สคริปต์ SLURM สำหรับส่งงานเทรนสเกลใหญ่บนโหนดการ์ดจอ **NVIDIA H100 (`gpu-h100`)** ของ **ERAWAN HPC**

---

## วิธีรันบน ERAWAN HPC (NVIDIA H100)

```bash
git clone https://github.com/golfdesu/rov.git
cd rov
sbatch run_sota_rov_h100.sbatch
```

ดูผลลัพธ์ขณะรัน:
```bash
tail -f logs/rov_sota_h100_*.out
```

---

## วิธีเรียกใช้ทำนายการดราฟต์ (Inference CLI)

1. **รันตัวอย่างสถานการณ์ดราฟต์โปรลีก 4 รูปแบบ:**
```bash
python src/predict_draft_cli.py --demo
```

2. **กำหนดสถานการณ์ดราฟต์เอง:**
```bash
python src/predict_draft_cli.py \
  --mode pick \
  --side blue \
  --phase 1 \
  --ally-bans "Rouie,Eland'orr" \
  --enemy-bans "Valhein,Florentino" \
  --ally-picks "Skud,Billow" \
  --enemy-picks "TeeMee,Hayate" \
  --global-bans "Toro,Marja"
```

---

## วิธีเปิดหน้าเว็บดราฟต์ (Web UI)

```bash
cd frontend
npm install
npm run build
cd ..
uvicorn src.api:app --port 8000
```

แล้วเปิด http://localhost:8000

คีย์ลัด: `/` ค้นหาฮีโร่, `Enter` ล็อกตัวที่ AI แนะนำอันดับ 1, `Ctrl+Z` ย้อนกลับ

พัฒนาแบบ hot reload: รัน uvicorn ค้างไว้ แล้ว `cd frontend && npm run dev` เปิด http://localhost:3000

หรือรันผ่าน Docker (build หน้าเว็บให้อัตโนมัติ):
```bash
docker build -t rov-draft .
docker run -p 8000:8000 rov-draft
```
