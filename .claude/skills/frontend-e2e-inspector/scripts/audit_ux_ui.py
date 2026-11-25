#!/usr/bin/env python3
"""RoV Frontend UX/UI & Interactive E2E Playwright Auditor.

Verifies responsive layouts (375x667, 390x844, 768x1024, 1280x800),
WCAG 2.2 AA touch target sizes (>= 24px), zero horizontal overflow,
portal ConfirmDialog stacking (no native window.confirm/alert),
mobile modal ergonomics (no auto-focused inputs, visible footer),
and explicit side control (no auto side-swap on game finish).

Usage:
    python .agents/skills/frontend-e2e-inspector/scripts/audit_ux_ui.py
"""

from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import uvicorn
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _wait_for_health(base_url: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=2) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {base_url}/health")


def _audit_viewport_metrics(page) -> tuple[bool, list[dict]]:
    return page.evaluate(
        """() => {
            const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
            const els = Array.from(document.querySelectorAll('button, a, select'));
            const undersized = [];
            for (const el of els) {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                if (r.height < 23.5 || r.width < 23.5) {
                    undersized.push({
                        tag: el.tagName,
                        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40),
                        w: Math.round(r.width * 10) / 10,
                        h: Math.round(r.height * 10) / 10,
                    });
                }
            }
            return [overflowX, undersized];
        }"""
    )


def _audit_menu_and_dom_clipping(page, check_en_leaks: bool = False) -> dict:
    return page.evaluate(
        """(checkEnLeaks) => {
            const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1;
            const clipY = [];
            const escapeBox = [];
            const enLeaks = [];

            for (const el of document.querySelectorAll('button, a, [role="tab"], span, div, p, li, h1, h2, h3, label')) {
                const cs = window.getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true') continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;

                if (
                    (cs.overflowY === 'hidden' || cs.webkitLineClamp !== 'none') &&
                    el.scrollHeight > el.clientHeight + 3 &&
                    !el.className.includes('clip-chamfer')
                ) {
                    const txt = (el.innerText || '').trim().slice(0, 60);
                    if (txt) {
                        clipY.push({ tag: el.tagName, h: Math.round(el.clientHeight), sh: el.scrollHeight, txt });
                    }
                }

                if (
                    cs.overflowX === 'visible' &&
                    el.scrollWidth > el.clientWidth + 4 &&
                    el.clientWidth > 0 &&
                    !el.closest('.overflow-x-auto, .overflow-auto')
                ) {
                    const txt = (el.innerText || '').trim().slice(0, 60);
                    if (txt && !el.closest('button[title] > div.truncate')) {
                        escapeBox.push({ tag: el.tagName, w: Math.round(el.clientWidth), sw: el.scrollWidth, txt });
                    }
                }
            }

            const menu = document.querySelector("[role='menu']");
            let menuOverflow = null;
            if (menu) {
                const mr = menu.getBoundingClientRect();
                const badChildren = [];
                for (const el of menu.querySelectorAll("[role='menuitem'], span")) {
                    const r = el.getBoundingClientRect();
                    if (el.scrollWidth > el.clientWidth + 1 || r.right > mr.right + 1 || r.left < mr.left - 1) {
                        badChildren.push({ txt: (el.innerText || '').trim().slice(0, 40), cw: el.clientWidth, sw: el.scrollWidth });
                    }
                }
                if (mr.left < 0 || mr.right > window.innerWidth || badChildren.length > 0) {
                    menuOverflow = { left: Math.round(mr.left), right: Math.round(mr.right), vpW: window.innerWidth, badChildren };
                }
            }

            if (checkEnLeaks) {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                    const s = (node.nodeValue || '').trim();
                    if (!s || !/[\\u0E00-\\u0E7F]/.test(s)) continue;
                    const p = node.parentElement;
                    if (!p) continue;
                    const cs = window.getComputedStyle(p);
                    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                    if (p.closest("[aria-hidden='true'], [lang='th']")) continue;
                    enLeaks.push(s.slice(0, 80));
                }
            }

            return {
                docOverflow,
                clipY: clipY.slice(0, 10),
                escapeBox: escapeBox.slice(0, 10),
                menuOverflow,
                enLeaks: [...new Set(enLeaks)].slice(0, 15),
            };
        }""",
        check_en_leaks,
    )


