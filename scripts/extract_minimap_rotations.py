"""RoV Pro Minimap & 10-Hero Rotation Tracker with Sidebars & Ultimate Status.

Features:
- Samples every 5 seconds.
- Crops Minimap (240x240, flush x=0).
- Crops Left Sidebar (Blue 5 heroes: HP, Death, Ultimate status).
- Crops Right Sidebar (Red 5 heroes: HP, Death, Ultimate status).
- Combines into a single 530x270 Composite HUD card per snapshot.
- Filters out static towers from minimap circle detection.
- Tracks 10 heroes with alive/dead and ultimate readiness flags.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

# 5 heroes ordered by spectator vertical sidebar slots (top to bottom)
BLUE_HEROES = ["Ryoma", "Tamyn", "Raz", "Violet", "TeeMee"]
RED_HEROES = ["Qi", "Astrid", "Iggy", "Eland'orr", "Y'bneth"]

BLUE_FOUNTAIN = (25, 215)
RED_FOUNTAIN = (215, 25)

# Known static tower coordinates on 240x240 minimap
TOWERS = [
    # Blue towers
    (25, 215),
    (47, 199),
    (93, 199),
    (16, 192),
    (34, 171),
    (6, 158),
    (62, 148),
    (76, 122),
    (4, 119),
    (4, 65),
    # Red towers
    (215, 25),
    (195, 45),
    (149, 14),
    (103, 15),
    (189, 56),
    (162, 43),
    (135, 65),
    (192, 93),
    (181, 27),
]

INITIAL_POSITIONS = {
    "Ryoma": (35, 195),
    "Tamyn": (55, 175),
    "Raz": (65, 185),
    "Violet": (85, 215),
    "TeeMee": (75, 220),
    "Qi": (195, 45),
    "Astrid": (175, 65),
    "Iggy": (165, 55),
    "Eland'orr": (155, 25),
    "Y'bneth": (165, 20),
}


def build_tower_mask(width: int = 240, height: int = 240, radius: int = 12) -> np.ndarray:
    """Mask to exclude fixed static towers from moving hero detection."""
    mask = np.zeros((height, width), dtype=np.uint8)
    for tx, ty in TOWERS:
        cv2.circle(mask, (tx, ty), radius, 255, -1)
    # Mask out outer 6px map frame border
    mask[:6, :] = 255
    mask[-6:, :] = 255
    mask[:, :6] = 255
    mask[:, -6:] = 255
    return mask


def classify_minimap_zone(x: int, y: int, map_w: int = 240, map_h: int = 240) -> str:
    """Classify (x, y) into RoV Antaris Battlefield tactical zones."""
    nx = x / float(map_w)
    ny = y / float(map_h)

    if nx < 0.22 and ny > 0.78:
        return "Blue_Base"
    if nx > 0.78 and ny < 0.22:
        return "Red_Base"

    diag_dist = ny - (1.0 - nx)
    if diag_dist < -0.28:
        return "DS_Lane (Dark Slayer Lane)"
    elif diag_dist > 0.28:
        return "AD_Lane (Abyssal Dragon Lane)"
    elif abs(diag_dist) <= 0.12 and 0.30 <= nx <= 0.70:
        return "Mid_Lane"
    elif nx < 0.50:
        return "Blue_Jungle"
    else:
        return "Red_Jungle"


def detect_sidebar_status_and_ult(
    frame: np.ndarray,
) -> tuple[dict[str, dict], dict[str, dict]]:
    """Detect alive/dead status AND Ultimate readiness for Blue and Red heroes."""
    blue_info: dict[str, dict] = {}
    red_info: dict[str, dict] = {}

    for i in range(5):
        y_start = 280 + i * 54
        y_end = y_start + 54

        # Blue slot (left sidebar)
        slot_l = frame[y_start:y_end, 0:130]
        hsv_l = cv2.cvtColor(slot_l, cv2.COLOR_BGR2HSV)
        green_hp_l = np.sum(
            (hsv_l[:, :, 0] >= 40) & (hsv_l[:, :, 0] <= 80) & (hsv_l[:, :, 1] >= 60) & (hsv_l[:, :, 2] >= 120)
        )
        ult_gem_l = np.sum(
            (hsv_l[:, :, 0] >= 35) & (hsv_l[:, :, 0] <= 85) & (hsv_l[:, :, 1] >= 110) & (hsv_l[:, :, 2] >= 160)
        )
        is_alive_l = bool(green_hp_l >= 40)
        blue_hero = BLUE_HEROES[i]
        blue_info[blue_hero] = {
            "status": "ALIVE" if is_alive_l else "DEAD",
            "ult_ready": bool(is_alive_l and ult_gem_l >= 15),
        }

        # Red slot (right sidebar)
        slot_r = frame[y_start:y_end, 1150:1280]
        hsv_r = cv2.cvtColor(slot_r, cv2.COLOR_BGR2HSV)
        green_hp_r = np.sum(
            (hsv_r[:, :, 0] >= 40) & (hsv_r[:, :, 0] <= 80) & (hsv_r[:, :, 1] >= 60) & (hsv_r[:, :, 2] >= 120)
        )
        ult_gem_r = np.sum(
            (hsv_r[:, :, 0] >= 35) & (hsv_r[:, :, 0] <= 85) & (hsv_r[:, :, 1] >= 110) & (hsv_r[:, :, 2] >= 160)
        )
        is_alive_r = bool(green_hp_r >= 40)
        red_hero = RED_HEROES[i]
        red_info[red_hero] = {
            "status": "ALIVE" if is_alive_r else "DEAD",
            "ult_ready": bool(is_alive_r and ult_gem_r >= 15),
        }

    return blue_info, red_info


def detect_moving_hero_circles(
    minimap_bgr: np.ndarray,
    tower_mask: np.ndarray,
) -> tuple[list[tuple[int, int, float]], list[tuple[int, int, float]]]:
    """Detect moving hero circles on minimap using calibrated HSV masks and connected components."""
    hsv = cv2.cvtColor(minimap_bgr, cv2.COLOR_BGR2HSV)
    valid_terrain = tower_mask == 0

    # Blue hero ring in HSV
    blue_mask = (
        (hsv[:, :, 0] >= 100) & (hsv[:, :, 0] <= 130) & (hsv[:, :, 1] > 95) & (hsv[:, :, 2] > 110) & valid_terrain
    )
    # Red hero ring in HSV
    red_mask = (
        ((hsv[:, :, 0] <= 10) | (hsv[:, :, 0] >= 170)) & (hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 100) & valid_terrain
    )

    def extract_hero_blobs(mask_bin: np.ndarray) -> list[tuple[int, int, float]]:
        num, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_bin.astype(np.uint8))
        blobs: list[tuple[int, int, float]] = []
        for idx in range(1, num):
            area = stats[idx, cv2.CC_STAT_AREA]
            w = stats[idx, cv2.CC_STAT_WIDTH]
            h = stats[idx, cv2.CC_STAT_HEIGHT]
            if area >= 18 and w >= 5 and h >= 5:
                cx, cy = centroids[idx]
                radius = float(np.hypot(w, h) / 2.0)
                blobs.append((int(round(cx)), int(round(cy)), radius))
        return blobs

    return extract_hero_blobs(blue_mask), extract_hero_blobs(red_mask)


def update_team_trajectories(
    team_heroes: list[str],
    current_info: dict[str, dict],
    prev_positions: dict[str, tuple[int, int]],
    prev_status: dict[str, str],
    detected_circles: list[tuple[int, int, float]],
    fountain_pos: tuple[int, int],
) -> dict[str, tuple[int, int]]:
    """Assign detected circle coordinates to alive heroes using optimal bipartite matching."""
    updated: dict[str, tuple[int, int]] = {}
    alive_heroes: list[str] = []

    for h in team_heroes:
        st = current_info[h]["status"]
        was_dead = prev_status.get(h, "ALIVE") == "DEAD"

        if st == "DEAD":
            updated[h] = prev_positions.get(h, fountain_pos)
        else:
            if was_dead:
                prev_positions[h] = fountain_pos
            alive_heroes.append(h)

    if not alive_heroes:
        return updated

    circle_coords = [(c[0], c[1]) for c in detected_circles]

    if circle_coords:
        n_heroes = len(alive_heroes)
        n_circles = len(circle_coords)

        cost_matrix = np.zeros((n_heroes, n_circles), dtype=np.float32)
        for i, h in enumerate(alive_heroes):
            hx, hy = prev_positions.get(h, fountain_pos)
            for j, (cx, cy) in enumerate(circle_coords):
                cost_matrix[i, j] = np.hypot(hx - cx, hy - cy)

        row_ind, col_ind = linear_sum_assignment(cost_matrix)
        for r, c in zip(row_ind, col_ind):
            h = alive_heroes[r]
            dist = cost_matrix[r, c]
            if dist <= 55.0 or prev_positions.get(h) == fountain_pos:
                updated[h] = circle_coords[c]
            else:
                updated[h] = prev_positions.get(h, fountain_pos)

        for h in alive_heroes:
            if h not in updated:
                updated[h] = prev_positions.get(h, fountain_pos)
    else:
        for h in alive_heroes:
            updated[h] = prev_positions.get(h, fountain_pos)

    return updated


def process_5s_match_rotations(
    video_path: Path,
    output_dir: Path,
    sample_interval_sec: int = 5,
    minimap_crop: tuple[int, int, int, int] = (36, 276, 0, 240),
) -> dict:
    """Extract continuous 5-second rotation snapshots with sidebars and composite HUD."""
    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "minimap_5s"
    frames_dir.mkdir(exist_ok=True)

    sidebars_dir = output_dir / "sidebars_5s"
    sidebars_dir.mkdir(exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_sec = total_frames / fps

    print(f"Opened video: {video_path.name} ({duration_sec:.1f}s)")
    y1, y2, x1, x2 = minimap_crop
    mw = x2 - x1
    mh = y2 - y1

    tower_mask = build_tower_mask(mw, mh)
    current_positions = dict(INITIAL_POSITIONS)
    prev_blue_status = {h: "ALIVE" for h in BLUE_HEROES}
    prev_red_status = {h: "ALIVE" for h in RED_HEROES}

    sample_secs = list(range(5, int(duration_sec), sample_interval_sec))
    print(f"Processing {len(sample_secs)} snapshots at {sample_interval_sec}s frequency with sidebars & ultimates...")

    timeline: list[dict] = []

    for sec in sample_secs:
        frame_idx = int(sec * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            continue

        minimap = frame[y1:y2, x1:x2]
        left_bar = frame[280:550, 0:130]
        right_bar = frame[280:550, 1150:1280]

        # 1. Detect sidebar alive/dead status AND Ultimate readiness
        blue_info, red_info = detect_sidebar_status_and_ult(frame)

        # 2. Detect moving circles (excluding towers)
        blue_circles, red_circles = detect_moving_hero_circles(minimap, tower_mask)

        # 3. Update trajectories
        blue_pos = update_team_trajectories(
            BLUE_HEROES,
            blue_info,
            current_positions,
            prev_blue_status,
            blue_circles,
            BLUE_FOUNTAIN,
        )
        red_pos = update_team_trajectories(
            RED_HEROES,
            red_info,
            current_positions,
            prev_red_status,
            red_circles,
            RED_FOUNTAIN,
        )

        current_positions.update(blue_pos)
        current_positions.update(red_pos)
        prev_blue_status = {h: blue_info[h]["status"] for h in BLUE_HEROES}
        prev_red_status = {h: red_info[h]["status"] for h in RED_HEROES}

        # 4. Save clean minimap image and sidebars
        img_filename = f"map_{sec:04d}s.jpg"
        cv2.imwrite(str(frames_dir / img_filename), minimap, [cv2.IMWRITE_JPEG_QUALITY, 85])

        # Composite HUD: [Left Bar (130px) | Minimap resized (270x270) | Right Bar (130px)] -> 530x270 px
        minimap_270 = cv2.resize(minimap, (270, 270), interpolation=cv2.INTER_LANCZOS4)
        composite_hud = np.hstack([left_bar, minimap_270, right_bar])
        composite_filename = f"hud_{sec:04d}s.jpg"
        cv2.imwrite(str(sidebars_dir / composite_filename), composite_hud, [cv2.IMWRITE_JPEG_QUALITY, 85])

        # 5. Draw annotated minimap
        annotated = minimap.copy()
        snapshot_positions: dict[str, dict] = {}

        for hero in BLUE_HEROES:
            x, y = current_positions[hero]
            st = blue_info[hero]["status"]
            ult = blue_info[hero]["ult_ready"]
            zone = classify_minimap_zone(x, y, mw, mh)
            snapshot_positions[hero] = {
                "team": "blue",
                "status": st,
                "ult_ready": ult,
                "x": int(x),
                "y": int(y),
                "zone": zone,
            }
            if st == "ALIVE":
                color = (0, 255, 120) if ult else (255, 120, 0)
                cv2.circle(annotated, (x, y), 8, color, 2)
                cv2.putText(
                    annotated,
                    hero[:3] + ("*" if ult else ""),
                    (x - 9, y - 9),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.30,
                    color,
                    1,
                )
            else:
                cv2.drawMarker(
                    annotated,
                    (x, y),
                    (100, 100, 100),
                    cv2.MARKER_TILTED_CROSS,
                    8,
                    1,
                )

        for hero in RED_HEROES:
            x, y = current_positions[hero]
            st = red_info[hero]["status"]
            ult = red_info[hero]["ult_ready"]
            zone = classify_minimap_zone(x, y, mw, mh)
            snapshot_positions[hero] = {
                "team": "red",
                "status": st,
                "ult_ready": ult,
                "x": int(x),
                "y": int(y),
                "zone": zone,
            }
            if st == "ALIVE":
                color = (0, 255, 255) if ult else (0, 60, 255)
                cv2.circle(annotated, (x, y), 8, color, 2)
                cv2.putText(
                    annotated,
                    hero[:3] + ("*" if ult else ""),
                    (x - 9, y - 9),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.30,
                    color,
                    1,
                )
            else:
                cv2.drawMarker(
                    annotated,
                    (x, y),
                    (100, 100, 100),
                    cv2.MARKER_TILTED_CROSS,
                    8,
                    1,
                )

        annotated_filename = f"tracked_{sec:04d}s.jpg"
        cv2.imwrite(str(frames_dir / annotated_filename), annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])

        min_part = sec // 60
        sec_part = sec % 60
        time_str = f"{min_part:02d}:{sec_part:02d}"

        timeline.append(
            {
                "time_sec": sec,
                "time_str": time_str,
                "minimap_image": f"minimap_5s/{img_filename}",
                "tracked_image": f"minimap_5s/{annotated_filename}",
                "composite_hud": f"sidebars_5s/{composite_filename}",
                "positions": snapshot_positions,
            }
        )

    cap.release()

    result = {
        "match": "Full Sense vs Tenacity - Game 1 (RPL 2026 Winter Week 6 Day 3)",
        "sample_interval_sec": sample_interval_sec,
        "total_snapshots": len(timeline),
        "blue_team": {"name": "Full Sense (FS)", "heroes": BLUE_HEROES},
        "red_team": {"name": "Tenacity (TEN)", "heroes": RED_HEROES},
        "timeline": timeline,
    }

    report_path = output_dir / "rotations_5s.json"
    report_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Successfully saved {len(timeline)} 5-second snapshots with sidebars & ultimates -> {report_path}")
    return result


if __name__ == "__main__":
    vid = Path("data/vod_analytics/fs_vs_ten_game1.mp4")
    out = Path("data/vod_analytics/fs_vs_ten_game1")
    if vid.exists():
        process_5s_match_rotations(vid, out, sample_interval_sec=5)
    else:
        print(f"Video {vid} not found.")
