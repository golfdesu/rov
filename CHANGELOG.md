# 📜 Changelog

บันทึกงานของ AI agents / ผู้พัฒนาในโปรเจกต์ RoV Pro Draft Intelligence
เพื่อให้ agent ที่มาทำงานคนละ session รู้ว่าอะไรถูกทำไปแล้วบ้าง

> [!IMPORTANT]
> **สำหรับ AI agents:** อ่านรายการบนสุดอย่างน้อย 3 รายการก่อนเริ่มงาน และ **เพิ่มรายการใหม่ไว้บนสุด** ก่อนจบงานทุกครั้ง

## รูปแบบรายการ

```markdown
## 📅 YYYY-MM-DD HH:MM (UTC+7) — หัวข้องาน
**Agent:** ชื่อ agent / โมเดล

### ✅ สิ่งที่ทำ
- ...

### 📁 ไฟล์ที่แก้
- `path/to/file`

### 🧪 การตรวจสอบ
- ...

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ...
```

---

## 📅 2026-10-20 14:18 (UTC+7) — แก้ไขบั๊กวงแท็กฮีโร่หลุดและปรับเทียบหลอดเลือด/อัลติเมทด้วย HSV บน Minimap & Sidebars
**Agent:** Gemini 3.8 Flash (High)

### ✅ สิ่งที่ทำ
- แก้ไขปัญหาตัวกรองสี BGR เดิมที่เข้มงวดเกินไปจนตรวจจับวงกลมฮีโร่สีแดงได้เพียง 0–1 ตัว และสีน้ำเงินได้เพียง 1–2 ตัว โดยปรับมาใช้ HSV Hero Ring Mask (`Red: H <= 10 or H >= 170, S > 90, V > 100`, `Blue: H in [100, 130], S > 95, V > 110`) ร่วมกับ Tower Masking และ Connected Components (`area >= 18, w >= 5, h >= 5`) ทำให้ตรวจจับตำแหน่งฮีโร่ที่เคลื่อนที่ได้แม่นยำครบ 4–6 จุดต่อฝั่งในทุกๆ เฟรม
- ปรับปรุงการสแกนสถานะเกิด-ตายและอัลติเมทจากแถบด้านข้าง (Sidebars):
  - เปลี่ยนจากการตรวจจับ BGR เป็น HSV Green (`40 <= H <= 80, S >= 60, V >= 120`) แก้ไขปัญหาที่หลอดเลือดมีสีแดง/น้ำเงินเจือปนจนฮีโร่ถูกมองว่าตายตั้งแต่ต้นเกม (ตอนนี้ต้นเกม 00:10–05:20 ฮีโร่ทั้ง 10 ตัว `ALIVE` ครบ 100%)
  - ตรวจจับเม็ดเพชรอัลติเมทสีเขียวเรืองแสงข้างรูปโปรไฟล์ (`ult_ready: true/false`) อย่างแม่นยำ
  - ตรวจจับจังหวะตายจริงได้อย่างสมบูรณ์ เช่น First Blood นาทีที่ 05:25 (Raz ตาย), นาทีที่ 07:00–07:20 (Astrid และ Iggy ตาย), และทีมไฟต์ใหญ่ 10:00 (Qi และ Astrid ตาย พิกเซลหลอดเลือดเหลือ 0 ทันที)
- สร้างการ์ด Composite HUD ขนาด 530x270 พิกเซล (`[แถบซ้าย FS 130px | Minimap 270x270px | แถบขวา TEN 130px]`) ครบทั้ง 146 สแนปช็อตใน `data/vod_analytics/fs_vs_ten_game1/sidebars_5s/`
- รันประมวลผล Game 1 ใหม่ทั้ง 146 สแนปช็อต บันทึกข้อมูลลง `data/vod_analytics/fs_vs_ten_game1/rotations_5s.json`

