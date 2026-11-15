"""Export RoV 2026 Pro Draft Commercial Sample Package.

Generates a customer-facing preview workbook (`RoV_Pro_Draft_Sample_2026.xlsx`) designed for:
1. Direct Google Sheets viewing (shareable 'Anyone with link can view').
2. Microsoft Excel evaluation with 100% live, interactive native Excel formulas.
3. Selective disclosure: First 50 matches (out of 1,810), Top 20 heroes (out of 130),
   Top 30 synergies & counters (out of 300) with premium lock banners directing to the full package (2,000 THB).
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import openpyxl
import pandas as pd
from openpyxl.styles import Alignment, Font, PatternFill

# Ensure repo root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.export_commercial_package import (  # noqa: E402
    build_dataframes,
    style_worksheet,
)


def build_sample_workbook(
    output_path: Path,
    desktop_copy: bool = False,
) -> Path:
    """Build the customer-facing sample workbook."""
    print("=" * 70)
    print("Building RoV 2026 Pro Draft Sample Package...")
    print("=" * 70)

    # 1. Load full dataframes
    df_sum, df_heroes, df_drafts, df_syn, df_cnt, df_lane = build_dataframes()

    # 2. Slice datasets for sample preview
    df_drafts_sample = df_drafts.iloc[:50].copy()
    df_syn_sample = df_syn.iloc[:30].copy()
    df_cnt_sample = df_cnt.iloc[:30].copy()
    df_lane_sample = df_lane.iloc[:30].copy()

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # 3. Write initial tables using pandas ExcelWriter
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df_sum.to_excel(writer, sheet_name="Executive_Summary", index=False)
        df_heroes.iloc[:20].to_excel(writer, sheet_name="Hero_Tier_List_2026", index=False)
        df_drafts_sample.to_excel(writer, sheet_name="True_Draft_Log_2026", index=False)
        df_syn_sample.to_excel(writer, sheet_name="Top_Synergies_2026", index=False)
        df_cnt_sample.to_excel(writer, sheet_name="Top_Counters_2026", index=False)
        df_lane_sample.to_excel(writer, sheet_name="Direct_Lane_Counters_2026", index=False)

    # 4. Open workbook with openpyxl for formula injection, locking, and styling
    wb = openpyxl.load_workbook(output_path)

    banner_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
    banner_font = Font(name="Calibri", size=10, bold=True, color="F5C451")
    locked_font = Font(name="Calibri", size=9, italic=True, color="94A3B8")
    locked_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")

    # -------------------------------------------------------------
    # Sheet 1: Executive_Summary
    # -------------------------------------------------------------
    ws_sum = wb["Executive_Summary"]
    ws_sum.cell(row=6, column=3, value="=SUM(C2:C5)")
    ws_sum.cell(row=6, column=4, value="=SUM(D2:D5)")
    ws_sum.cell(row=6, column=5, value="=SUM(E2:E5)")
    ws_sum.cell(row=6, column=6, value="=D6/C6")
    ws_sum.cell(row=6, column=7, value="=E6/C6")
    ws_sum.cell(row=6, column=8, value="=SUM(C2:C5)/C6")

    banner_cell = ws_sum.cell(row=8, column=1)
    banner_cell.value = (
        "SAMPLE PREVIEW - RoV Pro Draft Intelligence 2026 | "
        "Full Master Package includes 1,810 Pro Matches, 130 Heroes, 600 Synergies/Counters | Price: 2,000 THB"
    )
    ws_sum.merge_cells("A8:H8")
    banner_cell.fill = banner_fill
    banner_cell.font = banner_font
    banner_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws_sum.row_dimensions[8].height = 24

    notice_cell = ws_sum.cell(row=10, column=1)
    notice_cell.value = (
        "Preview Edition: First 50 Pro Matches, Top 20 Heroes, Top 30 Synergies & Counters included with full dynamic formulas. "
        "Contact to unlock the complete master dataset."
    )
    ws_sum.merge_cells("A10:H10")
    notice_cell.font = Font(name="Calibri", size=10, italic=True, color="475569")
    notice_cell.alignment = Alignment(horizontal="center", vertical="center")

    # -------------------------------------------------------------
    # Sheet 2: Hero_Tier_List_2026
    # -------------------------------------------------------------
    ws_hero = wb["Hero_Tier_List_2026"]
    for r in range(2, 22):
        ws_hero.cell(row=r, column=1, value="=ROW()-1")
        ws_hero.cell(
            row=r,
            column=3,
            value=(
                f'=IF(B{r}="Evita", "S", '
                f'IF(B{r}="Zanis", "A", '
                f'IF(B{r}="Ata", "A", '
                f'IF(B{r}="Volkath", "B", '
                f'IF(B{r}="Moren", "C", '
                f'IF(B{r}="Aya", "C", '
                f'IF(B{r}="Bijan", "C", '
                f'IF(B{r}="Flowborn (Mage)", "C", '
                f'IF(I{r}>=0.45, "S+", '
                f'IF(I{r}>=0.25, "S", '
                f'IF(I{r}>=0.12, "A", '
                f'IF(I{r}>=0.04, "B", "C"))))))))))))'
            ),
        )
        ws_hero.cell(
            row=r,
            column=4,
            value=f'=IF(B{r}="Volkath", "🔒 Disabled", IF(I{r}-L{r}>=0.1, "▲ Rising", IF(I{r}-L{r}<=-0.1, "▼ Falling", "● Stable")))',
        )
        ws_hero.cell(row=r, column=11, value=f"=(P{r}+Q{r})/Executive_Summary!$C$6")
        ws_hero.cell(
            row=r,
            column=14,
            value=f'=IF(B{r}="Evita", P{r}/71, IF(B{r}="Volkath", P{r}/1097, P{r}/Executive_Summary!$C$6))',
        )
        ws_hero.cell(
            row=r,
            column=15,
            value=f'=IF(B{r}="Evita", Q{r}/71, IF(B{r}="Volkath", Q{r}/1097, Q{r}/Executive_Summary!$C$6))',
        )
        ws_hero.cell(row=r, column=17, value=f"=R{r}+S{r}")
        ws_hero.cell(row=r, column=21, value=f"=P{r}-T{r}")
        ws_hero.cell(row=r, column=22, value=f"=IF(P{r}>0, T{r}/P{r}, 0)")
        ws_hero.cell(
            row=r,
            column=23,
            value=f"=MIN(MAX((T{r}+5)/(P{r}+10), 0.05), 0.95)",
        )
        ws_hero.cell(row=r, column=28, value=f"=P{r}-AA{r}")

    # Separator Banner at Row 22
    ws_hero.cell(
        row=22,
        column=1,
        value="🔒 SAMPLE PREVIEW: Ranks 21 to 130 (110 Heroes) are locked. Purchase the Full Master Package (2,000 THB) to unlock all 130 heroes.",
    )
    ws_hero.merge_cells("A22:AG22")
    ws_hero.cell(row=22, column=1).fill = banner_fill
    ws_hero.cell(row=22, column=1).font = banner_font
    ws_hero.cell(row=22, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws_hero.row_dimensions[22].height = 26

    # Rows 23..132: Masked heroes 21..130 with essential lookup data preserved
    df_rest = df_heroes.iloc[20:].copy()
    for idx, (_, row_data) in enumerate(df_rest.iterrows(), start=23):
        ws_hero.cell(row=idx, column=1, value="=ROW()-2")
        ws_hero.cell(row=idx, column=2, value=row_data["Hero"])
        ws_hero.cell(row=idx, column=3, value="[Locked]")
        ws_hero.cell(row=idx, column=4, value="[Locked]")
        ws_hero.cell(row=idx, column=5, value="[Locked]")
        ws_hero.cell(row=idx, column=6, value=row_data["Primary_Role"])
        ws_hero.cell(row=idx, column=7, value=row_data["Secondary_Role"])
        ws_hero.cell(row=idx, column=8, value=row_data["Main_Pro_Lane"])
        for c in range(9, 16):
            ws_hero.cell(row=idx, column=c, value="[Locked]")
        # Total_Picks (Col 16 / P) preserved for Co_Pick_Lift lookup
        ws_hero.cell(row=idx, column=16, value=int(row_data["Total_Picks"]))
        for c in range(17, 23):
            ws_hero.cell(row=idx, column=c, value="[Locked]")
        # Bayesian_WR (Col 23 / W) preserved for Expected_BT_WR lookup
        ws_hero.cell(row=idx, column=23, value=float(row_data["Bayesian_WR"]))
        for c in range(24, 34):
            ws_hero.cell(row=idx, column=c, value="[Locked]")

        ws_hero.row_dimensions[idx].height = 19
        for c in range(1, 34):
            ws_hero.cell(row=idx, column=c).fill = locked_fill
            ws_hero.cell(row=idx, column=c).font = locked_font

    # -------------------------------------------------------------
    # Sheet 3: True_Draft_Log_2026
    # -------------------------------------------------------------
    ws_draft = wb["True_Draft_Log_2026"]
    for r in range(2, 52):
        # Winner_Team (Column M / 13) from Blue_Team (K) or Red_Team (L) via Blue_Win (O)
        ws_draft.cell(row=r, column=13, value=f"=IF(O{r}=1, K{r}, L{r})")
        # Winner_Side (Column N / 14)
        ws_draft.cell(row=r, column=14, value=f'=IF(O{r}=1, "Blue", "Red")')

    ws_draft.cell(
        row=52,
        column=1,
        value="🔒 SAMPLE PREVIEW: Matches 51 to 1,810 (1,760 Pro Matches) are locked. Purchase the Full Master Package (2,000 THB) for the complete 1,810-game true pick order dataset.",
    )
    ws_draft.merge_cells("A52:AQ52")
    ws_draft.cell(row=52, column=1).fill = banner_fill
    ws_draft.cell(row=52, column=1).font = banner_font
    ws_draft.cell(row=52, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws_draft.row_dimensions[52].height = 26

    # -------------------------------------------------------------
    # Sheet 4: Top_Synergies_2026
    # -------------------------------------------------------------
    ws_syn = wb["Top_Synergies_2026"]
    for r in range(2, 32):
        ws_syn.cell(row=r, column=1, value="=ROW()-1")
        ws_syn.cell(row=r, column=7, value=f"=E{r}-F{r}")
        ws_syn.cell(row=r, column=8, value=f"=IF(E{r}>0, F{r}/E{r}, 0)")
        ws_syn.cell(
            row=r,
            column=9,
            value=(
                f"=(VLOOKUP(B{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)*VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE))/"
                f"(1-VLOOKUP(B{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)-VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)+"
                f"2*VLOOKUP(B{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)*VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE))"
            ),
        )
        ws_syn.cell(row=r, column=10, value=f"=(F{r}+12*I{r})/(E{r}+12)")
        ws_syn.cell(row=r, column=11, value=f"=J{r}-I{r}")
        ws_syn.cell(row=r, column=12, value=f"=(F{r}-E{r}*I{r})/SQRT(E{r}*I{r}*(1-I{r})+1)")
        ws_syn.cell(
            row=r,
            column=13,
            value=(
                f"=E{r}/MAX(0.0001, (VLOOKUP(B{r}, Hero_Tier_List_2026!$B$2:$P$132, 15, FALSE)*"
                f"VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$P$132, 15, FALSE))/(2*Executive_Summary!$C$6))"
            ),
        )

    ws_syn.cell(
        row=32,
        column=1,
        value="🔒 SAMPLE PREVIEW: Pairs 31 to 300 (270 Pro Synergies) are locked. Purchase the Full Master Package (2,000 THB) for all 300 synergy models.",
    )
    ws_syn.merge_cells("A32:N32")
    ws_syn.cell(row=32, column=1).fill = banner_fill
    ws_syn.cell(row=32, column=1).font = banner_font
    ws_syn.cell(row=32, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws_syn.row_dimensions[32].height = 26

    # -------------------------------------------------------------
    # Sheet 5: Top_Counters_2026
    # -------------------------------------------------------------
    ws_cnt = wb["Top_Counters_2026"]
    for r in range(2, 32):
        # Rank (A)
        ws_cnt.cell(row=r, column=1, value="=ROW()-1")
        # Losses_vs_Target (F) = Matchup_Games (D) - Wins_vs_Target (E)
        ws_cnt.cell(row=r, column=6, value=f"=D{r}-E{r}")
        # Raw_WR_vs_Target (G) = Wins_vs_Target (E) / Matchup_Games (D)
        ws_cnt.cell(row=r, column=7, value=f"=IF(D{r}>0, E{r}/D{r}, 0)")
        # Expected_BT_WR (H) = (pC * (1 - pT)) / (pC + pT - 2 * pC * pT)
        vC = f"VLOOKUP(B{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)"
        vT = f"VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)"
        ws_cnt.cell(row=r, column=8, value=f"=({vC}*(1-{vT}))/({vC}+{vT}-2*{vC}*{vT})")
        # Played_Delta2_Lift (I) = Raw_WR (G) - Expected_BT_WR (H)
        ws_cnt.cell(row=r, column=9, value=f"=G{r}-H{r}")
        # Counter_Delta2_Lift (M) = Posterior_EB_WR (L) - Expected_BT_WR (H)
        ws_cnt.cell(row=r, column=13, value=f"=L{r}-H{r}")
        # Counter_Z_Score (N) = (Wins - Games * Expected_WR) / SQRT(Games * Expected_WR * (1 - Expected_WR) + 1)
        ws_cnt.cell(row=r, column=14, value=f"=(E{r}-D{r}*H{r})/SQRT(D{r}*H{r}*(1-H{r})+1)")

    ws_cnt.cell(
        row=32,
        column=1,
        value="🔒 SAMPLE PREVIEW: Pairs 31 to 300 (270 Pro Counters) are locked. Purchase the Full Master Package (2,000 THB) for all 300 counter models.",
    )
    ws_cnt.merge_cells("A32:Q32")
    ws_cnt.cell(row=32, column=1).fill = banner_fill
    ws_cnt.cell(row=32, column=1).font = banner_font
    ws_cnt.cell(row=32, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws_cnt.row_dimensions[32].height = 26

    # -------------------------------------------------------------
    # Sheet 6: Direct_Lane_Counters_2026
    # -------------------------------------------------------------
    ws_lane = wb["Direct_Lane_Counters_2026"]
    for r in range(2, 32):
        ws_lane.cell(row=r, column=1, value="=ROW()-1")
        ws_lane.cell(row=r, column=7, value=f"=E{r}-F{r}")
        ws_lane.cell(row=r, column=8, value=f"=IF(E{r}>0, F{r}/E{r}, 0)")
        ws_lane.cell(
            row=r,
            column=9,
            value=(
                f"=(VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)*(1-VLOOKUP(D{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)))/"
                f"(VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)+VLOOKUP(D{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)-"
                f"2*VLOOKUP(C{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE)*VLOOKUP(D{r}, Hero_Tier_List_2026!$B$2:$W$132, 22, FALSE))"
            ),
        )
        ws_lane.cell(row=r, column=10, value=f"=H{r}-I{r}")
        ws_lane.cell(row=r, column=14, value=f"=M{r}-I{r}")
        ws_lane.cell(row=r, column=15, value=f"=(F{r}-E{r}*I{r})/SQRT(E{r}*I{r}*(1-I{r})+1)")

    ws_lane.cell(
        row=32,
        column=1,
        value="🔒 SAMPLE PREVIEW: Lane matchups 31 to 250 are locked. Purchase the Full Master Package (2,000 THB) for all direct lane counter models.",
    )
    ws_lane.merge_cells("A32:Q32")
    ws_lane.cell(row=32, column=1).fill = banner_fill
    ws_lane.cell(row=32, column=1).font = banner_font
    ws_lane.cell(row=32, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws_lane.row_dimensions[32].height = 26

    # 5. Apply typography, auto-fit, and conditional formatting styles
    style_worksheet(
        ws_sum,
        pct_cols=["Blue_Win_Rate", "Red_Win_Rate", "True_Pick_Order_Coverage"],
        color_scale_cols=["Blue_Win_Rate"],
    )
    hero_tier_map = dict(zip(df_heroes["Hero"], df_heroes["Tier_2026"]))
    style_worksheet(
        ws_hero,
        pct_cols=[
            "Recent_Patch_Presence",
            "Recent_Patch_Win_Rate",
            "Annual_Presence",
            "Spring_Presence",
            "Summer_APL_Presence",
            "Pick_Rate",
            "Ban_Rate",
            "Win_Rate",
            "Bayesian_WR",
            "DS_Lane_Share",
            "Jungle_Share",
            "Mid_Share",
            "Dragon_Lane_Share",
            "Roam_Share",
        ],
        color_scale_cols=[
            "Recent_Patch_Presence",
            "Recent_Patch_Win_Rate",
            "Annual_Presence",
            "Win_Rate",
            "Bayesian_WR",
        ],
        hero_tier_map=hero_tier_map,
    )
    style_worksheet(ws_draft, pct_cols=[], color_scale_cols=[])
    style_worksheet(
        ws_syn,
        pct_cols=[
            "Raw_Duo_WR",
            "Expected_BT_WR",
            "Posterior_EB_WR",
            "Synergy_Delta2_Lift",
        ],
        color_scale_cols=["Posterior_EB_WR", "Synergy_Delta2_Lift"],
    )
    style_worksheet(
        ws_cnt,
        pct_cols=[
            "Raw_WR_vs_Target",
            "Expected_BT_WR",
            "Played_Delta2_Lift",
            "Posterior_EB_WR",
            "Counter_Delta2_Lift",
            "Same_Lane_WR",
        ],
        color_scale_cols=["Posterior_EB_WR", "Counter_Delta2_Lift"],
    )
    style_worksheet(
        ws_lane,
        pct_cols=[
            "Raw_InLane_WR",
            "Expected_BT_WR",
            "Played_InLane_Lift",
            "Posterior_InLane_WR",
            "InLane_Delta2_Lift",
        ],
        color_scale_cols=["Posterior_InLane_WR", "InLane_Delta2_Lift"],
    )

    wb.save(output_path)
    file_size_kb = output_path.stat().st_size / 1024
    print(f"Sample workbook created successfully at: {output_path} ({file_size_kb:.1f} KB)")

    # 6. Copy to Desktop if requested
    if desktop_copy:
        desktop_dir = Path.home() / "Desktop"
        if desktop_dir.exists():
            desktop_file = desktop_dir / "RoV_Pro_Draft_Sample_2026.xlsx"
            try:
                shutil.copy2(output_path, desktop_file)
                print(f"Copied sample file to Desktop: {desktop_file}")
            except Exception as e:
                print(f"Notice: Could not copy to desktop: {e}")

    return output_path


def main():
    """Command-line entrypoint."""
    parser = argparse.ArgumentParser(description="Build customer-facing RoV 2026 Pro Draft Sample Excel workbook.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("exports/sample/RoV_Pro_Draft_Sample_2026.xlsx"),
        help="Path for generated sample .xlsx file",
    )
    parser.add_argument(
        "--desktop",
        action="store_true",
        help="Copy sample file to Desktop",
    )
    args = parser.parse_args()

    build_sample_workbook(
        output_path=args.output,
        desktop_copy=args.desktop,
    )


if __name__ == "__main__":
    main()