def main() -> None:
    print("=" * 72)
    print("RoV Frontend UX/UI & Playwright E2E Auditor")
    print("=" * 72)

    with tempfile.TemporaryDirectory() as tmpdir:
        os.environ["ROV_DB_PATH"] = str(Path(tmpdir) / "ux_audit.db")
        os.environ["ROV_COOKIE_SECURE"] = "false"

        from src.api import app

        port = _free_port()
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{port}"
        _wait_for_health(base_url)

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch()
                context = browser.new_context(viewport={"width": 390, "height": 844})
                page = context.new_page()

                errors: list[str] = []
                native_dialogs: list[str] = []
                page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
                page.on(
                    "console",
                    lambda msg: (
                        errors.append(f"console.{msg.type}: {msg.text}")
                        if (msg.type == "error" and "Pattern attribute value" not in msg.text)
                        else None
                    ),
                )
                page.on("dialog", lambda d: (native_dialogs.append(d.message), d.dismiss()))

                # 1. AuthLanding audit on mobile (390x844) & desktop (1280x800)
                print("[1/5] Auditing AuthLanding & touch targets across breakpoints...")
                for w, h in [(390, 844), (1280, 800)]:
                    page.set_viewport_size({"width": w, "height": h})
                    page.goto(base_url, wait_until="networkidle")
                    overflow_x, undersized = _audit_viewport_metrics(page)
                    assert not overflow_x, f"AuthLanding horizontal overflow at {w}x{h}"
                    assert not undersized, f"AuthLanding undersized (<24px) targets at {w}x{h}: {undersized}"

                # Enter Guest mode
                page.get_by_role("button", name="เข้าใช้งานแบบ Guest ทันที").click()
                page.wait_for_timeout(300)

                # If announcement & feedback modal auto-opened on first Guest Draft visit, verify its metrics then acknowledge it
                survey_heading = page.get_by_role("heading", name="อัปเดตใหม่ & Feedback MINIDRAFT")
                if survey_heading.is_visible():
                    overflow_x, undersized = _audit_viewport_metrics(page)
                    assert not overflow_x, "Announcement/Feedback modal horizontal overflow"
                    assert not undersized, f"Announcement/Feedback modal undersized (<24px) targets: {undersized}"
                    page.get_by_role("button", name="รับทราบ / ปิด").click()
                    survey_heading.wait_for(state="hidden", timeout=3000)

                # 2. Draft Board layout & touch target audit across 4 breakpoints
                print("[2/5] Auditing Draft Board layout (375x667, 390x844, 768x1024, 1280x800)...")
                for w, h in [(375, 667), (390, 844), (768, 1024), (1280, 800)]:
                    page.set_viewport_size({"width": w, "height": h})
                    page.wait_for_timeout(200)
                    overflow_x, undersized = _audit_viewport_metrics(page)
                    assert not overflow_x, f"DraftBoard horizontal overflow at {w}x{h}"
                    assert not undersized, f"DraftBoard undersized (<24px) targets at {w}x{h}: {undersized}"

                # 3. Mobile GlobalBanModal ergonomics & Portal ConfirmDialog audit (375x667)
                print("[3/5] Auditing mobile GlobalBanModal ergonomics & Portal ConfirmDialog...")
                page.set_viewport_size({"width": 375, "height": 667})
                page.wait_for_timeout(200)
                page.locator('button[title^="Global Ban ของ"]').first.click()
                page.get_by_role("button", name="เสร็จสิ้น").wait_for(timeout=5000)

                active_tag = page.evaluate("() => document.activeElement?.tagName || ''")
                assert active_tag != "INPUT", f"Expected no auto-focused search input on mobile, got {active_tag}"
                footer_rect = page.get_by_role("button", name="เสร็จสิ้น").bounding_box()
                assert footer_rect is not None and footer_rect["y"] + footer_rect["height"] <= 668, (
                    f"GlobalBanModal footer pushed off-screen on 375x667: {footer_rect}"
                )
                page.get_by_role("button", name="เสร็จสิ้น").click()

                # Trigger ConfirmDialog portal from Reset button (requires non-empty history so Reset is enabled)
                page.evaluate(
                    """() => {
                        const raw = JSON.parse(localStorage.getItem('rov_draft_session_v1:guest') || '{}');
                        raw.stepIndex = 1;
                        raw.blueBans = ['Gildur'];
                        raw.history = [{ stepIndex: 0, bluePicks: [], redPicks: [], blueBans: [], redBans: [] }];
                        localStorage.setItem('rov_draft_session_v1:guest', JSON.stringify(raw));
                    }"""
                )
                page.reload(wait_until="networkidle")
                page.get_by_role("button", name="Reset draft").click()
                page.get_by_role("button", name="รีเซ็ตกระดาน").click()
                assert not native_dialogs, f"Native browser dialogs detected: {native_dialogs}"

                # 4. Open Swap Menu wrapping + Explicit Side Control audit (no auto-swap on game win)
                print("[4/5] Auditing open swap-menu wrapping & explicit side control...")
                page.set_viewport_size({"width": 1280, "height": 800})
                page.evaluate(
                    """() => {
                        localStorage.setItem('rov_draft_session_v1:guest', JSON.stringify({
                            stepIndex: 18,
                            blueBans: ['Gildur', 'Kaine', 'Zip', 'Dolia'],
                            redBans: ['Aya', 'Rouie', 'Ybneth', 'Bonnie'],
                            bluePicks: ['Florentino', 'Keera', 'Tulen', 'Capheny', 'Thane'],
                            redPicks: ['Riktor', 'Aoi', 'Krixi', 'Stuart', 'Helen'],
                            pickLanes: {},
                            history: [],
                            winHistory: [],
                            blueWinRate: 50,
                            useLookahead: false,
                            engine: 'sota',
                            league: 'GLOBAL',
                            globalBans: {
                                seriesName: 'ALPHAX vs BETAY',
                                teamAName: 'ALPHAX',
                                teamBName: 'BETAY',
                                teamAUsed: [],
                                teamBUsed: [],
                                universalBans: [],
                                blueSideTeam: 'A',
                                gameNumber: 1
                            },
                            seriesGames: [],
                            updatedAt: Date.now()
                        }));
                    }"""
                )
                page.reload(wait_until="networkidle")
                for w, h in [(375, 667), (1280, 800)]:
                    page.set_viewport_size({"width": w, "height": h})
                    page.wait_for_timeout(150)
                    page.locator("button[aria-haspopup='menu']").first.click()
                    page.wait_for_timeout(150)
                    dom_res = _audit_menu_and_dom_clipping(page)
                    assert dom_res["menuOverflow"] is None, f"Swap menu overflow at {w}x{h}: {dom_res['menuOverflow']}"
                    assert not dom_res["docOverflow"], f"Swap menu caused doc overflow at {w}x{h}"
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(100)

                page.get_by_role("button", name="บันทึกผลเกม").click()
                page.get_by_role("button", name="ALPHAX ชนะ").click()

                stored = json.loads(page.evaluate("() => localStorage.getItem('rov_draft_session_v1:guest')"))
                assert stored["globalBans"]["gameNumber"] == 2, (
                    f"Expected gameNumber=2 after finish, got {stored['globalBans']['gameNumber']}"
                )
                assert stored["globalBans"]["blueSideTeam"] == "A", (
                    f"Unexpected auto side-swap! Expected blueSideTeam='A', got {stored['globalBans']['blueSideTeam']}"
                )

                # 5. Multi-view clipping, overflow & EN localization audit (#analytics)
                print("[5/5] Auditing Scrim Analytics (th/en clipping & overflow)...")
                for lang in ("th", "en"):
                    page.evaluate(f"() => localStorage.setItem('minidraft_language', '{lang}')")
                    page.reload(wait_until="networkidle")
                    for w, h in [(375, 667), (1280, 800)]:
                        page.set_viewport_size({"width": w, "height": h})
                        for route, wait_ms in [("#analytics", 400)]:
                            page.goto(f"{base_url}/{route}", wait_until="networkidle")
                            page.wait_for_timeout(wait_ms)
                            dom_res = _audit_menu_and_dom_clipping(page, check_en_leaks=(lang == "en"))
                            assert not dom_res["docOverflow"], f"{route} docOverflow ({lang}, {w}x{h})"
                            assert not dom_res["clipY"], f"{route} vertical clipY ({lang}, {w}x{h}): {dom_res['clipY']}"
                            assert not dom_res["escapeBox"], (
                                f"{route} escapeBox ({lang}, {w}x{h}): {dom_res['escapeBox']}"
                            )
                            assert not dom_res["enLeaks"], f"{route} Thai leaks in EN ({w}x{h}): {dom_res['enLeaks']}"
                page.evaluate("() => localStorage.removeItem('minidraft_language')")

                assert not errors, f"Console/page errors detected: {errors}"
                browser.close()
        finally:
            server.should_exit = True
            thread.join(timeout=5)

    print("=" * 72)
    print("[PASS] UX/UI accessibility, mobile layout, portal dialogs, and side-lock verified.")
    print("=" * 72)


if __name__ == "__main__":
    main()