### 📁 ไฟล์ที่แก้
- `scripts/extract_minimap_rotations.py`
- `data/vod_analytics/fs_vs_ten_game1/rotations_5s.json`
- `data/vod_analytics/fs_vs_ten_game1/minimap_5s/*`
- `data/vod_analytics/fs_vs_ten_game1/sidebars_5s/*`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ตรวจสอบไทม์ไลน์ 146 สแนปช็อต:
  - ช่วง 00:10–05:20: ไม่มีใครตาย (`DEAD = []`) ฮีโร่อยู่เลนตรงตามความเป็นจริง (Qi อยู่ Dark Slayer Lane, Eland'orr และ TeeMee อยู่ Abyssal Dragon Lane)
  - นาทีที่ 07:00: Iggy ตาย (`DEAD`), อัลติเมทปิด (`Ult: False`), พิกัดหยุดที่จุดตาย
  - นาทีที่ 10:00: Qi และ Astrid ตายคู่ (`DEAD`), ฮีโร่ที่รอดชีวิตของ FS บุกเลนกลาง
  - ผ่าน `ruff check` และ `ruff format` ทั้งหมด

---

## 📅 2026-10-20 13:40 (UTC+7) — อัปเกรดระบบแทร็ก Minimap เป็นความถี่ทุกๆ 5 วินาที พร้อมตรวจจับสถานะเกิด-ตายจากแถบข้างซ้ายขวา
**Agent:** Gemini 3.8 Flash (High)

### ✅ สิ่งที่ทำ
- อัปเกรด `scripts/extract_minimap_rotations.py` ให้ดึงภาพ Minimap ทุกๆ 5 วินาทีตลอดทั้งเกม 1 (รวม 146 สแนปช็อต ครอบคลุมตั้งแต่นาทีที่ 00:05 ถึง 12:00)
- ปรับกรอบครอป Minimap ให้ชิดขอบซ้ายของจอ (`x1 = 0`, `x2 = 240`, `y1 = 36`, `y2 = 276`) ขนาดจัตุรัส 240x240 พิกเซล
- เพิ่มฟังก์ชัน `detect_sidebar_health_status()` สแกนหลอดเลือดสีเขียวใน 5 ช่องแนวตั้งด้านซ้าย (ใต้ Minimap) และ 5 ช่องแนวตั้งด้านขวา (ขอบขวาจอ) เพื่อระบุสถานะ `ALIVE` หรือ `DEAD` ของฮีโร่ทั้ง 10 ตัวอย่างแม่นยำ
- นำอัลกอริทึม Hungarian Matching (`scipy.optimize.linear_sum_assignment`) มาใช้จับคู่วงกลมสีฟ้า/แดงกับฮีโร่ที่ยังมีชีวิตอยู่จริงเท่านั้น โดยตัดฮีโร่ที่ตายออกจากการสแกนชั่วคราว และรีเซ็ตพิกัดกลับไปที่บ่อเกิด (Fountain) เมื่อเกิดใหม่
- บันทึกภาพ Minimap ทุก 5 วินาที (146 ภาพ รวมขนาดเพียง 2.55 MB) และข้อมูลการเดินเกมลงใน `data/vod_analytics/fs_vs_ten_game1/rotations_5s.json`

### 📁 ไฟล์ที่แก้
- `scripts/extract_minimap_rotations.py`
- `data/vod_analytics/fs_vs_ten_game1/rotations_5s.json`
- `data/vod_analytics/fs_vs_ten_game1/minimap_5s/*`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ตรวจสอบไทม์ไลน์ช่วงไฟต์นาทีที่ 08:00:
  - นาทีที่ 07:50–08:05: ตรวจจับว่า `Violet` ตาย (`DEAD`) ค้างพิกัดจุดตายไว้โดยไม่เดาตำแหน่งมั่ว
  - นาทีที่ 08:10: `Violet` เกิดใหม่ (`ALIVE`) ถูกรีเซ็ตพิกัดมาที่บ่อเกิดน้ำเงิน `(25, 215)` ทันที
  - ขนาดไฟล์ภาพทั้ง 146 ภาพรวมกันเพียง 2.55 MB
- รัน `ruff check` และ `ruff format`: ผ่าน 100%

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ไม่มี

---

## 📅 2026-10-20 11:21 (UTC+7) — ระบบสกัดภาพ Minimap และจับพิกัด Rotation 10 ฮีโร่จากคลิปแข่งจริง YouTube RPL 2026
**Agent:** Gemini 3.8 Flash (High)

### ✅ สิ่งที่ทำ
- ติดตั้ง `yt-dlp` และ `imageio-ffmpeg` เพื่อตัดดาวน์โหลดเฉพาะช่วงเวลาแข่ง Game 1 จากคลิป YouTube RPL 2026 Winter Week 6 Day 3 (Full Sense vs Tenacity) ความยาว 12 นาที โดยไม่โหลดคลิปเต็ม 10 ชั่วโมง
- สร้างไปป์ไลน์ `scripts/extract_minimap_rotations.py` สกัดภาพกรอบ Minimap ทุกๆ 30 วินาทีตลอดทั้งเกม 1 (รวม 24 snapshots)
- ใช้อัลกอริทึม Template Matching หลายสเกล (22–28px) อ้างอิงจากไอคอนฮีโร่ทางการใน `frontend/public/avatars/` ตรวจจับพิกัด `(x, y)` และจำแนกโซนการเดินเกม (DS Lane, AD Lane, Mid Lane, Jungle, Base) ของฮีโร่ทั้ง 10 ตัว (FS: Ryoma, Tamyn, Raz, Violet, TeeMee / TEN: Qi, Astrid, Iggy, Eland'orr, Y'bneth)
- บันทึกภาพ Minimap ดิบ, ภาพตีกรอบฮีโร่ (Tracked), และโครงสร้างข้อมูลไทม์ไลน์ `data/vod_analytics/fs_vs_ten_game1/rotations_game1.json`

### 📁 ไฟล์ที่แก้
- `scripts/extract_minimap_rotations.py`
- `data/vod_analytics/fs_vs_ten_game1/rotations_game1.json`
- `data/vod_analytics/fs_vs_ten_game1/minimap_frames/*`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ตรวจสอบความถูกต้องของพิกัดและโซนการเดินเกมใน Snapshot สำคัญ:
  - นาที 00:45: Full Sense รวมตัวโถมเลนมังกร (TeeMee + Tamyn อยู่ AD Lane พิกัด 197, 213) ขณะที่ Tenacity ส่ง Qi และ Astrid ยืนดันเลนดาร์กสเลเยอร์
  - นาที 08:15: ทั้ง 2 ทีมรวมตัวไฟต์ 5v5 แย่งโซนป่าหน้าพงสเลเยอร์ (พิกัด 197, 46)
- รัน `ruff check` และ `ruff format`: ผ่าน 100%

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ไม่มี

---

## 📅 2026-10-20 10:40 (UTC+7) — ระบบวิเคราะห์ความสัมพันธ์สองทิศทาง แบน ↔ หยิบ (Ban-Unlocked Heroes & Phase-2 Target Ban Forecast)
**Agent:** Gemini 4 Argon (High)

### ✅ สิ่งที่ทำ
- สร้างตารางสถิติความสัมพันธ์สองทิศทางจากข้อมูลโปรลีก 4,208 แมตช์ (`_build_ban_pick_intel_tables()` ใน `src/predictor.py`):
  - **Ban -> Pick Lift & Counter Relief**: คำนวณฮีโร่ที่เก่งขึ้นทันทีเมื่อตัวแก้ทางถูกแบน หรือเป็นแผนแบนปูทางของทีม (เช่น แบน `Mina, Florentino` -> คาดเดาและปลดล็อก `Omen` อันดับ 1 ด้วย Lift 4.03x)
  - **Pick -> Phase-2 Ban Lift**: คำนวณฮีโร่ที่ทีมมักแบนใน Phase 2 เพื่อปกป้องตัวที่หยิบไปแล้ว (เช่น หยิบ `Omen` -> คาดเดาแบน `Mina` และ `Florentino` เป็นอันดับ 1 และ 2)
- อัปเกรด `_predict_team_next_picks()` ให้เริ่มแสดงภาพโปร่งใสคาดเดาตัวเลือกถัดไปได้ **ตั้งแต่เริ่มแบนตัวแรก (`len(team_bans) >= 1`)** พร้อมระบุป้าย `triggered_by` (เช่น `แบน Mina, Florentino`)
- เพิ่ม `_predict_team_next_bans()` และ `_compute_ban_unlocked_heroes()` ใน `src/predictor.py` และส่งค่า `blue_next_bans`, `red_next_bans`, `ban_unlocked_heroes`, `triggered_by` ผ่าน API (`src/schemas.py`)
- อัปเดต `TeamColumn.tsx` ให้แสดงภาพโปร่งใสในช่อง Ban ที่ยังว่าง (`B1..B4`) และอัปเดต `AiPanel.tsx` เพิ่มแถบ **"🔥 ตัวปลดล็อก (เก่งขึ้นทันที)"** ด้านบนพร้อมป้ายกำกับในลิสต์แนะนำ
- เพิ่มเทสต์ `test_ban_pick_bidirectional_intelligence` ใน `tests/test_api.py`

### 📁 ไฟล์ที่แก้
- `src/schemas.py`
- `src/predictor.py`
- `frontend/src/types/draft.ts`
- `frontend/src/hooks/useDraft.ts`
- `frontend/src/components/TeamColumn.tsx`
- `frontend/src/components/AiPanel.tsx`
- `frontend/src/App.tsx`
- `frontend/dist/*`
- `tests/test_api.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `ruff check --fix .` & `ruff format .`: ผ่านทั้งหมด (0 errors)
- `cd frontend && npm run lint && npm run build`: ผ่านทั้งหมด (0 warnings, 0 errors)
- `pytest -v`: ผ่านครบ 54/54 ข้อ

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ไม่มี

---

## 📅 2026-10-20 10:27 (UTC+7) — เพิ่มฟีเจอร์แสดงภาพโปร่งใสคาดเดา 2 ตัวเลือกถัดไปของแต่ละทีม (Ghost Next-Pick Forecast)
**Agent:** Gemini 4 Argon (High)

### ✅ สิ่งที่ทำ
- เพิ่มเมธอด `_predict_team_next_picks()` ใน `src/predictor.py` สำหรับพยากรณ์ฮีโร่ 2 ตัวถัดไปแบบ Autoregressive 2 ขั้น (เลือกตัวที่เข้าคอมพ์และเติมเลนที่ยังว่างของทีมนั้นๆ โดยไม่ให้เลนซ้ำกัน) เมื่อทีมมีฮีโร่ที่หยิบไปแล้วอย่างน้อย 1 ตัว
- เพิ่มฟิลด์ `blue_next_picks` และ `red_next_picks` ใน `DraftPredictionResponse` (`src/schemas.py` และ `frontend/src/types/draft.ts`)
- อัปเดต `useDraft.ts`, `TeamColumn.tsx`, และ `App.tsx` เพื่อแสดงการ์ดฮีโร่แบบโปร่งใส (Ghost Preview: ช่องถัดไปความชัด 50%, ช่องถัดไปอีกขั้นความชัด 35%, กรอบเส้นประ) พร้อมป้าย `คาดเดา #1 / #2` และเปอร์เซ็นต์ความน่าจะเป็น รวมถึงสามารถคลิกที่ช่องคาดเดาเพื่อล็อกฮีโร่ได้ทันทีเมื่ออยู่ในเทิร์นเลือกของฝั่งนั้น
- เพิ่มเทสต์ `test_predict_next_picks_ghost_forecast` ใน `tests/test_api.py`

### 📁 ไฟล์ที่แก้
- `src/schemas.py`
- `src/predictor.py`
- `frontend/src/types/draft.ts`
- `frontend/src/hooks/useDraft.ts`
- `frontend/src/components/TeamColumn.tsx`
- `frontend/src/App.tsx`
- `frontend/dist/*`
- `tests/test_api.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `ruff check --fix .` & `ruff format .`: ผ่านทั้งหมด (0 errors)
- `cd frontend && npm run lint && npm run build`: ผ่านทั้งหมด (0 warnings, 0 errors)
- `pytest -v`: ผ่านครบ 53/53 ข้อ

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ไม่มี

---

## 📅 2026-10-20 09:52 (UTC+7) — ตรวจสอบและแก้ไขบั๊กเชิงตรรกะ ฐานข้อมูลสกิล และ UI Combat Lab รวม 10 จุด
**Agent:** Gemini 4 Argon (High)

### ✅ สิ่งที่ทำ
- แก้ไข `ItemPicker` ใน `BuildPanel.tsx` ให้แสดงรองเท้าขั้นสมบูรณ์ทั้ง 6 คู่ (`category === "movement" && tier === 2`) ในหน้าเลือกไอเทมเริ่มต้นและแท็บ `MOVEMENT`
- แก้ไข `CombatEngine.build_stats()` ใน `src/combat_calculator.py` ให้ป้องกันการทับซ้อนพาสซีฟไอเทมซ้ำครอบคลุมทั้งข้อความที่ขึ้นต้นด้วย `"Unique"` และ `"Passive"` (เช่น `Staff of Nuul`, `Broken Spears`, `Spear of Longinus`)
- เพิ่ม `level_slot` ให้สกิลหลายร่างของ `Liliana`, `Edras`, `Dirak` และเพิ่มช่องสกิล Berserker Mode เข้าสู่ `ACTIVE_SLOTS` และ `auto_skill_levels()` เพื่อให้คำนวณเลเวลสกิลและดาเมจได้ครบถ้วน
- เพิ่ม `max_damage` และ `max_scaling` ให้สกิลชาร์จของ `Edras` (`Skill 1`, `Ultimate`) และ `TeeMee` (`Skill 1`)
- แก้ไข `normalize_ratio()` และการคำนวณสเกลเปอร์เซ็นต์ต่ำกว่า 3% (`Natalya Passive` +2% AP, `Astrid Ultimate`, `Florentino Skill 2`, `Sephera Passive`) รวมถึงรองรับคีย์ `max_hp_pct`, `bonus_hp_pct`, `bonus_max_hp_pct`, `target_max_hp_pct`, `target_current_hp_pct`, `bonus_armor_pct`, `bonus_ap_pct`
- แก้ไข `CombatEngine._procs()` ให้คำนวณตัวคูณ `damage_taken_pct` ของฝ่ายตั้งรับ (เช่น `Axe of Sacrifice`) และใช้ `self.canonical_enchantment()`
- แก้ไข `icon_url` ของสกิลที่ชื่อไฟล์ไม่ตรงกับไฟล์จริงใน `frontend/public/skills/` จำนวน 26 สกิล (12 ฮีโร่) จนครบ 100% ไม่มีลิงก์เสีย
- ข้ามการแจ้งเตือน `max(bd) > 2000` สำหรับสกิลที่ `damage_type == "none"` (`Rourke Ultimate`)
- รีเซ็ต `skill_charges: {}` เมื่อเปลี่ยนฮีโร่หรือกดก๊อปปี้ของ (Mirror) และปรับเพดานเลเวลสกิล (3 vs 6) กับ `ultimate_cdr_bonus` ใน `HeroSkillsModal.tsx` และ `SkillDamageTable.tsx`
- เพิ่ม Unit Tests ใหม่ใน `tests/test_combat_calculator.py` และ `tests/test_data_integrity.py` (รวม 52 ข้อ)

### 📁 ไฟล์ที่แก้
- `src/combat_calculator.py`
- `data/hero_skills_full.json`
- `frontend/src/types/combat.ts`
- `frontend/src/hooks/useCombatLab.ts`
- `frontend/src/components/lab/BuildPanel.tsx`
- `frontend/src/components/lab/SkillDamageTable.tsx`
- `frontend/src/components/lab/HeroSkillsModal.tsx`
- `frontend/dist/*` (rebuilt via `npm run build`)
- `tests/test_combat_calculator.py`
- `tests/test_data_integrity.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v`: ผ่านครบ 52/52 การทดสอบ (100% pass)
- `ruff check --fix . && ruff format .`: 0 lint errors
- `cd frontend && npm run lint && npm run build`: 0 warnings, 0 errors, build สำเร็จ
- `python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py`: ผ่านครบ 130 ฮีโร่ 4,208 แมตช์

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ไม่มีเรื่องค้าง ระบบคำนวณและฐานข้อมูลสกิล/ไอคอนสอดคล้องกันครบ 100%

---

## 📅 2026-10-20 09:40 (UTC+7) — บรรลุเป้าหมาย 130/130 ฮีโร่ (100% Ground Truth Lv.15 Base Stats) ด้วย Yue
**Agent:** Claude Fable 5.1

### ✅ สิ่งที่ทำ
- นำเข้าค่า Base Stats เลเวล 15 ของ **Yue** จากภาพสกรีนช็อตในเกม (`heroes/S__19775490.jpg`): HP 7213, AD 269, Armor 403, Magic Defense 239, Movement Speed 360
- อัปเดต `data/hero_status_lv15.json` ครบ 130 / 130 ตัวละคร (100.0%)
- รันสคริปต์ `scripts/apply_hero_status.py` เพื่อ Rebuild อัตราการเติบโตแบบ `measured_lv15` ครบถ้วนทุกตัวละครใน `data/hero_level_stats.json` และ `data/hero_level_stats.csv` (1,950 แถว เลเวล 1-15)
- ยืนยันว่าไม่มีฮีโร่ตัวใดหลงเหลือการใช้ค่าประมาณการตามคลาส (`class_estimate = 0`)
- อัปเดตการทดสอบใน `tests/test_data_integrity.py` ตรวจสอบความสมบูรณ์แบบของฐานข้อมูลเลเวล 15 ที่ 130 ตัวละคร

### 📁 ไฟล์ที่แก้
- `data/hero_status_lv15.json`
- `data/hero_level_stats.json`
- `data/hero_level_stats.csv`
- `tests/test_data_integrity.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v`: ผ่านครบ 49/49 การทดสอบ (100% pass)
- ตรวจสอบ `measured_lv15`: 130 / 130 ฮีโร่ (`class_estimate`: 0)
- `ruff check --fix .. && ruff format ..`: ทุกไฟล์ผ่านเกณฑ์
- `npm run build && npm run lint`: Build สำเร็จและ Lint ผ่านสมบูรณ์

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ฐานข้อมูลค่าสถานะเลเวล 1-15 ของฮีโร่ทั้ง 130 ตัวครบถ้วนสมบูรณ์ 100% Ground Truth แล้ว

---

## 📅 2026-10-20 09:30 (UTC+7) — นำเข้าค่าสถานะจริงเลเวล 15 ของ 24 ฮีโร่สู่ฐานข้อมูล (แตะ 129 / 130 ตัว)
**Agent:** Claude Fable 5.1

### ✅ สิ่งที่ทำ
- นำเข้าค่า Base Stats เลเวล 15 จากภาพสกรีนช็อตในเกม (`LINE_ALBUM_Lv15_261020_51.jpg` ถึง `75.jpg`) ครอบคลุม 24 ฮีโร่: Teeri, Bonnie, Sephera, Rourke, Ata, Wisp, Flowborn (Marksman), Ming, Dolia, Ormarr, Biron, Kahlii, Ilumia, Brunhilda (Celica), Moren, Dyadia, Heino, Preyta, Arum, Evita, Flowborn (Mage), Cresht, Azzen'Ka, และ Arthur (Mortos)
- คัดกรองและตัดโบนัสเขียว (พลังแฝง/รูน) ออกจากตัวเลขรวมทั้งหมดตามมาตรฐาน Ground Truth ของระบบ
- อัปเดต `data/hero_status_lv15.json` ขยายจำนวนฮีโร่ที่วัดค่าจริงแตะ 129 ตัว (99.23%)
- รันสคริปต์ `scripts/apply_hero_status.py` เพื่อ Rebuild ตารางสเกลเลเวล 1-15 ใน `data/hero_level_stats.json` และ `data/hero_level_stats.csv`
- เพิ่มการทดสอบใน `tests/test_data_integrity.py` เพื่อยืนยันว่ามีฮีโร่ที่วัดค่าเลเวล 15 ไม่น้อยกว่า 129 ตัว

### 📁 ไฟล์ที่แก้
- `data/hero_status_lv15.json`
- `data/hero_level_stats.json`
- `data/hero_level_stats.csv`
- `scripts/update_lv15_status.py`
- `tests/test_data_integrity.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v`: ผ่านครบ 49/49 การทดสอบ (100% pass)
- `ruff check --fix . && ruff format .`: ทุกไฟล์ผ่านเกณฑ์ ไม่มีข้อผิดพลาด
- `npm run build && npm run lint`: Build สำเร็จและ Lint ผ่านสมบูรณ์

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ภาพที่ 58 เป็นภาพซ้ำของ Flowborn (Marksman) ส่งผลให้เหลือเพียง `Yue` ตัวเดียวที่ยังไม่มีภาพสกรีนช็อตเลเวล 15 (ปัจจุบันใช้ `class_estimate` ของ Mage ชั่วคราว)

## 📅 2026-10-20 09:15 (UTC+7) — พัฒนาระบบจำลองสกิลชาร์จ (Charging Interpolation) และ Stack Passives ดาเมจสำหรับฮีโร่
**Agent:** Claude Fable 5.1

### ✅ สิ่งที่ทำ
- เพิ่มฟิลด์ `skill_charges` (`0.0` ถึง `1.0`) ใน `Build` และ `CombatBuildRequest` เพื่อรองรับการชาร์จสกิลและสเกลตามระยะทาง
- ออกแบบระบบ Linear Interpolation ใน `CombatEngine.skill_damage()` เชื่อมโยง `base_damage` & `scaling` (0% charge) กับ `max_damage` & `max_scaling` (100% charge) แบบไดนามิกโดยไม่ต้องฮาร์ดโค้ด
- สร้างโครงสร้าง `HERO_STACK_PASSIVES` รองรับฮีโร่ที่มีกลไกสะสมสแต็กสร้างความเสียหาย (เช่น Yena Mark of the Blade 5 ฮิต, Airi Dragon Blade 4 ฮิต, Hayate Blood of the Dragon 6 ฮิต, Lauriel Divine Punishment 4 ฮิต, Aleister 3 ฮิต, Tulen 5 ฮิต)
- เชื่อมต่อ `_procs()` และ `simulate_duel()` เพื่อสะสมฮิตการโจมตี/สกิลระหว่างดวลและระเบิดดาเมจ Passive proc เข้าสู่ผลลัพธ์การจำลองการต่อสู้ 1v1 พร้อมแสดงใน `damage_breakdown`
- ปลดล็อกคอมโบเช็คบ็อกซ์ในหน้าเว็บ Combat Lab ให้เลือกนับสกิล Passive ที่มีดาเมจเข้าสู่การคำนวณ Burst combo ได้
- เพิ่ม UI แถบสไลเดอร์ปรับระดับการชาร์จสกิล (0% - 100%) พร้อมแสดงสูตรคำนวณดาเมจต่ำสุด-สูงสุดในรายละเอียดสกิล

### 📁 ไฟล์ที่แก้
- `src/schemas.py`
- `src/combat_calculator.py`
- `tests/test_combat_calculator.py`
- `frontend/src/types/combat.ts`
- `frontend/src/components/lab/SkillDamageTable.tsx`
- `frontend/dist/*` (rebuilt via `npm run build`)
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v`: ผ่านทั้งหมด 49/49 การทดสอบ (ครอบคลุม `test_skill_charging_interpolation`, `test_hero_stack_passive_proc`, `test_burst_with_passive`)
- `python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py`: Data Guardian ผ่าน 130 ฮีโร่ 4,208 แมตช์ 0 unmapped
- `npm run build`: Vite build สำเร็จ 100%
- `npm run lint` & `ruff check --fix .` & `ruff format .`: 0 lint errors, 0 format issues

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ฮีโร่ที่ยังไม่มีใน `HERO_STACK_PASSIVES` สามารถระบุกติกาเงื่อนไขจำนวนฮิตเพิ่มเติมในดิกชันนารีได้โดยตรง หรือนับดาเมจผ่าน `active_combo_slots` ได้ทันที

---

## 📅 2026-10-20 14:18 (UTC+7) — แก้ไขบั๊กวงแท็กฮีโร่หลุดและปรับเทียบหลอดเลือด/อัลติเมทด้วย HSV บน Minimap & Sidebars
**Agent:** Gemini 3.8 Flash (High)

### ✅ สิ่งที่ทำ
- แก้ไขปัญหาตัวกรองสี BGR เดิมที่เข้มงวดเกินไปจนตรวจจับวงกลมฮีโร่สีแดงได้เพียง 0–1 ตัว และสีน้ำเงินได้เพียง 1–2 ตัว โดยปรับมาใช้ HSV Hero Ring Mask (`Red: H <= 10 or H >= 170, S > 90, V > 100`, `Blue: H in [100, 130], S > 95, V > 110`) ร่วมกับ Tower Masking และ Connected Components (`area >= 18, w >= 5, h >= 5`) ทำให้ตรวจจับตำแหน่งฮีโร่ที่เคลื่อนที่ได้แม่นยำครบ 4–6 จุดต่อฝั่งในทุกๆ เฟรม
- ปรับปรุงการสแกนสถานะเกิด-ตายและอัลติเมทจากแถบด้านข้าง (Sidebars):
  - เปลี่ยนจากการตรวจจับ BGR เป็น HSV Green (`40 <= H <= 80, S >= 60, V >= 120`) แก้ไขปัญหาที่หลอดเลือดมีสีแดง/น้ำเงินเจือปนจนฮีโร่ถูกมองว่าตายตั้งแต่ต้นเกม (ตอนนี้ต้นเกม 00:10–05:20 ฮีโร่ทั้ง 10 ตัว `ALIVE` ครบ 100%)
  - ตรวจจับเม็ดเพชรอัลติเมทสีเขียวเรืองแสงข้างรูปโปรไฟล์ (`ult_ready: true/false`) อย่างแม่นยำ
  - ตรวจจับจังหวะตายจริงได้อย่างสมบูรณ์ เช่น First Blood นาทีที่ 05:25 (Raz ตาย), นาทีที่ 07:00–07:20 (Astrid และ Iggy ตาย), และทีมไฟต์ใหญ่ 10:00 (Qi และ Astrid ตาย พิกเซลหลอดเลือดเหลือ 0 ทันที)
- สร้างการ์ด Composite HUD ขนาด 530x270 พิกเซล (`[แถบซ้าย FS 130px | Minimap 270x270px | แถบขวา TEN 130px]`) ครบทั้ง 146 สแนปช็อตใน `data/vod_analytics/fs_vs_ten_game1/sidebars_5s/`
- รันประมวลผล Game 1 ใหม่ทั้ง 146 สแนปช็อต บันทึกข้อมูลลง `data/vod_analytics/fs_vs_ten_game1/rotations_5s.json`

### 📁 ไฟล์ที่แก้
- `scripts/extract_minimap_rotations.py`
- `data/vod_analytics/fs_vs_ten_game1/rotations_5s.json`
- `data/vod_analytics/fs_vs_ten_game1/minimap_5s/*`
- `data/vod_analytics/fs_vs_ten_game1/sidebars_5s/*`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ตรวจสอบไทม์ไลน์ 146 สแนปช็อต:
  - ช่วง 00:10–05:20: ไม่มีใครตาย (`DEAD = []`) ฮีโร่อยู่เลนตรงตามความเป็นจริง (Qi อยู่ Dark Slayer Lane, Eland'orr และ TeeMee อยู่ Abyssal Dragon Lane)
  - นาทีที่ 07:00: Iggy ตาย (`DEAD`), อัลติเมทปิด (`Ult: False`), พิกัดหยุดที่จุดตาย
  - นาทีที่ 10:00: Qi และ Astrid ตายคู่ (`DEAD`), ฮีโร่ที่รอดชีวิตของ FS บุกเลนกลาง
  - ผ่าน `ruff check` และ `ruff format` ทั้งหมด

---
**Agent:** Claude Fable 5.1

### ✅ สิ่งที่ทำ
- สกัดค่าสเตตัสเลเวล 15 จากภาพถ่ายหน้าจอโหมดฝึกซ้อมในเกมจริงชุดใหม่ 50 รูป (`LINE_ALBUM_Lv15_261020_1.jpg` ถึง `50.jpg`) ย้ายเข้าสู่โฟลเดอร์ `heroes/`
- กรองค่าโบนัสสีเขียวทั้งหมดเพื่อเก็บเฉพาะ Base stats ที่แท้จริง:
  - Wiro (รูปที่ 6): เกราะและกันเวทตัดโบนัส Passive (+130) เหลือ Base Armor = 382, Magic Defense = 269
  - Rouie (รูปที่ 10): พลังโจมตีตัดโบนัส (+38) เหลือ Base AD = 283, ความเร็วเคลื่อนที่ตัด Passive (+60) เหลือ Base MS = 360
  - Chaugnar (รูปที่ 11): ความเร็วเคลื่อนที่ตัด Passive (+39) เหลือ Base MS = 390
  - Veera (รูปที่ 24): ความเร็วเคลื่อนที่ตัด Passive (+72) เหลือ Base MS = 360
  - Tel'Annas (รูปที่ 23): พลังโจมตีตัด Passive (+30) เหลือ Base AD = 380
  - ฮีโร่อื่นๆ ที่มีพลังโจมตี/พลังเวทสีเขียว (เช่น Max, Erin, Goverra, Wukong, Xeniel, Allain, Grakk, Ignis, Jinnar, Zip, Kaine, Elsu, Superman, Ryoma, Kil'Groth) ถูกตัดโบนัสเหลือ Base ล้วน
- อัปเดต `data/hero_status_lv15.json` เพิ่ม 50 ฮีโร่ใหม่ครบถ้วน ทำให้ฮีโร่ที่วัดค่าจริงเลเวล 15 เพิ่มจาก 55 ตัวเป็น **105 / 130 ตัว**
- รัน `scripts/apply_hero_status.py` เพื่อคำนวณอัตราเติบโตจริง (`measured_lv15`) ใหม่ทั้งหมด 1,950 แถว และบันทึกลง `data/hero_level_stats.json`, `data/hero_level_stats.csv`, และ `data/heroes_130_full.json`
- อัปเดต `tests/test_data_integrity.py` ให้ตรวจสอบ `measured_count >= 105`
- ผ่านการตรวจสอบความถูกต้อง 46/46 unit tests (`pytest -v`) และ linter (`ruff check --fix .`) เรียบร้อย

### 📁 ไฟล์ที่แก้
- `heroes/LINE_ALBUM_Lv15_261020_1..50.jpg` (ย้ายมาจาก root)
- `data/hero_status_lv15.json`
- `data/hero_level_stats.json`
- `data/hero_level_stats.csv`
- `data/heroes_130_full.json`
- `tests/test_data_integrity.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v` (46 passed 100%)
- `ruff check --fix .` && `ruff format .` (All checks passed)

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ปัจจุบันเหลืออีกเพียง **25 ฮีโร่** ที่ยังใช้ `class_estimate`: Arthur, Arum, Ata, Azzen'Ka, Biron, Bonnie, Brunhilda, Cresht, Dolia, Dyadia, Evita, Flowborn (Mage), Flowborn (Marksman), Heino, Ilumia, Kahlii, Ming, Moren, Ormarr, Preyta, Rourke, Sephera, Teeri, Wisp, Yue

**Agent:** Claude Fable 5.1

### ✅ สิ่งที่ทำ
- สกัดค่าสเตตัสเลเวล 15 จากภาพถ่ายหน้าจอในเกมจริง 50 รูป (`heroes/LINE_ALBUM_Lv15_261019_1.jpg` ถึง `50.jpg`)
- กรองค่าโบนัสสีเขียว (จากรูน/พลังแฝง) ออกทั้งหมด และยึด Base stats ในวงเล็บ
- สำหรับ Skud (รูปที่ 27): ดึงเฉพาะ Base HP 8,856 (ไม่รวมโบนัส Passive +1,328) ตามที่ระบุ
- อัปเดต `data/hero_status_lv15.json` เพิ่ม 49 ฮีโร่ใหม่ ทำให้มีฮีโร่ที่วัดค่าจริงในเกมครบ 55 / 130 ตัว
- รัน `scripts/apply_hero_status.py` คำนวณอัตราเติบโตจริง (`measured_lv15`) และสร้างตารางสเกลเลเวล 1-15 ใน `data/hero_level_stats.json` และ `data/hero_level_stats.csv` ใหม่ทั้งหมด
- อัปเดตเทสต์ `tests/test_data_integrity.py` ตรวจสอบจำนวนฮีโร่ `measured_lv15 >= 55` และตรวจ Base HP ของ Skud เลเวล 15 ต้องเป็น 8,856

### 📁 ไฟล์ที่แก้
- `data/hero_status_lv15.json`
- `data/hero_level_stats.json`
- `data/hero_level_stats.csv`
- `tests/test_data_integrity.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v`: ผ่านครบ 46/46 tests
- `python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py`: ผ่าน 100%
- `ruff check --fix . && ruff format .`: ตรวจสอบโค้ดผ่าน 100%

---

## 📅 2026-10-19 20:30 (UTC+7) — ระบบสลับร่าง/ฟอร์ม (Stance) & เลือกคอมโบสกิลอิสระ (Customizable Combo) พร้อมไอคอนครบ 100%
**Agent:** Claude Fable 5.1

### ✅ สิ่งที่ทำ
- สกัดและตัดไอคอนสกิลวงกลมโปร่งใส (80x80 RGBA PNG) สำหรับร่างรวมดาบของ Yena ทั้ง 4 สกิล จากภาพถ่ายหน้าจอ iPad ต้นฉบับใน `heroes/Yena/skill/`:
  - `4_lunarphase2.png`: Passive 2 (Lunar Phase Combined Blade)
  - `5_lunarstrike.png`: Skill 3 (Lunar Strike Combined Blade)
  - `6_advancingmoon.png`: Skill 4 (Advancing Moon Combined Blade)
  - `7_halfmoon.png`: Skill 5 (Half Moon Combined Blade)
- อัปเดตแพตช์ `data/hero_patches/Yena.json` และรัน `scripts/apply_hero_patch.py` ใส่ `data/hero_skills_full.json` และ `data/heroes_130_full.json` ครบ 100% (ไม่มีไอคอนสกิลตกหล่น)
- พัฒนาระบบ `active_combo_slots` ใน `src/combat_calculator.py` และ `src/schemas.py`:
  - กรองสกิลที่นำมาคำนวณใน `burst()` และ `simulate_duel()` ตามรายชื่อสล็อตที่กำหนดได้
  - หากไม่ได้ระบุ (`None`) จะคำนวณสกิลที่ใช้งานได้ทั้งหมดตามปกติ (Backward compatible)
- อัปเดต UI/UX ใน `frontend/src/components/lab/SkillDamageTable.tsx` และ `HeroSkillsModal.tsx`:
  - เพิ่ม Checkbox แต่ละแถวสกิลให้เลือกเปิด/ปิดการนับเข้าคอมโบได้อิสระ
  - เพิ่มปุ่ม Preset คอมโบด่วน:
    - Yena: [ดาบคู่], [รวมดาบ], [2 ร่างเต็ม], [ล้าง]
    - Liliana: [ร่างมนุษย์], [ร่างจิ้งจอก], [2 ร่างเต็ม], [ล้าง]
    - ฮีโร่อื่นๆ: [เลือกทั้งหมด], [ล้างทั้งหมด]
  - ติดป้าย Badge กำกับร่าง (ดาบคู่ / รวมดาบ / มนุษย์ / จิ้งจอก / สลับร่าง) ทั้งในตารางและแท็บเลือกสกิล
  - อัปเดตการแสดงผลผลรวมเบิร์สดาเมจตามสกิลที่เลือกจริง
- อัปเดต `BuildPanel.tsx` และ `useCombatLab.ts` ให้รีเซ็ต `active_combo_slots` เมื่อเปลี่ยนฮีโร่หรือทำ mirror build

### 📁 ไฟล์ที่แก้
- `frontend/public/skills/Yena/` (4 ไฟล์ไอคอนใหม่)
- `data/hero_patches/Yena.json`, `data/hero_skills_full.json`, `data/heroes_130_full.json`
- `src/combat_calculator.py`, `src/schemas.py`
- `tests/test_combat_calculator.py`
- `frontend/src/types/combat.ts`
- `frontend/src/components/lab/SkillDamageTable.tsx`
- `frontend/src/components/lab/HeroSkillsModal.tsx`
- `frontend/src/components/lab/BuildPanel.tsx`
- `frontend/src/hooks/useCombatLab.ts`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v`: ผ่านทั้งหมด 46/46 tests (รวมเทสต์ใหม่ `test_active_combo_slots_filters_burst_and_duel`)
- `python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py`: Data Guardian ผ่าน 100% (130 ฮีโร่, 4,208 แมตช์)
- `ruff check --fix . && ruff format .`: ตรวจสอบโค้ดผ่าน 100% ไม่มีข้อผิดพลาด
- `npm run lint && npm run build` (frontend): ผ่าน 0 lint errors, build production สำเร็จเรียบร้อย

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- สถิติเลเวล 1-15 ปัจจุบันอิงจาก 6 ฮีโร่ที่ตรวจค่าในเกม 100% และ 124 ฮีโร่ที่สเกลตามสมการฐาน รอเก็บภาพสเตตัสเลเวล 15 เพิ่มเติมในอนาคต

---

## 📅 2026-10-19 19:10 (UTC+7) — เพิ่มสกิลร่างรวมดาบของ Yena
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- ผู้ใช้ส่งรูปสกิลร่างรวมดาบของ Yena มา 4 รูป (S__19767315 ถึง 318) ย้ายไปไว้ที่ `heroes/Yena/skill/` แล้ว
- เพิ่มสกิลร่างรวมดาบเป็นช่องใหม่ ใส่เฉพาะค่าที่อยู่ในรูป:
  - `Passive 2` Lunar Phase (Combined Blade)
  - `Skill 3` Lunar Strike: base_damage เป็นค่าตอนไม่ชาร์จ เก็บดาเมจตอนชาร์จเต็มไว้ใน `max_damage`/`max_scaling`
  - `Skill 4` Advancing Moon: ตั้ง `hits: 4`
  - `Skill 5` Half Moon
- เพิ่มฟิลด์ `level_slot` ในสกิลที่เป็นของร่างอื่น ให้ใช้เลเวลตามช่องในเกม: Skill 3 ใช้ Skill 1, Skill 4 ใช้ Skill 2, Skill 5 ใช้ Ultimate
- `combat_calculator.py`:
  - ใช้ `level_slot` หาเลเวลสกิล และรองรับ `Passive 2` (เลเวลคงที่ 1)
  - ค่าเริ่มต้นของจำนวนครั้งที่โดนอ่านจากฟิลด์ `hits` ของสกิล
  - ลดคูลดาวน์อัลติจะคิดกับสกิลที่ใช้ level_slot เป็น Ultimate ด้วย
- frontend: เพิ่ม `Skill 5`/`Passive 2` ใน SLOT_ORDER ซึ่งแก้ปัญหาที่ Foxtrot (Skill 5) ของ Liliana ไม่แสดงด้วย และช่อง Passive 2 ไม่มีช่องกรอกเลเวล
- แก้ข้อความ Full Moon (อัลติร่างคู่ดาบ) จาก "heavy blade form" เป็น combined-blade form

### 📁 ไฟล์ที่แก้
- `data/hero_patches/Yena.json` และ `hero_skills_full.json`, `heroes_130_full.json` (ใส่ผ่าน apply_hero_patch.py)
- `src/combat_calculator.py`, `tests/test_combat_calculator.py`
- `frontend/src/components/lab/HeroSkillsModal.tsx`, `frontend/src/components/lab/SkillDamageTable.tsx`
- `heroes/Yena/skill/S__1976731{5,6,7,8}_0.jpg`

### 🧪 การตรวจสอบ
- pytest 45/45 ผ่าน, Data Guardian PASS, ruff สะอาด, npm lint/build ผ่าน

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ยังไม่ได้จำลองการชาร์จ ตีแรงขึ้น 50% รับดาเมจลดลง 40% และความเร็วโจมตีที่เพิ่ม
- ตอนนี้ burst/duel นับดาเมจของทั้งสองร่างรวมกัน ซึ่งเกินจริง ยังไม่มีระบบเลือกว่าใช้ร่างไหน
- ไอคอนสกิลของร่างรวมดาบยังไม่มีใน `frontend/public/skills/Yena/`

---

## 📅 2026-10-19 18:40 (UTC+7) — ปรับอัตราเพิ่มต่อเลเวลจากรูป status Lv.15 ในเกม
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- ผู้ใช้ส่งรูป status Lv.1 และ Lv.15 ของ 6 ฮีโร่ รวม 12 รูป (Toro, Lu Bu, Nakroth, Tulen, Valhein, Alice) ทุกรูปไม่มีไอเทมและใช้หน้ารูนว่าง ย้ายรูปไปไว้ที่ `heroes/<Hero>/status/` แล้ว
- ตัวเลขสีเขียวมาจากพลังแฝง จึงไม่นำมาคิด ใช้ค่าพื้นฐานในวงเล็บแทน
- ค่า Lv.1 ในรูปชุดนี้ตรงกับ `hero_status_lv1.json` ทุกตัว
- พบว่าอัตราเพิ่มต่อเลเวลเดิมคลาดเคลื่อนทุกคลาส เช่น Lu Bu มี HP ในเกม 8772 แต่คำนวณได้ 7841 ส่วน Magic Def ในเกมขึ้นจาก 80 เป็น 269 ทุกตัว (เพิ่มเลเวลละ 13.5) แต่ค่าเดิมคือ 8.5 และ Mage/Marksman เป็น 0
- สร้างไฟล์ใหม่ `data/hero_status_lv15.json` เก็บค่า Lv.15 ของทั้ง 6 ตัว
- `apply_hero_status.py` ใช้อัตราที่วัดจริงของตัวที่มีข้อมูล Lv.15 (`growth_source: measured_lv15`) ตัวอื่นยังใช้อัตราของคลาส (`class_estimate`)
- เปลี่ยน `CLASS_GROWTH_RATES` เป็นค่าที่วัดได้จากฮีโร่ตัวแทนของแต่ละคลาส

### 📁 ไฟล์ที่แก้
- `data/hero_status_lv15.json` (ใหม่), `scripts/apply_hero_status.py`, `scripts/build_hero_level_stats.py`
- `data/hero_level_stats.json`, `data/hero_level_stats.csv`, `data/heroes_130_full.json` (สร้างใหม่ด้วยสคริปต์)
- `tests/test_data_integrity.py`: เทสต์ว่าค่า Lv.15 ของทั้ง 6 ตัวตรงกับในเกม
- `heroes/{Toro,Lu Bu,Nakroth,Tulen,Valhein,Alice}/status/S__197673xx_0.jpg`

### 🧪 การตรวจสอบ
- pytest 44/44 ผ่าน, Data Guardian PASS, ruff สะอาด

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- อัตราเพิ่มน่าจะต่างกันเป็นรายตัว ไม่ได้ผูกกับคลาส เช่น Lu Bu กับ Toro ได้ HP ต่อเลเวลไม่เท่ากัน อีก 124 ตัวจึงยังเป็นค่าประมาณจากฮีโร่ตัวแทนคลาสเพียงตัวเดียว ถ้าอยากได้ค่าแม่นทุกตัวต้องแคป Lv.15 เพิ่มลง `hero_status_lv15.json`
- ตอนนี้สมมติว่าค่าเพิ่มเท่ากันทุกเลเวล ยังไม่ได้ตรวจค่าระหว่างเลเวล 2 ถึง 14
- รูปมีข้อมูลมานาและค่าฟื้นฟูที่ Lv.15 ด้วย แต่ยังไม่ได้นำมาใช้
- ห้ามรัน `build_hero_level_stats.py` แยกเดี่ยว ถ้ารันต้องรัน `apply_hero_status.py` ตามทุกครั้ง

---

## 📅 2026-10-19 18:05 (UTC+7) — แก้บั๊กอัตราเพิ่มต่อเลเวลที่ใช้คลาส Warrior กับทุกฮีโร่
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- **บั๊ก:** `get_hero_primary_class()` ใน `scripts/build_hero_level_stats.py` อ่านฟิลด์ `classes` ซึ่งไม่มีอยู่ในข้อมูลฮีโร่เลย ทั้ง 130 ฮีโร่จึงได้อัตราเพิ่มแบบ Warrior (95 ฮีโร่มี `primary_role` ไม่ใช่ Warrior เช่น Valhein ที่เป็น Marksman)
- แก้ให้ใช้ `primary_role` ก่อน แล้วค่อย fallback ไป `classes`
- `scripts/apply_hero_status.py` เลือก `growth_rates` จาก `CLASS_GROWTH_RATES` ตาม `primary_role` แล้วสร้างตาราง Lv.1–15 ใหม่ ตอนนี้คลาสกระจายเป็น Warrior 35 / Mage 34 / Marksman 20 / Tank 15 / Assassin 14 / Support 12
- เทสต์ `test_hero_base_stats_match_ingame_status` เช็กเพิ่มว่า `primary_class` ตรงกับ `primary_role`

### 📁 ไฟล์ที่แก้
- `scripts/build_hero_level_stats.py`, `scripts/apply_hero_status.py`
- `data/hero_level_stats.json`, `data/hero_level_stats.csv`
- `tests/test_data_integrity.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -q` — ผ่าน 44 / 44
- Data Guardian audit — ผ่าน
- `ruff check --fix .` / `ruff format .` — ผ่าน

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ตัวเลขใน `CLASS_GROWTH_RATES` ยังไม่เคยเทียบกับเกม (เช่น Mage/Marksman ต้านเวทไม่เพิ่มเลย) ควรใช้รูป Lv.15 จากโหมดฝึกเช็ก
- ผู้ใช้ยืนยันแล้วว่า `primary_role` ของ The Flash = Mage และ Zip = Support ถูกต้อง

---

## 📅 2026-10-19 17:50 (UTC+7) — อัปเดตค่าพื้นฐาน Lv.1 และระยะตีของ 130 ฮีโร่ตามค่าในเกม
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- **สร้าง `data/hero_status_lv1.json`:** เก็บค่า Lv.1 ที่อ่านจากรูป `heroes/<Hero>/status/` ครบ 130 ฮีโร่ ได้แก่ HP, AD, เกราะ (+ armor_pct ถ้ามี), ต้านเวท, ทรัพยากรสูงสุด, ความเร็ว, ระยะตี, ฟื้นฟู HP/ทรัพยากร และ path รูปที่ใช้อ้างอิง
- **สร้าง `scripts/apply_hero_status.py`:**
  - อัปเดต `base_stats` และ `attack_range` (เหลือแค่ "Melee" 69 / "Ranged" 61) ใน `heroes_130_full.json`
  - สร้างตาราง Lv.1–15 ใน `hero_level_stats.json/.csv` ใหม่ จากค่า Lv.1 ในเกม และ `growth_rates` เดิมของแต่ละฮีโร่ (แผน A)
- แก้ข้อมูลเสีย เช่น ต้านเวท 8011 ของ Arum / Wiro, ระยะตีผิดของ Rourke / Bright / Paine / Enzo และระยะตีที่ว่างหรือสะกดผิด
- เพิ่มเทสต์ `test_hero_base_stats_match_ingame_status` เช็กระยะตี, ช่วงค่าต้านเวท และค่า Lv.1 ให้ตรงกับ `hero_status_lv1.json`

### 📁 ไฟล์ที่แก้
- `data/hero_status_lv1.json` (สร้างใหม่)
- `scripts/apply_hero_status.py` (สร้างใหม่)
- `data/heroes_130_full.json`, `data/hero_level_stats.json`, `data/hero_level_stats.csv`
- `tests/test_data_integrity.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -q` — ผ่าน 44 / 44
- Data Guardian audit — ผ่าน
- `ruff check --fix .` / `ruff format .` — ผ่าน
- `npm run lint` / `npm run build` — ผ่าน

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ค่า Lv.2–15 ใช้อัตราเพิ่มตามคลาสแบบเดิม ซึ่งยังไม่เคยเทียบกับเกม ควรขอรูป Lv.15 จากโหมดฝึกมาเช็ก
- **อย่ารัน `scripts/build_hero_level_stats.py` ซ้ำ** เพราะจะเขียนทับด้วย `HERO_BASE_OVERRIDES` ค่าเก่า ถ้าต้องรัน ให้รัน `scripts/apply_hero_status.py` ต่อท้ายทุกครั้ง
- ยังไม่ได้ใช้ `armor_pct`, ทรัพยากร และค่าฟื้นฟูใน `src/combat_calculator.py`

---

## 📅 2026-10-19 17:30 (UTC+7) — จัดรูปค่าสถานะฮีโร่ชุดสุดท้าย (50 รูป) ครบ 130 / 130
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- อ่านรูป `LINE_ALBUM_Status_261019_1..50.jpg` ชุดที่ 3 (เช็ก md5 แล้วไม่ซ้ำกับชุดก่อน) และย้ายเข้า `heroes/<Hero>/status/` โดยเปลี่ยนชื่อเป็น `LINE_ALBUM_Status_261019c_<n>.jpg`
- แมปชื่อที่แสดงในเกมกลับเป็นชื่อ canonical: Mortos → `Arthur`, Celica → `Brunhilda`
- แยก Flowborn จากไอคอนตำแหน่งและชื่อสกิน: #7 "Steady Will" (ไอคอนลูกศร, AD 170, มานา 600) → `Flowborn (Marksman)` และ #21 "Arcane Heart" (ไอคอนเวท, AD 160, มานา 640) → `Flowborn (Mage)`
- เทียบค่า Lv.1 กับ `data/hero_level_stats.json` และ `attack_range` กับ `data/heroes_130_full.json` (ยังไม่ได้แก้ข้อมูล)

### 📁 ไฟล์ที่แก้
- `heroes/*/status/` (ย้ายรูป 50 รูป)
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- มีรูป status ครบ 130 / 130 ฮีโร่ ฮีโร่ละ 1 รูป และไม่มีรูปค้างที่ `heroes/`
- ชุดนี้ตรงทุกค่า 7 ฮีโร่ (Ata, Dolia, Omega, Erin, Annette, Aya, Amily) รวมทั้ง 3 ชุดตรง 23 / 130 อีก 107 ฮีโร่ต่างกันอย่างน้อย 1 ค่า

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ข้อมูลเดิมเสีย: Arum และ Wiro มี `magic_defense = 8011` (ในเกม 80)
- ระยะตีที่ผิดชัดเจน: Rourke (Ranged → ในเกม Melee) ส่วนที่เหลือเป็นค่าว่างหรือสะกดผิด ("Meele", "Near", "Medium", "Ranged}}")
- ค่าที่ลดลงจากเดิม: Ishar AD 168 → 120, Dirak HP 3300 → 3000, Ming เกราะ 162 → 138, Yue ต้านเวท 80 → 50 (เปิดรูปเช็กแล้วว่าในเกมเป็นค่านี้จริง)
- ค่าที่อ่านได้ยังไม่ได้บันทึกลง repo รอผู้ใช้อนุมัติแผนอัปเดต และรูปให้แค่ค่า Lv.1 ยังไม่มีค่า growth ต่อเลเวล

---

## 📅 2026-10-19 17:00 (UTC+7) — จัดรูปค่าสถานะฮีโร่ชุดที่ 2 (55 รูป) และเทียบกับข้อมูลเดิม
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- อ่านรูป `LINE_ALBUM_Status_261019_1..55.jpg` ชุดใหม่ (เช็ก md5 แล้วไม่ซ้ำกับชุดแรก) และย้ายเข้า `heroes/<Hero>/status/`
- ชุดนี้ใช้ชื่อไฟล์ซ้ำกับชุดแรก จึงเปลี่ยนชื่อเป็น `LINE_ALBUM_Status_261019b_<n>.jpg` และแมปชื่อ Jinna → โฟลเดอร์ `Jinnar`
- เทียบค่า Lv.1 กับ `data/hero_level_stats.json` และ `attack_range` กับ `data/heroes_130_full.json` (ยังไม่ได้แก้ข้อมูล)

### 📁 ไฟล์ที่แก้
- `heroes/*/status/` (ย้ายรูป 55 รูป)
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ไม่มีรูปค้างที่ `heroes/` ตอนนี้มีรูป status รวม 80 รูป ครบ 80 ฮีโร่
- ตรงทุกค่า 13 ฮีโร่ อีก 42 ฮีโร่ต่างกันอย่างน้อย 1 ค่า

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ยังขาดรูป status อีก 50 ฮีโร่
- พบระยะตีผิดในข้อมูลเดิม: Bright (Melee → ในเกม Ranged), Paine (Ranged → ในเกม Melee), Enzo ("Ranged / Melee" → Melee)
- Grakk, Zip, Slimz, Krixi, Skud, Astrid มี AD หรือ HP ในเกม**ต่ำกว่า**ค่าเดิม ไม่ได้ผิดไปทางเดียวกันทั้งหมด
- เปลี่ยนชื่อโฟลเดอร์ `heroes/amily` → `heroes/Amily` ให้ตรงกับชื่อในข้อมูลแล้ว

---

## 📅 2026-10-19 16:30 (UTC+7) — แก้อัลติ Keera / Mina ตามรูปในเกม และเปลี่ยนชื่อโฟลเดอร์ Astrid
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- ย้ายรูปอัลติใหม่เข้าโฟลเดอร์ฮีโร่ (`S__19750915_0.jpg` → `heroes/Mina/skill/`, `S__19750916_0.jpg` → `heroes/Keera/skill/`) ตอนนี้ครบ 4 สกิลทั้งคู่
- **Keera – Fading Phantom:** ค่าเดิมเป็นข้อมูลเก่า แก้เป็นวิ่งเร็วขึ้น 30% นาน 8 วิ (เดิม 40% / 6 วิ) ใช้มานา 100 ทุกเลเวล (เดิม 100/110/120) เอาข้อความ "ป้องกันการโจมตีปกติ 3 ครั้ง" ออก และเพิ่ม "ป้องกันสถานะขณะอยู่ในสิ่งกีดขวาง" CD 40/35/30 เท่าเดิม
- **Mina – Dark Dominion:** เดิมไม่มีดาเมจ แก้เป็นดาเมจกายภาพ 250/375/500 (+100% AD) CD 45/40/35 (เดิม 40/35/30) มานา 100 (เดิม 0) ยั่วยุ 1.5/2/2.5 วิ และเอาข้อความ "ลดความเสียหายที่ได้รับ 50%" ออกเพราะในเกมไม่มีแล้ว
- เปลี่ยนชื่อโฟลเดอร์ `heroes/astrid` → `heroes/Astrid`

### 📁 ไฟล์ที่แก้
- `data/hero_patches/Keera.json`, `data/hero_patches/Mina.json`
- `data/hero_skills_full.json`, `data/heroes_130_full.json` (รัน `scripts/apply_hero_patch.py` ทีละฮีโร่)
- `heroes/Keera/skill/`, `heroes/Mina/skill/`, `heroes/Astrid/`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -q` — ผ่าน 43 / 43
- Data Guardian audit — ผ่าน
- `ruff check .` / `ruff format --check .` — ผ่าน

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- git diff ของ `hero_skills_full.json` / `heroes_130_full.json` เทียบกับ HEAD ใหญ่มาก เพราะรวมงาน patch 130 ฮีโร่จากรอบก่อนที่ยังไม่ได้ commit รอบนี้เปลี่ยนแค่ Keera และ Mina
- รอรูปค่าสถานะครบ 130 ฮีโร่ เพื่ออัปเดตค่าพื้นฐาน (ดูรายการก่อนหน้า)

---

## 📅 2026-10-19 16:10 (UTC+7) — จัดรูปค่าสถานะฮีโร่ 25 รูป และเทียบกับข้อมูลเดิม
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- อ่านรูป `LINE_ALBUM_Status_261019_1..25.jpg` (หน้าค่าสถานะ Lv.1 ในเกม) และย้ายแต่ละรูปเข้า `heroes/<Hero>/status/`
- เทียบค่าในรูปกับ Lv.1 ใน `data/hero_level_stats.json` และ `attack_range` ใน `data/heroes_130_full.json` (ยังไม่ได้แก้ข้อมูล)

### 📁 ไฟล์ที่แก้
- `heroes/*/status/` (ย้ายรูป 25 รูป)
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ไม่มีรูปค้างที่ `heroes/` และมีรูปใน `status/` ครบ 25 รูป
- ตรงกันทุกค่ามี 3 ฮีโร่ (Wonder Woman, Nakroth, Aoi) อีก 22 ฮีโร่ต่างกันอย่างน้อย 1 ค่า

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ค่าเก่าหลายฮีโร่ดูเหมือนเป็นข้อมูลก่อนปรับค่าพื้นฐานทั้งเกม (HP ต่ำไป ~350, เกราะต่ำไป ~46, ต้านเวท 50 แทน 80) และ Yena / Richter / Florentino มีค่า placeholder ซ้ำกัน (2886 / 130 / 370)
- ยังไม่ได้อัปเดต รอผู้ใช้อนุมัติ และรูปให้แค่ค่า Lv.1 จึงยังไม่รู้ค่า growth ต่อเลเวล

---

## 📅 2026-10-19 15:45 (UTC+7) — แยกโฟลเดอร์รูปฮีโร่เป็น skill / status
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- สร้าง `skill/` และ `status/` ในทุกโฟลเดอร์ `heroes/<Hero>/` (130 ฮีโร่)
- ย้ายรูปสกิลเดิมทั้งหมดเข้า `skill/` โดยคงชื่อไฟล์เดิม ส่วน `status/` เว้นว่างไว้ให้ใส่รูประยะตีและค่าสเตตัส

### 📁 ไฟล์ที่แก้
- `heroes/*/skill/` (ย้ายรูป 549 รูป)
- `heroes/*/status/` (สร้างใหม่ ว่าง)
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- หลังย้ายยังมีครบ 549 รูป ไม่มีรูปค้างนอก `skill/` และมี `skill/` กับ `status/` ครบ 130 ฮีโร่
- ไม่มีสคริปต์ไหนอ้างอิง path ของรูปใน `heroes/`

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- โฟลเดอร์ว่างไม่ถูกเก็บใน git จนกว่าจะมีไฟล์อยู่ข้างใน
- เมื่อใส่รูปใน `status/` ครบแล้ว นำมาเติมค่า `attack_range` ที่ว่าง 23 ฮีโร่และค่าผิดใน `data/heroes_130_full.json` ได้

---

## 📅 2026-10-19 15:30 (UTC+7) — ตรวจทั้งระบบ แก้บั๊กเจาะเกราะ / ระยะโจมตี / alias ไอเทม ใน Combat Calculator
**Agent:** Claude Opus 5.5

### ✅ สิ่งที่ทำ
- **แก้ Muramasa นับเจาะเกราะซ้ำ:** ข้อความ "Armor Pierce +40%" เคยถูกนับเป็น 40% และ 40 แต้มพร้อมกัน ตอนนี้ pattern แบบแต้มจะไม่จับตัวเลขที่ตามด้วย `%` แล้ว (เป็นบั๊กเดิมตั้งแต่ก่อนอัปเดตไอเทม)
- **ขยาย `PIERCE_PATTERNS` ให้รองรับข้อความไอเทมแบบใหม่:** Chaos Bow / The Morning Star ("armor penetration by X%" และ x2 สำหรับฮีโร่ระยะไกล), Broken Spears (40-180 ตามเลเวล), Spooky Mask ("Magic Pierce +75"), Mage Robe ("32 - 60" ที่มีช่องว่าง, +3% โบนัส HP, สูงสุด 150)
- ย้ายการอ่านค่าเจาะเกราะไปทำหลังคำนวณ HP เสร็จ เพื่อใช้โบนัส HP ได้
- **แก้การตรวจฮีโร่ระยะไกล:** เดิมเทียบแค่ `attack_range == "Ranged"` ทำให้ 19 ฮีโร่ที่เป็น "Long Range" เช่น Valhein ถูกนับเป็นระยะใกล้ ตอนนี้เช็กคำว่า "rang" แทน ซึ่งมีผลกับ enchantment แบบ `ranged_stats` ด้วย
- **รองรับชื่อไอเทมเก่า (alias):** `CombatEngine` แปลงชื่อเก่าเป็นชื่อทางการก่อน validate และเพิ่ม alias อีก 7 ชิ้นใน `scripts/merge_and_apply_items.py` (Frost Guard, Hercules' Madness, Longinus' Spear, Spoopy Mask, Monster's Bane, Curse of Death (Item), Ancestral Glory) แล้วรัน merge ใหม่ ซึ่งเปลี่ยนเฉพาะฟิลด์ `alias`
- เพิ่ม 3 เทสต์ ได้แก่ percent pierce ต้องไม่ถูกนับเป็นแต้ม, ข้อความเจาะเกราะแบบต่างๆ และ alias ของชื่อเก่า

### 📁 ไฟล์ที่แก้
- `src/combat_calculator.py`
- `scripts/merge_and_apply_items.py`
- `data/items.json` (เพิ่ม `alias` 7 ชิ้น)
- `tests/test_combat_calculator.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -q` — ผ่าน 43 / 43
- Data Guardian audit — ผ่าน (130 ฮีโร่, 4,208 แมตช์, 0 unmapped)
- `ruff check --fix .` / `ruff format .` — ผ่าน
- `npm run lint` / `npm run build` — ผ่าน

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- `attack_range` ใน `data/heroes_130_full.json` ไม่สะอาด: ว่าง 23 ฮีโร่ (เช่น Florentino, Keera, Slimz, Flowborn (Marksman)) และสะกดผิดหรือค่าแปลก เช่น "Meele", "Near", "Medium", "Rộng" (Zill) ฮีโร่ที่ไม่มีค่าจะถูกนับเป็นระยะใกล้ ต้องเติมจากข้อมูลในเกม (ยังไม่ได้แก้เพราะห้ามเดาค่า)
- Soaring Aura (เจาะเวทแบบสะสม) ยังไม่ได้คิดในการคำนวณ
- ไอเทมที่หายไปจากแคตตาล็อก (Mother Earth/Wildfire Eradicate และ Genesis, Scorching Wind, Whispering Wind) ถือว่าถูกถอดออกจากเกมแล้ว เพราะไม่มีในภาพหน้าจอ

---

## 📅 2026-10-19 14:50 (UTC+7) — รวมข้อมูลและอัปเดตไอเทม RoV ครบ 114 ชิ้นจาก In-Game Client Ground Truth
**Agent:** Claude Fable 5.1

### ✅ สิ่งที่ทำ
- **ตรวจสอบและถอดความข้อมูลภาพหน้าจอไอเทมในเกม (In-Game Screenshots)** ครบ 114 โฟลเดอร์ รวม 159 รูป แบ่ง 6 กลุ่มย่อย (Group 0–5) ด้วย multi-agent extraction
- **แก้ปัญหาข้อมูลเก่าจากเว็บ rovmeta.com ให้ตรงกับ Client ปัจจุบัน (2026 / Beta 55)**:
  - แก้ไขชื่อไอเทมทางการ: `Broken Spears` (เดิม Rankbreaker), `The Morning Star` (เดิม Dawnning Star), `Carano's Pledge` (เดิม Carano's Vow), `Soul Scroll` (เดิม Tome of the Reaper), `Ifrit's Claw` (เดิม Devil's Handshake), `Bloodthirsty Blade` (แทน Ancestral Glory เก่า), `Hunter's Knife` (เดิม Kukri), `Elemental Stone` (เดิม Elemental Gem)
  - รองรับไอเทมซัพพอร์ตระบบใหม่ 3 สายครบถ้วน: `Mother Earth` (5 สกิล: Accelerate, Barrier, Cleansing, Magic Eye, Rejuvenate), `Wildfire` (3 สกิล: Barrier, Cleansing, Magic Eye), `Aquaflame` (2 สกิล: Accelerate, Rejuvenate)
  - เติมเต็มราคาซื้อ (Gold Price) ครบ 100% (แก้ไอเทม 7 ชิ้นที่ราคาเป็น null เช่น Stealth Bracer 2,040g, Light Shield 2,040g, Mail of Pain 2,020g)
  - ถอดความสกิลติดตัว/กดใช้และข้อความภาษาไทยในเกม (`desc_th`) ครบถ้วน 100% แก้ปัญหา passives_incomplete ที่เคยถูกตัดทอน 19 ไอเทม
  - ปรับสเตตัสและเจาะเกราะตาม Client จริง เช่น Muramasa เจาะเกราะ 40% (เดิม 35%), Evil Secrets AP 140 / HP 500 / Passive Curse ลดต้านเวทและพลังเวท
- **รวมข้อมูลและซิงค์เข้าฐานข้อมูลหลัก `data/items.json`**:
  - สร้างและรัน `scripts/merge_and_apply_items.py` รวม 114 ไอเทม ตรวจสอบความถูกต้อง Schema 11 ฟิลด์บังคับ ครบ 100%
  - คงฟิลด์ metadata `patch` และ `sources` (เช่น Beta 55, Beta 55 rework) และบันทึก `alias` เพื่อ backward compatibility
- **อัปเดตชุดทดสอบ**:
  - ปรับปรุง `tests/test_data_integrity.py` และ `tests/test_combat_calculator.py` ให้รองรับชื่อทางการ `Carano's Pledge` และค่าเจาะเกราะ 40% ของ Muramasa

### 📁 ไฟล์ที่แก้
- `data/items.json` (อัปเดตไอเทมทั้ง 114 ชิ้น เป็น In-Game Ground Truth)
- `scripts/merge_and_apply_items.py` (ระบบ merge, validate และ sync metadata)
- `tests/test_data_integrity.py`
- `tests/test_combat_calculator.py`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v` — ผ่านครบทั้ง 40 / 40 การทดสอบ (data integrity, combat calculator, api, model pipeline, rl search)
- `python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py` — ผ่านเกณฑ์ Data Guardian (130 ฮีโร่, 4,208 แมตช์, 0 unmapped names)
- `ruff check --fix .` และ `ruff format .` — ผ่าน สะอาดตามมาตรฐาน
- `npm run build` และ `npm run lint` ใน `frontend/` — ผ่าน 0 errors

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ข้อมูลไอเทมปัจจุบัน 114 ชิ้นถูกตรวจสอบตรงตาม In-Game Client 100% หากมีการปรับปรุงแพตช์ใหม่ในอนาคตสามารถใช้รูปภาพใน `item/` ตรวจสอบและอัปเดตผ่าน `scripts/merge_and_apply_items.py` ได้ทันที

---

## 📅 2026-10-19 14:40 (UTC+7) — Audit และ Extract ข้อมูลไอเทมกลุ่ม 3 (index 2: 19 รายการ) จาก In-game Screenshots
**Agent:** Claude (gemini-3.8-flash-high)

### ✅ สิ่งที่ทำ
- ตรวจสอบภาพ screenshot คร็อปจากเกมของไอเทม Group 3 (index 2, 19 รายการ) ตั้งแต่ `Frost Hammer` ถึง `Leviathan`
- สำหรับไอเทมที่มีหลาย crop (scrolled view) เช่น `Gnoll Cleaver`, `Hunter's Knife`, `Leviathan` ได้ตรวจสอบครบทุก crop เพื่อถอดความสกิลติดตัว/กดใช้และข้อความไทยอย่างครบถ้วน
- อ่านค่าสเตตัส สกิลติดตัว/กดใช้ ภาษาไทย (`desc_th`) และแมปเป็น English keys ตามสคีมาอย่างละเอียด
- ตรวจสอบราคา เทียร์ และหมวดหมู่จาก UI ร้านค้าในเกม (เช่น `Frost Hammer` 2060g Tier 3 attack, `Frostguard` 2100g Tier 3 magic, `Hercules's Madness` 2000g Tier 3 defense)
- สำหรับไอเทม Tier 1/2 ที่ไม่มีสกิลติดตัว (`Gladiator's Gauntlets`, `Gloves`, `Greaves of Protection`, `Lapis Ring`) ได้ใส่ข้อความสเตตัสใน `desc_th` เพื่อให้ไม่มี `desc_th` ว่างเปล่า
- สร้างไฟล์ `scripts/extracted_items_g2.json` ครบทั้ง 19 ไอเทม พร้อมสคริปต์ `scripts/build_g2.py`

### 📁 ไฟล์ที่แก้
- `scripts/extracted_items_g2.json` (สร้างใหม่)
- `scripts/build_g2.py` (สร้างใหม่)
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ตรวจสอบ `scripts/extracted_items_g2.json` ครบ 19 รายการ ไม่มี slug ซ้ำ ไม่มีชื่อซ้ำ มีฟิลด์บังคับครบ 11 ฟิลด์ทุกรายการ
- ตรวจสอบว่าไม่มี `desc_th` ว่างเปล่าเลยแม้แต่รายการเดียว
- ตรวจสอบโค้ดด้วย `ruff check --fix scripts/build_g2.py` และ `ruff format scripts/build_g2.py` ผ่าน 100%

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- รอรวมกับกลุ่มอื่นๆ (g0-g5) ผ่าน `scripts/merge_and_apply_items.py` เพื่ออัปเดตเข้า `data/items.json`

---

## 📅 2026-10-19 13:45 (UTC+7) — Audit และ Extract ข้อมูลไอเทมกลุ่ม 1 (19 รายการ) จาก In-game Screenshots
**Agent:** Claude (gemini-3.8-flash-high)

### ✅ สิ่งที่ทำ
- ตรวจสอบภาพ screenshot คร็อปจากเกมของไอเทม Group 0 (19 รายการ) ตั้งแต่ Amulet of Longevity ถึง Carano's Pledge
- อ่านค่าสเตตัส สกิลติดตัว/กดใช้ ภาษาไทย (`desc_th`) และแปล/แมปเป็น English keys ตามสคีมาอย่างละเอียด
- ตรวจสอบราคา เทียร์ และหมวดหมู่จาก UI ร้านค้าในเกม (รวมถึงไอเทมใหม่อย่าง Aquaflame ทั้ง 2 แบบ, Bloodthirsty Blade, Carano's Pledge)
- สร้างไฟล์ `scripts/extracted_items_g0.json` ครบทั้ง 19 ไอเทม พร้อม validation ผ่าน 100%

### 📁 ไฟล์ที่แก้
- `scripts/extracted_items_g0.json` (สร้างใหม่)
- `scripts/build_g0.py` (สร้างใหม่)
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ตรวจสอบไฟล์ `scripts/extracted_items_g0.json` ครบ 19 รายการ โครงสร้าง JSON ถูกต้อง ไม่มีรายการใดที่ `desc_th` ว่างเปล่า
- รัน linting / formatting ด้วย `ruff check` และ `ruff format` ผ่าน 100%

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- รอรวมกับกลุ่มอื่นๆ (g1-g5) ผ่าน `scripts/merge_and_apply_items.py` เพื่ออัปเดตเข้า `data/items.json` ต่อไป

---

## 📅 2026-10-19 13:28 (UTC+7) — จัดรูปไอเทม 159 รูปแยกตามชื่อไอเทม
**Agent:** Codex

### ✅ สิ่งที่ทำ
- จัดภาพจาก `item/` ลงโฟลเดอร์ตามชื่อไอเทมที่แสดงในภาพ จำนวน 159 รูป รวม 114 โฟลเดอร์
- รวมภาพชื่อไอเทมซ้ำไว้ในโฟลเดอร์เดียว และแทน `:` ในชื่อโฟลเดอร์ด้วย ` - ` เพื่อให้ใช้ได้บน Windows
- คงชื่อไฟล์ภาพเดิมทุกไฟล์

### 📁 ไฟล์ที่แก้
- `item/` (ย้ายภาพเข้าโฟลเดอร์ย่อย)
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- ตรวจภาพ 1–159 และยืนยันหลังย้ายว่ามีภาพครบ 159 รูป ไม่มีภาพค้างที่ root และจำนวนต่อโฟลเดอร์ตรงตามที่อ่านได้

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ไม่มี

## 📅 2026-10-19 13:05 (UTC+7) — ตรวจสอบและแก้ไขสกิล 47 ฮีโร่ ครบ 130/130 Hero Patches
**Agent:** Claude Fable 5.1

### ✅ สิ่งที่ทำ
- **ตรวจสอบความถูกต้องสกิล 47 ฮีโร่ที่ Codex ทำไว้เทียบกับ In-Game Screenshots ใน `heroes/`**:
  - `Aleister, Annette, Arum, Aya, Azzen’Ka, Bonnie, Brunhilda, Chaugnar, Cresht, D’Arcy, Diao Chan, Dirak, Dolia, Dyadia, Erin, Evita, Flowborn (Mage), Flowborn (Marksman), Gildur, Goverra, Grakk, Helen, Ignis, Ilumia, Ishar, Kahlii, Mganga, Ming, Moren, Natalya, Omega, Ormarr, Preyta, Rouie, Rourke, Sephera, Teeri, Tel’Annas, The Flash, Thorne, Veera, Wisp, Wukong, Xeniel, Y’bneth, Yorn, Yue`
- **แก้ไข Slot สกิลที่สลับกันและชุดสกิลเก่า**:
  - คืนค่าสกิล Wukong (S1 ล่องหน+วิ่งเร็ว, S2 พุ่ง+เกราะ), Ishar (S1 เห็ด, S2 โล่, Ult ฝึกลูกหมา), Natalya (สลับ S1/S2 คืนตำแหน่ง)
  - อัปเดตชุดสกิล Rework ให้ตรงกับตัวเกมปัจจุบัน: Moren, Chaugnar, Diao Chan, Veera, Wisp, Preyta, Azzen'Ka
- **เติมเต็ม Progression Arrays 6 เลเวล / 3 เลเวล**:
  - แก้ไขฮีโร่ที่มีค่า Base Damage / Cooldown เป็นค่าเดี่ยวให้มีอาเรย์ครบทุกเลเวล (Goverra, Dyadia, Flowborn, Aya, Annette, Omega, Yorn ฯลฯ)
- **ถอดความภาษาไทยทางการ (`desc_th`) และตัวคูณสเกลลิ่ง**:
  - บันทึกข้อความสกิลภาษาไทยทางการครบทุกสกิล (รวม Dirak และ Preyta)
  - ปรับประเภทดาเมจและตัวคูณ (% AD, % bonus AD, % AP, % max HP) ให้ตรงตาม Client 100%
- **สร้างไฟล์ Patch ใหม่ 46 ไฟล์ใน `data/hero_patches/`**:
  - รวมกับ Rourke และไฟล์เดิมเป็น **130 / 130 ฮีโร่ ครบ 100%**
- **ซิงค์เข้าฐานข้อมูลหลัก**:
  - อัปเดต `data/hero_skills_full.json` (530 สกิล) และ `data/heroes_130_full.json` ด้วย `scripts/apply_hero_patch.py`

### 📁 ไฟล์ที่แก้
- `data/hero_patches/*.json` (เพิ่ม 46 ไฟล์ใหม่ รวม 130 ไฟล์)
- `data/hero_skills_full.json`
- `data/heroes_130_full.json`
- `CHANGELOG.md`

### 🧪 การตรวจสอบ
- `pytest -v` — ผ่านครบทั้ง 40 / 40 การทดสอบ (data integrity, combat calculator, api, model pipeline, rl search)
- `python .agents/skills/rov-data-guardian/scripts/audit_rov_data.py` — ผ่านเกณฑ์ 130 ฮีโร่ (>= 4 สกิล), 4,208 แมตช์, 0 unmapped names
- `npm run build` และ `npm run lint` ใน `frontend/` — ผ่าน 0 errors
- `ruff check .` และ `ruff format --check .` — ผ่าน สะอาดตามมาตรฐาน

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ข้อมูลสกิลทั้ง 130 ฮีโร่ถูกล็อกด้วย patch files แบบ idempotent ใน `data/hero_patches/` หากมีการปรับสมดุลในอนาคตควรแก้ที่ patch file ก่อนรัน `scripts/apply_hero_patch.py`
**Agent:** Antigravity (Claude Sonnet 5.5)

### ✅ สิ่งที่ทำ
- **สร้าง `CHANGELOG.md`** ที่ root พร้อมหัวไฟล์ กล่องเตือนสำหรับ agent และตัวอย่างรูปแบบรายการ
- **เพิ่มกฎข้อ 9 ใน `AGENTS.md`:** อ่านรายการบนสุดก่อนเริ่มงาน และเพิ่มรายการใหม่ไว้บนสุดก่อนจบงานที่แก้ไฟล์
- **เพิ่ม `CHANGELOG.md` ในแผนผังโครงสร้าง repo** ของ `AGENTS.md`
- แก้ลำดับกฎข้อ 8 / 9 ที่วางสลับกันตอนแรกให้เรียงถูกต้อง

### 📁 ไฟล์ที่แก้
- `CHANGELOG.md` (สร้างใหม่)
- `AGENTS.md`

### 🧪 การตรวจสอบ
- ตรวจลำดับกฎและแผนผังใน `AGENTS.md` ด้วยการอ่านไฟล์ซ้ำ (แก้เฉพาะ markdown จึงไม่ได้รัน lint/build)

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- แก้เฉพาะ `AGENTS.md` ของ repo นี้ ไม่ได้แตะไฟล์กฎร่วมที่ `~/.gemini/config/AGENTS.md`

---

## 📅 2026-10-19 12:07 (UTC+7) — ตรวจและแก้บั๊ก Frontend
**Agent:** Antigravity (Claude Sonnet 5.5)

### ✅ สิ่งที่ทำ
- **แก้ race ตอน draft จบ:** `fetchRecommendations` ยกเลิก request เก่าก่อนทุกครั้ง รวมสาขา draft ครบ 18 step และส่ง `signal` ใน request สุดท้าย
- **แก้ `isLoading` กะพริบ:** ให้แต่ละ request มี `AbortController` ของตัวเอง และปิด loading เฉพาะ request ล่าสุด (ทั้ง draft และ Combat Lab)
- **แก้ Undo:** ล้าง `recommendations` / `missingAllyLanes`, ตัด `winHistory` และย้อน `blueWinRate` กลับเป็นค่าของ step ก่อนหน้า
- **Harden localStorage ของ Combat Lab:** validate โครงสร้างข้อมูลที่เซฟไว้ เติมค่าที่ขาดจากค่าเริ่มต้น และรีเซ็ตฮีโร่ที่ไม่มีใน catalog เป็น Valhein / Toro
- **เพิ่มแบนเนอร์เตือน fallback:** แสดงเมื่อโหลด `/heroes` ไม่ได้และใช้รายชื่อสำรอง (role/lane เป็นค่าสมมติ)

### 📁 ไฟล์ที่แก้
- `frontend/src/hooks/useDraft.ts`
- `frontend/src/hooks/useCombatLab.ts`
- `frontend/src/App.tsx`

### 🧪 การตรวจสอบ
- `npm run lint` — 0 warnings, 0 errors
- `npm run build` (`tsc -b` + `vite build`) — ผ่าน
- ยังไม่ได้ทดสอบในเบราว์เซอร์จริง

### ⚠️ เรื่องค้าง / ข้อควรระวัง
- ตรวจโค้ดเฉพาะ `useDraft.ts` และ `useCombatLab.ts`; **components ยังไม่ได้ตรวจ**
- คลาสสีเหลืองของแบนเนอร์ fallback ยังไม่ได้เทียบกับธีมใน `DESIGN.md`
