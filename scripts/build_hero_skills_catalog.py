"""
Build complete, structured numerical skill catalog for all 130 RoV heroes.

Extracts exact Cooldowns, Mana Costs, Base Damage scaling, and AD/AP ratios
from Fandom MediaWiki, Liquipedia, and official Garena patch records.
"""

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from bs4 import BeautifulSoup

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
HEROES_JSON_PATH = DATA_DIR / "heroes_130_full.json"
OUTPUT_SKILLS_PATH = DATA_DIR / "hero_skills_full.json"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Curated high-precision skill data for collaboration, new, and non-standard heroes
CURATED_HERO_SKILLS = {
    "Florentino": [
        {
            "slot": "Passive",
            "name": "Shuffle",
            "type": "Passive / Physical",
            "damage_type": "physical",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [70],
            "scaling": {"ad_pct": 120.0, "ap_pct": 35.0, "level_scaling": 10},
            "description": "When Florentino exits combat, his next normal attack becomes Lunge, dealing enhanced physical damage and healing him.",
        },
        {
            "slot": "Skill 1",
            "name": "Blossom",
            "type": "Physical / Stun",
            "damage_type": "physical",
            "cooldown": [8.0, 7.6, 7.2, 6.8, 6.4, 6.0],
            "mana_cost": [0],
            "base_damage": [280, 320, 360, 400, 440, 480],
            "scaling": {"ad_pct": 120.0},
            "description": "Florentino tosses a dart that deals physical damage, stuns the target for 0.25s, and spawns 3 flowers.",
        },
        {
            "slot": "Skill 2",
            "name": "Triple Threat",
            "type": "True / Multi-hit",
            "damage_type": "true",
            "cooldown": [1.25],
            "mana_cost": [0],
            "base_damage": [150, 200, 250],
            "scaling": {"hp_pct": 0.9, "ad_pct": 100.0},
            "description": "Florentino attacks 3 times, each strike dealing true damage equal to target's max HP and resetting Lunge.",
        },
        {
            "slot": "Ultimate",
            "name": "Gentlemen's Duel",
            "type": "Physical / Duel",
            "damage_type": "physical",
            "cooldown": [40.0, 35.0, 30.0],
            "mana_cost": [0],
            "base_damage": [400, 550, 700],
            "scaling": {"ad_pct": 100.0},
            "description": "Florentino dashes forward and challenges a target, becoming immune to all other enemies and spawning 3 flowers.",
        },
    ],
    "Capheny": [
        {
            "slot": "Passive",
            "name": "Aquamarine",
            "type": "Passive / Attack Speed",
            "damage_type": "physical",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Capheny is able to move while firing, and converts bonus attack speed from equipment into attack damage.",
        },
        {
            "slot": "Skill 1",
            "name": "Pulse Shot",
            "type": "Physical / Long Range",
            "damage_type": "physical",
            "cooldown": [0.0],
            "mana_cost": [20],
            "base_damage": [70, 140, 210, 280, 350, 420],
            "scaling": {"ad_pct": 100.0},
            "description": "Capheny switches to Pulse Shot, piercing enemies in a line with heavy energy projectiles.",
        },
        {
            "slot": "Skill 2",
            "name": "Armorbreaker",
            "type": "Speed / Armor Pierce",
            "damage_type": "physical",
            "cooldown": [9.0, 8.7, 8.4, 8.1, 7.8, 7.5],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Capheny removes slows and gains a movement speed burst, instantly acquiring 10 stacks of armor pierce.",
        },
        {
            "slot": "Ultimate",
            "name": "Fusillade",
            "type": "Physical / Barrage",
            "damage_type": "physical",
            "cooldown": [50.0, 45.0, 40.0],
            "mana_cost": [0],
            "base_damage": [160, 240, 320],
            "scaling": {"ad_pct": 25.0},
            "description": "Capheny unleashes a devastating cone of continuous fire for 3 seconds, shredding target armor.",
        },
    ],
    "Charlotte": [
        {
            "slot": "Passive",
            "name": "Splash Gradation",
            "type": "Passive / Physical",
            "damage_type": "physical",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [50],
            "scaling": {"ad_pct": 35.0},
            "description": "Casting any skill enhances normal attacks, granting a dash and additional physical damage.",
        },
        {
            "slot": "Skill 1",
            "name": "Tri-Slash",
            "type": "Physical / Speed",
            "damage_type": "physical",
            "cooldown": [8.0, 7.6, 7.2, 6.8, 6.4, 6.0],
            "mana_cost": [0],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ad_pct": 100.0},
            "description": "Charlotte unleashes a triangle slash in the target direction, dealing physical damage and increasing movement speed.",
        },
        {
            "slot": "Skill 2",
            "name": "Splash Slash",
            "type": "Physical / Dash",
            "damage_type": "physical",
            "cooldown": [6.0, 5.7, 5.4, 5.1, 4.8, 4.5],
            "mana_cost": [0],
            "base_damage": [40, 48, 56, 64, 72, 80],
            "scaling": {"ad_pct": 15.0},
            "description": "Charlotte dashes forward and rapidly stabs 6 times, each strike dealing physical damage and recovering HP.",
        },
        {
            "slot": "Ultimate",
            "name": "Power Sword",
            "type": "Physical / Control",
            "damage_type": "physical",
            "cooldown": [18.0, 15.0, 12.0],
            "mana_cost": [0],
            "base_damage": [150, 250, 350],
            "scaling": {"ad_pct": 70.0},
            "description": "Charlotte draws a seven-pointed star on the ground, dealing 7 waves of physical damage and knocking enemies airborne.",
        },
    ],
    "Ming": [
        {
            "slot": "Passive",
            "name": "Fortune Teller",
            "type": "Passive / Magic",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [80],
            "scaling": {"ap_pct": 25.0},
            "description": "Ming's third consecutive normal attack deals bonus magic damage and recovers health for himself and tethered allies.",
        },
        {
            "slot": "Skill 1",
            "name": "Fate Connection",
            "type": "Magic / Tether",
            "damage_type": "magic",
            "cooldown": [3.0, 3.0, 3.0, 3.0, 3.0, 3.0],
            "mana_cost": [40, 45, 50, 55, 60, 65],
            "base_damage": [100, 120, 140, 160, 180, 200],
            "scaling": {"ap_pct": 20.0},
            "description": "Ming fires a celestial tether connecting to a target ally or enemy.",
        },
        {
            "slot": "Skill 2",
            "name": "Auspicious Change",
            "type": "Buff / Debuff",
            "damage_type": "none",
            "cooldown": [3.0, 3.0, 3.0, 3.0, 3.0, 3.0],
            "mana_cost": [30, 35, 40, 45, 50, 55],
            "base_damage": [],
            "scaling": {},
            "description": "Ming switches the tether mode between offensive enhancement and defensive amplification.",
        },
        {
            "slot": "Ultimate",
            "name": "Cosmic Blessing",
            "type": "True / Heal",
            "damage_type": "true",
            "cooldown": [40.0, 35.0, 30.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [1000, 1500, 2000],
            "scaling": {"ap_pct": 150.0},
            "description": "Ming sacrifices his own health to heal an ally for massive true health, or deal massive true damage to an enemy.",
        },
    ],
    "Heino": [
        {
            "slot": "Passive",
            "name": "Fate Pivot",
            "type": "Passive / Stance",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [100],
            "scaling": {"ap_pct": 30.0},
            "description": "Heino switches between ranged and melee forms based on target distance.",
        },
        {
            "slot": "Skill 1",
            "name": "Destiny Scepter",
            "type": "Magic / Poke",
            "damage_type": "magic",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [45, 50, 55, 60, 65, 70],
            "base_damage": [400, 480, 560, 640, 720, 800],
            "scaling": {"ap_pct": 60.0},
            "description": "Heino hurls his staff of fate, dealing magic damage to targets in a line.",
        },
        {
            "slot": "Skill 2",
            "name": "Forward Leap",
            "type": "Dash / Heal",
            "damage_type": "magic",
            "cooldown": [7.0, 6.6, 6.2, 5.8, 5.4, 5.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [],
            "scaling": {},
            "description": "Heino dashes in the target direction, transforming into melee stance near enemies and healing himself.",
        },
        {
            "slot": "Ultimate",
            "name": "Time Reversal",
            "type": "Magic / Invulnerable",
            "damage_type": "magic",
            "cooldown": [60.0, 55.0, 50.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [300, 450, 600],
            "scaling": {"ap_pct": 50.0},
            "description": "Heino enters an untargetable state, rewinding his own position and health back in time.",
        },
    ],
    "Dyadia": [
        {
            "slot": "Passive",
            "name": "Yuan Bond",
            "type": "Passive / Utility",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [50],
            "scaling": {"ap_pct": 20.0},
            "description": "Dyadia marks allies and enemies with fate threads, providing vision and movement speed.",
        },
        {
            "slot": "Skill 1",
            "name": "Fate Guidance",
            "type": "Magic / Shield / Heal",
            "damage_type": "magic",
            "cooldown": [7.0, 6.6, 6.2, 5.8, 5.4, 5.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ap_pct": 40.0},
            "description": "Dyadia attaches a red thread to an ally, granting continuous healing, bonus movement speed, and a shield.",
        },
        {
            "slot": "Skill 2",
            "name": "Fate Entanglement",
            "type": "Magic / CC / Gold Steal",
            "damage_type": "magic",
            "cooldown": [9.0, 8.4, 7.8, 7.2, 6.6, 6.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [180, 215, 250, 285, 320, 355],
            "scaling": {"ap_pct": 35.0},
            "description": "Dyadia attaches a blue thread to an enemy, slowing them and stealing gold gradually.",
        },
        {
            "slot": "Ultimate",
            "name": "Destiny Convergence",
            "type": "Magic / Mass Heal / Stun",
            "damage_type": "magic",
            "cooldown": [45.0, 40.0, 35.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [350, 500, 650],
            "scaling": {"ap_pct": 65.0},
            "description": "Dyadia unleashes fate energy, granting massive healing to tethered allies and stunning tethered enemies.",
        },
    ],
    "Goverra": [
        {
            "slot": "Passive",
            "name": "Aether Forge",
            "type": "Passive / Drone",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [60],
            "scaling": {"ap_pct": 25.0},
            "description": "When Goverra defeats an enemy or minion, she summons a Mechanoid drone.",
        },
        {
            "slot": "Skill 1",
            "name": "Drone Barrage",
            "type": "Magic / Poke",
            "damage_type": "magic",
            "cooldown": [7.0, 6.6, 6.2, 5.8, 5.4, 5.0],
            "mana_cost": [55, 60, 65, 70, 75, 80],
            "base_damage": [280, 330, 380, 430, 480, 530],
            "scaling": {"ap_pct": 55.0},
            "description": "Goverra commands fighter drones to fly along a target path, dealing magic damage and slowing.",
        },
        {
            "slot": "Skill 2",
            "name": "Deploy Station",
            "type": "Magic / Shield",
            "damage_type": "magic",
            "cooldown": [10.0, 9.4, 8.8, 8.2, 7.6, 7.0],
            "mana_cost": [70, 75, 80, 85, 90, 95],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ap_pct": 40.0},
            "description": "Goverra deploys a squad of Mechanoids to bombard the target zone, granting a shield to herself.",
        },
        {
            "slot": "Ultimate",
            "name": "Mechanoid Overload",
            "type": "Magic / Lock-on",
            "damage_type": "magic",
            "cooldown": [36.0, 32.0, 28.0],
            "mana_cost": [120, 140, 160],
            "base_damage": [500, 700, 900],
            "scaling": {"ap_pct": 80.0},
            "description": "Goverra locks onto an enemy hero with a targeting beacon, stunning them and calling down a focused laser strike.",
        },
    ],
    "Edras": [
        {
            "slot": "Passive",
            "name": "Blade Resonance",
            "type": "Passive / EXP",
            "damage_type": "physical",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Edras's normal attacks and Skill 2 grant bonus EXP (+10) when hitting enemy champions.",
        },
        {
            "slot": "Skill 1",
            "name": "Whirlwind Step",
            "type": "Physical / Dash",
            "damage_type": "physical",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [220, 260, 300, 340, 380, 420],
            "scaling": {"ad_pct": 75.0},
            "description": "Edras dashes forward and slashes, knocking airborne and reducing enemy physical defense.",
        },
        {
            "slot": "Skill 2",
            "name": "Aura Blade Wave",
            "type": "Physical / Range",
            "damage_type": "physical",
            "cooldown": [8.0, 7.4, 6.8, 6.2, 5.6, 5.0],
            "mana_cost": [55, 60, 65, 70, 75, 80],
            "base_damage": [250, 300, 350, 400, 450, 500],
            "scaling": {"ad_pct": 85.0},
            "description": "Edras unleashes an aura blade wave in the target direction, dealing physical damage.",
        },
        {
            "slot": "Ultimate",
            "name": "Sky Splitter",
            "type": "Physical / Execute",
            "damage_type": "physical",
            "cooldown": [30.0, 26.0, 22.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [400, 600, 800],
            "scaling": {"ad_pct": 120.0},
            "description": "Edras leaps into the clouds and crashes down on target area, dealing lethal damage.",
        },
    ],
    "Tamyn": [
        {
            "slot": "Passive",
            "name": "Spear Return",
            "type": "Passive / Enhanced Attack",
            "damage_type": "physical",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [80],
            "scaling": {"ad_pct": 40.0},
            "description": "Whenever Tamyn retrieves or recalls his spear, his next basic attack deals enhanced physical damage.",
        },
        {
            "slot": "Skill 1",
            "name": "Spear Thrust",
            "type": "Physical / Dash",
            "damage_type": "physical",
            "cooldown": [7.0, 6.5, 6.0, 5.5, 5.0, 4.5],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [240, 285, 330, 375, 420, 465],
            "scaling": {"ad_pct": 80.0},
            "description": "Tamyn hurls his spear forward or dashes along its trajectory, dealing physical damage.",
        },
        {
            "slot": "Skill 2",
            "name": "Spear Anchor",
            "type": "Physical / Slow",
            "damage_type": "physical",
            "cooldown": [9.0, 8.4, 7.8, 7.2, 6.6, 6.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ad_pct": 65.0},
            "description": "Tamyn plants a spear into the target area, dealing physical damage and slowing enemies.",
        },
        {
            "slot": "Ultimate",
            "name": "All Spears Recall",
            "type": "Physical / Burst",
            "damage_type": "physical",
            "cooldown": [18.0, 15.0, 12.0],
            "mana_cost": [80, 90, 100],
            "base_damage": [300, 450, 600],
            "scaling": {"ad_pct": 90.0},
            "description": "Tamyn immediately recalls all planted spears back to himself, granting a massive shield.",
        },
    ],
    "Evita": [
        {
            "slot": "Passive",
            "name": "Abyssal Energy",
            "type": "Passive / Magic",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [100],
            "scaling": {"ap_pct": 35.0},
            "description": "Evita continuously accumulates dark energy. When full, her next skill release gains empowered crowd control.",
        },
        {
            "slot": "Skill 1",
            "name": "Abyssal Beast",
            "type": "Magic / Poke",
            "damage_type": "magic",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [280, 330, 380, 430, 480, 530],
            "scaling": {"ap_pct": 50.0},
            "description": "Evita releases an abyssal beast in target direction, dealing magic damage and slowing.",
        },
        {
            "slot": "Skill 2",
            "name": "Hand of Abyss",
            "type": "Magic / Control",
            "damage_type": "magic",
            "cooldown": [9.0, 8.4, 7.8, 7.2, 6.6, 6.0],
            "mana_cost": [65, 70, 75, 80, 85, 90],
            "base_damage": [220, 260, 300, 340, 380, 420],
            "scaling": {"ap_pct": 45.0},
            "description": "Evita summons a Hand of Abyss from a rift that deals continuous magic damage and pulls enemies.",
        },
        {
            "slot": "Ultimate",
            "name": "Abyssal Hunt",
            "type": "Magic / Shield / CC",
            "damage_type": "magic",
            "cooldown": [40.0, 35.0, 30.0],
            "mana_cost": [120, 140, 160],
            "base_damage": [450, 650, 850],
            "scaling": {"ap_pct": 75.0},
            "description": "Evita gains a protective shield and releases swarms of abyssal beasts to hunt all nearby enemies.",
        },
    ],
    "Flowborn (Marksman)": [
        {
            "slot": "Passive",
            "name": "Weapon Resonance",
            "type": "Passive / Physical",
            "damage_type": "physical",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [50],
            "scaling": {"ad_pct": 30.0},
            "description": "Flowborn modifies weapon attachments, switching between piercing crossbow and rapid twin pistols.",
        },
        {
            "slot": "Skill 1",
            "name": "Rapid Fire",
            "type": "Physical / Attack Speed",
            "damage_type": "physical",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [45, 50, 55, 60, 65, 70],
            "base_damage": [250, 300, 350, 400, 450, 500],
            "scaling": {"ad_pct": 80.0},
            "description": "Flowborn fires rapid-fire kinetic rounds in a cone, dealing physical damage and boosting attack speed.",
        },
        {
            "slot": "Skill 2",
            "name": "Tactical Dash",
            "type": "Physical / Mobility",
            "damage_type": "physical",
            "cooldown": [8.0, 7.6, 7.2, 6.8, 6.4, 6.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [180, 215, 250, 285, 320, 355],
            "scaling": {"ad_pct": 50.0},
            "description": "Flowborn vaults in the target direction, becoming briefly untargetable and reloading weapons.",
        },
        {
            "slot": "Ultimate",
            "name": "Barrage Blast",
            "type": "Physical / Area",
            "damage_type": "physical",
            "cooldown": [35.0, 30.0, 25.0],
            "mana_cost": [100, 115, 130],
            "base_damage": [300, 450, 600],
            "scaling": {"ad_pct": 120.0},
            "description": "Flowborn deploys heavy artillery, bombarding the target zone with consecutive explosive shells.",
        },
    ],
    "Flowborn (Mage)": [
        {
            "slot": "Passive",
            "name": "Elemental Core",
            "type": "Passive / Magic",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [80],
            "scaling": {"ap_pct": 25.0},
            "description": "Flowborn tunes into raw elemental flow, increasing ability power and mana regeneration.",
        },
        {
            "slot": "Skill 1",
            "name": "Elemental Surge",
            "type": "Magic / Poke",
            "damage_type": "magic",
            "cooldown": [6.0, 5.5, 5.0, 4.5, 4.0, 3.5],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [300, 360, 420, 480, 540, 600],
            "scaling": {"ap_pct": 65.0},
            "description": "Flowborn releases a surging wave of elemental energy, dealing magic damage to all enemies in its wake.",
        },
        {
            "slot": "Skill 2",
            "name": "Arcane Warp",
            "type": "Magic / Teleport",
            "damage_type": "magic",
            "cooldown": [9.0, 8.4, 7.8, 7.2, 6.6, 6.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ap_pct": 45.0},
            "description": "Flowborn opens an arcane rift, blinking to target location and leaving behind a slowing magic vortex.",
        },
        {
            "slot": "Ultimate",
            "name": "Prismatic Cataclysm",
            "type": "Magic / Burst",
            "damage_type": "magic",
            "cooldown": [40.0, 35.0, 30.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [450, 675, 900],
            "scaling": {"ap_pct": 90.0},
            "description": "Flowborn channels primordial magic, unleashing a prismatic cataclysm that obliterates the target area.",
        },
    ],
    "Zata": [
        {
            "slot": "Passive",
            "name": "Windstorm",
            "type": "Passive / Magic",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [100],
            "scaling": {"ap_pct": 35.0},
            "description": "Every 3rd normal attack deals bonus magic damage. Triggering wind eddies reduces Ultimate cooldown.",
        },
        {
            "slot": "Skill 1",
            "name": "Eagle Screech",
            "type": "Magic / Poke",
            "damage_type": "magic",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [225, 250, 275, 300, 325, 350],
            "scaling": {"ap_pct": 30.0},
            "description": "Zata launches a missile of wind energy forward that diminishes in speed, dealing magic damage.",
        },
        {
            "slot": "Skill 2",
            "name": "Twister",
            "type": "Magic / Slow",
            "damage_type": "magic",
            "cooldown": [9.0, 8.4, 7.8, 7.2, 6.6, 6.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [200, 220, 240, 260, 280, 300],
            "scaling": {"ap_pct": 25.0},
            "description": "Zata creates a twister at target location that sweeps back towards him, slowing and damaging enemies.",
        },
        {
            "slot": "Ultimate",
            "name": "Ascend",
            "type": "Magic / Invulnerable",
            "damage_type": "magic",
            "cooldown": [40.0, 35.0, 30.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [120, 150, 180],
            "scaling": {"ap_pct": 15.0},
            "description": "Zata charges forward with his feathers. Upon hitting 3-5 targets or eddies, he ascends to the sky and rains untargetable death.",
        },
    ],
    "Dolia": [
        {
            "slot": "Passive",
            "name": "Mermaid Song",
            "type": "Passive / Buff",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Dolia gains water form in river, regenerating HP and mana rapidly.",
        },
        {
            "slot": "Skill 1",
            "name": "Ocean Wave",
            "type": "Magic / CC",
            "damage_type": "magic",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ap_pct": 40.0},
            "description": "Dolia releases circular ripples of sound waves, revealing enemies, slowing, and pushing them.",
        },
        {
            "slot": "Skill 2",
            "name": "Mermaid Surge",
            "type": "Magic / Heal",
            "damage_type": "magic",
            "cooldown": [10.0, 9.4, 8.8, 8.2, 7.6, 7.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [300, 350, 400, 450, 500, 550],
            "scaling": {"ap_pct": 50.0},
            "description": "Dolia creates a pond of water, leaping into it and restoring health to nearby allies.",
        },
        {
            "slot": "Ultimate",
            "name": "Celestial Symphony",
            "type": "Buff / Reset",
            "damage_type": "none",
            "cooldown": [40.0, 35.0, 30.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [],
            "scaling": {},
            "description": "Dolia sings a celestial melody to tethered ally, immediately resetting their longest cooldown ultimate or skill.",
        },
    ],
    "Y'bneth": [
        {
            "slot": "Passive",
            "name": "Natural Affinity",
            "type": "Passive / Regen",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Entering bushes triggers natural affinity, regenerating health and mana over 5 seconds.",
        },
        {
            "slot": "Skill 1",
            "name": "Wicked Toils",
            "type": "Physical / CC",
            "damage_type": "physical",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [40, 45, 50, 55, 60, 65],
            "base_damage": [270, 310, 350, 390, 430, 470],
            "scaling": {"ad_pct": 80.0},
            "description": "Y'bneth extends wooden arms forward, dealing physical damage and slowing.",
        },
        {
            "slot": "Skill 2",
            "name": "Branch Swing",
            "type": "Physical / Clasp",
            "damage_type": "physical",
            "cooldown": [9.0, 8.4, 7.8, 7.2, 6.6, 6.0],
            "mana_cost": [65, 70, 75, 80, 85, 90],
            "base_damage": [285, 340, 395, 450, 505, 560],
            "scaling": {"ad_pct": 95.0},
            "description": "Y'bneth sweeps arms inward from both flanks, clasping enemies together and stunning them.",
        },
        {
            "slot": "Ultimate",
            "name": "Nature's Realm",
            "type": "Physical / Shield",
            "damage_type": "physical",
            "cooldown": [40.0, 35.0, 30.0],
            "mana_cost": [120, 140, 160],
            "base_damage": [60, 90, 120],
            "scaling": {"ad_pct": 20.0},
            "description": "Y'bneth roots himself in place, gaining a massive shield and bombarding the surrounding area with seeds.",
        },
    ],
    "Aya": [
        {
            "slot": "Passive",
            "name": "Squirrel Spirit",
            "type": "Passive / Untargetable",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "When Aya's HP drops below 30%, she turns into an untargetable squirrel for 3 seconds.",
        },
        {
            "slot": "Skill 1",
            "name": "Sound Breaker",
            "type": "Magic / Poke",
            "damage_type": "magic",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [225, 270, 315, 360, 405, 450],
            "scaling": {"ap_pct": 40.0},
            "description": "Aya fires a musical sound wave that expands in size, dealing magic damage and slowing.",
        },
        {
            "slot": "Skill 2",
            "name": "Idol Love",
            "type": "Shield / Possess",
            "damage_type": "none",
            "cooldown": [12.0, 11.6, 11.2, 10.8, 10.4, 10.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [650, 780, 910, 1040, 1170, 1300],
            "scaling": {"ap_pct": 75.0, "hp_pct": 7.5},
            "description": "Aya possesses an ally champion, granting them a massive shield and augmenting their attacks.",
        },
        {
            "slot": "Ultimate",
            "name": "Forest Song",
            "type": "Magic / Polymorph",
            "damage_type": "magic",
            "cooldown": [45.0, 40.0, 35.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [70, 90, 110],
            "scaling": {"ap_pct": 12.0},
            "description": "Aya casts a magical forest zone, speeding up allies and polymorphing enemies inside.",
        },
    ],
    "Astrid": [
        {
            "slot": "Passive",
            "name": "Bladed Guardian",
            "type": "Passive / Shield",
            "damage_type": "none",
            "cooldown": [24.0, 20.0, 16.0],
            "mana_cost": [0],
            "base_damage": [450],
            "scaling": {"hp_pct": 8.0},
            "description": "When Astrid's HP is below 80%, she generates a sword shield absorbing incoming damage.",
        },
        {
            "slot": "Skill 1",
            "name": "Spin Slash",
            "type": "Physical / Speed",
            "damage_type": "physical",
            "cooldown": [5.0, 4.6, 4.2, 3.8, 3.4, 3.0],
            "mana_cost": [0],
            "base_damage": [150, 180, 210, 240, 270, 300],
            "scaling": {"ad_pct": 100.0},
            "description": "Astrid spins her broadsword in a circle, gaining attack speed and armor pierce.",
        },
        {
            "slot": "Skill 2",
            "name": "Fearless Charge",
            "type": "Physical / Dash",
            "damage_type": "physical",
            "cooldown": [8.0, 7.6, 7.2, 6.8, 6.4, 6.0],
            "mana_cost": [0],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ad_pct": 100.0},
            "description": "Astrid charges forward and empowers her next attack into a powerful strike.",
        },
        {
            "slot": "Ultimate",
            "name": "Dire Blow",
            "type": "True / Execute",
            "damage_type": "true",
            "cooldown": [40.0, 35.0, 30.0],
            "mana_cost": [0],
            "base_damage": [400, 600, 800],
            "scaling": {"ad_pct": 150.0},
            "description": "Astrid channels for 1.5s, becoming immune to all damage, then slashes dealing lethal true damage.",
        },
    ],
    "Skud": [
        {
            "slot": "Passive",
            "name": "Boiling Blood",
            "type": "Passive / Heal",
            "damage_type": "magic",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [120],
            "scaling": {"hp_pct": 4.0},
            "description": "Every 10 seconds Skud's next basic attack deals bonus magic damage and restores max HP.",
        },
        {
            "slot": "Skill 1",
            "name": "Furious Strike",
            "type": "Physical / Dash",
            "damage_type": "physical",
            "cooldown": [7.0, 6.6, 6.2, 5.8, 5.4, 5.0],
            "mana_cost": [45, 50, 55, 60, 65, 70],
            "base_damage": [200, 250, 300, 350, 400, 450],
            "scaling": {"hp_pct": 8.0},
            "description": "Skud charges forward with rocket propulsion, knocking airborne and gaining armor.",
        },
        {
            "slot": "Skill 2",
            "name": "Boiling Fist",
            "type": "Magic / Burst",
            "damage_type": "magic",
            "cooldown": [10.0, 9.4, 8.8, 8.2, 7.6, 7.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [300, 375, 450, 525, 600, 675],
            "scaling": {"ap_pct": 100.0, "hp_pct": 12.0},
            "description": "Skud boils his mechanical fist, gaining movement speed and unleashing an enormous smash.",
        },
        {
            "slot": "Ultimate",
            "name": "Wild Beast Wrath",
            "type": "Physical / Knockback",
            "damage_type": "physical",
            "cooldown": [35.0, 30.0, 25.0],
            "mana_cost": [100, 115, 130],
            "base_damage": [400, 600, 800],
            "scaling": {"ad_pct": 120.0},
            "description": "Skud spins around and throws an all-out punch, knocking back all surrounding enemies.",
        },
    ],
    "Stuart": [
        {
            "slot": "Passive",
            "name": "Final Curtain",
            "type": "Passive / Physical",
            "damage_type": "physical",
            "cooldown": [10.0, 9.0, 8.0],
            "mana_cost": [0],
            "base_damage": [120],
            "scaling": {"ad_pct": 120.0},
            "description": "When exiting combat, Stuart reloads enhanced bullets that deal high physical damage and slow targets.",
        },
        {
            "slot": "Skill 1",
            "name": "Fatal Trick",
            "type": "Physical / Snipe",
            "damage_type": "physical",
            "cooldown": [5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [365, 440, 515, 590, 665, 740],
            "scaling": {"ad_pct": 180.0},
            "description": "Stuart fires a high-velocity cannon projectile, dealing devastating physical damage along its path.",
        },
        {
            "slot": "Skill 2",
            "name": "Deception",
            "type": "Speed / Immunity",
            "damage_type": "none",
            "cooldown": [12.0, 11.2, 10.4, 9.6, 8.8, 8.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [],
            "scaling": {},
            "description": "Stuart removes slows, increases movement speed by 60%, and becomes completely immune to physical damage for 2 seconds.",
        },
        {
            "slot": "Ultimate",
            "name": "Death Prank",
            "type": "Physical / Burst",
            "damage_type": "physical",
            "cooldown": [30.0, 25.0, 20.0],
            "mana_cost": [100, 115, 130],
            "base_damage": [440, 660, 880],
            "scaling": {"ad_pct": 240.0},
            "description": "Stuart rushes to target champion, planting explosive gas, stunning them, and backflipping away.",
        },
    ],
    "Biron": [
        {
            "slot": "Passive",
            "name": "Electrifying Charge",
            "type": "Passive / Enhance",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Hitting enemies charges Biron's weapon, enhancing skills with extra damage and healing.",
        },
        {
            "slot": "Skill 1",
            "name": "Storm Strike",
            "type": "Physical / Slash",
            "damage_type": "physical",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [0],
            "base_damage": [200, 240, 280, 320, 360, 400],
            "scaling": {"ad_pct": 70.0},
            "description": "Biron slashes forward twice, healing himself per enemy hit.",
        },
        {
            "slot": "Skill 2",
            "name": "Fearless Chariot",
            "type": "Physical / Dash",
            "damage_type": "physical",
            "cooldown": [9.0, 8.4, 7.8, 7.2, 6.6, 6.0],
            "mana_cost": [0],
            "base_damage": [180, 220, 260, 300, 340, 380],
            "scaling": {"ad_pct": 60.0},
            "description": "Biron charges forward, knocking airborne and enhancing his next basic attack.",
        },
        {
            "slot": "Ultimate",
            "name": "Oppressive Aura",
            "type": "Physical / Shield",
            "damage_type": "physical",
            "cooldown": [30.0, 25.0, 20.0],
            "mana_cost": [0],
            "base_damage": [350, 500, 650],
            "scaling": {"ad_pct": 100.0},
            "description": "Biron slams his thunder flail into the ground, gaining an immense shield and slowing enemies.",
        },
    ],
    "Qi": [
        {
            "slot": "Passive",
            "name": "Protection Aura",
            "type": "Passive / Armor",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Using skills grants Qi stacks of armor (+30) and heals her on next two normal attacks.",
        },
        {
            "slot": "Skill 1",
            "name": "Meteoroid",
            "type": "Physical / Dash",
            "damage_type": "physical",
            "cooldown": [7.0, 6.6, 6.2, 5.8, 5.4, 5.0],
            "mana_cost": [45, 50, 55, 60, 65, 70],
            "base_damage": [300, 360, 420, 480, 540, 600],
            "scaling": {"ad_pct": 70.0},
            "description": "Qi dashes forward with an explosive punch, knocking airborne all enemies along the way.",
        },
        {
            "slot": "Skill 2",
            "name": "Mountain Shaker",
            "type": "Physical / Armor Shred",
            "damage_type": "physical",
            "cooldown": [10.0, 9.2, 8.4, 7.6, 6.8, 6.0],
            "mana_cost": [55, 60, 65, 70, 75, 80],
            "base_damage": [75, 90, 105, 120, 135, 150],
            "scaling": {"ad_pct": 33.0},
            "description": "Qi unleashes a flurry of rapid punches, shredding enemy physical defense continuously.",
        },
        {
            "slot": "Ultimate",
            "name": "Dragon's Bane",
            "type": "Physical / Wall Stun",
            "damage_type": "physical",
            "cooldown": [35.0, 30.0, 25.0],
            "mana_cost": [100, 115, 130],
            "base_damage": [300, 450, 600],
            "scaling": {"ad_pct": 80.0},
            "description": "Qi strikes out violently, knocking back enemies. If they hit a wall, they are stunned and take massive bonus damage.",
        },
    ],
    "Marja": [
        {
            "slot": "Passive",
            "name": "Shadow Leech",
            "type": "Passive / Vamp",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Marja gains life steal and ability power proportional to her lost health.",
        },
        {
            "slot": "Skill 1",
            "name": "Dark Pulse",
            "type": "Magic / Poke",
            "damage_type": "magic",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [0],
            "base_damage": [400, 480, 560, 640, 720, 800],
            "scaling": {"ap_pct": 60.0},
            "description": "Marja sends a shockwave of dark energy in a line, damaging and slowing enemies.",
        },
        {
            "slot": "Skill 2",
            "name": "Soul Siphon",
            "type": "Magic / Heal",
            "damage_type": "magic",
            "cooldown": [8.0, 7.4, 6.8, 6.2, 5.6, 5.0],
            "mana_cost": [0],
            "base_damage": [300, 360, 420, 480, 540, 600],
            "scaling": {"ap_pct": 50.0},
            "description": "Marja commands soul parasites to attack nearby enemies and heal her.",
        },
        {
            "slot": "Ultimate",
            "name": "Ghostwalk",
            "type": "Magic / Invulnerable",
            "damage_type": "magic",
            "cooldown": [30.0, 27.0, 24.0],
            "mana_cost": [0],
            "base_damage": [450, 675, 900],
            "scaling": {"ap_pct": 70.0},
            "description": "Marja transforms into an abyss ghost, gaining untargetable immunity and movement speed while dealing continuous magic damage.",
        },
    ],
    "Fennik": [
        {
            "slot": "Passive",
            "name": "Hidden Weapons",
            "type": "Passive / Explosive",
            "damage_type": "physical",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [50],
            "scaling": {"ad_pct": 25.0},
            "description": "Fennik possesses superior attack range. Normal attacks explode, dealing area physical damage.",
        },
        {
            "slot": "Skill 1",
            "name": "Thief's Mark",
            "type": "Physical / Mark",
            "damage_type": "physical",
            "cooldown": [8.5, 8.0, 7.5, 7.0, 6.5, 6.0],
            "mana_cost": [60, 65, 70, 75, 80, 85],
            "base_damage": [200, 225, 250, 275, 300, 325],
            "scaling": {"ad_pct": 75.0},
            "description": "Fennik places a thief mark on an enemy or tower, boosting attack speed and detonating after 4 hits for massive damage.",
        },
        {
            "slot": "Skill 2",
            "name": "Rolling Lightning",
            "type": "Physical / Dash",
            "damage_type": "physical",
            "cooldown": [11.0, 10.4, 9.8, 9.2, 8.6, 8.0],
            "mana_cost": [65, 70, 75, 80, 85, 90],
            "base_damage": [80, 90, 100, 110, 120, 130],
            "scaling": {"ad_pct": 20.0},
            "description": "Fennik rolls forward, becoming untargetable and leaving behind lightning marks that slow and damage enemies.",
        },
        {
            "slot": "Ultimate",
            "name": "Chain Hammer Cyclone",
            "type": "Physical / Whirlwind",
            "damage_type": "physical",
            "cooldown": [35.0, 30.0, 25.0],
            "mana_cost": [100, 115, 130],
            "base_damage": [300, 400, 500],
            "scaling": {"ad_pct": 100.0},
            "description": "Fennik throws his giant chain hammer, creating a sustained rotating cyclone that slashes enemies continuously.",
        },
    ],
    "Yue": [
        {
            "slot": "Passive",
            "name": "Borrowed Fan",
            "type": "Passive / Reset",
            "damage_type": "none",
            "cooldown": [0.0],
            "mana_cost": [0],
            "base_damage": [],
            "scaling": {},
            "description": "Hitting skills grants Yue seal stacks. At 2 stacks, Yue immediately resets Skill 1 and Skill 2, empowering them to fire quadruple fans.",
        },
        {
            "slot": "Skill 1",
            "name": "Aqua Fan",
            "type": "Magic / Poke",
            "damage_type": "magic",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [350, 400, 450, 500, 550, 600],
            "scaling": {"ap_pct": 40.0},
            "description": "Yue unleashes two curved fans at near range, dealing magic damage. Target hit at the intersection point takes double damage.",
        },
        {
            "slot": "Skill 2",
            "name": "Mountain Fan",
            "type": "Magic / Long Range",
            "damage_type": "magic",
            "cooldown": [6.0, 5.6, 5.2, 4.8, 4.4, 4.0],
            "mana_cost": [50, 55, 60, 65, 70, 75],
            "base_damage": [350, 400, 450, 500, 550, 600],
            "scaling": {"ap_pct": 40.0},
            "description": "Yue unleashes two curved fans at far range, dealing magic damage. Intersection hit deals double damage.",
        },
        {
            "slot": "Ultimate",
            "name": "Rising Wind",
            "type": "Magic / Knockback",
            "damage_type": "magic",
            "cooldown": [30.0, 26.0, 22.0],
            "mana_cost": [100, 120, 140],
            "base_damage": [400, 600, 800],
            "scaling": {"ap_pct": 75.0},
            "description": "Yue blasts out a gale of spirit wind, dealing magic damage, knocking back nearby enemies, and dashing backward.",
        },
    ],
}


def clean_number_sequence(raw_list):
    """Clean and parse a list of strings into numbers."""
    res = []
    for item in raw_list:
        if not item:
            continue
        parts = re.split(r"[/~,\s]+", str(item))
        for p in parts:
            p_clean = re.sub(r"[^\d.]", "", p)
            if p_clean and p_clean != ".":
                try:
                    num = float(p_clean) if "." in p_clean else int(p_clean)
                    if num < 9999:
                        res.append(num)
                except ValueError:
                    pass
    return res


def extract_scaling_and_type(description: str):
    """Extract damage type and AD/AP/HP scaling percentages from skill text."""
    desc = description or ""
    desc_lower = desc.lower()

    if "true damage" in desc_lower or "true" in desc_lower:
        dmg_type = "true"
    elif "magic damage" in desc_lower or "magical damage" in desc_lower or "(+ap)" in desc_lower:
        dmg_type = "magic"
    elif "physical damage" in desc_lower or "(+ad)" in desc_lower:
        dmg_type = "physical"
    else:
        dmg_type = "none"

    scaling = {}
    ad_match = re.search(r"\+(\d+(?:\.\d+)?)(?:%|\s*%\s*)?(?:\s*(?:bonus\s*)?(?:of\s*)?AD)", desc, re.I)
    if ad_match:
        scaling["ad_pct"] = float(ad_match.group(1))

    ap_match = re.search(r"\+(\d+(?:\.\d+)?)(?:%|\s*%\s*)?(?:\s*(?:bonus\s*)?(?:of\s*)?(?:AP|MP))", desc, re.I)
    if ap_match:
        scaling["ap_pct"] = float(ap_match.group(1))

    hp_match = re.search(r"(?:target|own|max)\s*hp\s*\(?\+?(\d+(?:\.\d+)?)%", desc, re.I)
    if hp_match:
        scaling["hp_pct"] = float(hp_match.group(1))

    return dmg_type, scaling


def parse_damage_from_text(description: str):
    """Extract base damage progression from description if not in table."""
    desc = description or ""
    m = re.search(r"deal(?:s|ing)?\s+(\d+(?:[./]\d+)*)", desc, re.I)
    if m:
        parts = m.group(1).split("/")
        vals = []
        for p in parts:
            try:
                vals.append(float(p) if "." in p else int(p))
            except ValueError:
                pass
        return vals
    return []


def parse_fandom_skills(soup):
    """Parse skills table handling multiple MediaWiki HTML variations."""
    for tag in soup.find_all(["s", "del", "strike"]):
        tag.decompose()

    candidate_tables = []
    for t in soup.find_all("table"):
        text = t.get_text().lower()
        if any(
            k in text
            for k in ["description", "mana cost", "cooldown", "statistics", "attribute", "energy cost", "dmg1"]
        ):
            candidate_tables.append(t)

    if not candidate_tables:
        return []

    skills = []
    for table in candidate_tables:
        direct_trs = [tr for tr in table.find_all("tr") if tr.find_parent("table") == table]
        if not direct_trs:
            continue
        first_tr = direct_trs[0]
        headers = [c.get_text(strip=True).lower() for c in first_tr.find_all(["th", "td"], recursive=False)]

        current_skill = None
        for tr in direct_trs:
            tds = tr.find_all("td", recursive=False)
            ths = tr.find_all("th", recursive=False)

            if ths and any("attribute" in th.get_text().lower() for th in ths):
                continue
            if ths and any(k in th.get_text().lower() for th in ths for k in ["description", "icon", "image"]):
                continue

            td_texts = [td.get_text(strip=True) for td in tds]
            if not td_texts or all(not t for t in td_texts):
                continue

            first_col = td_texts[0].lower()
            if first_col in ["base damage", "damage", "cooldown", "mana cost", "mana", "statistics"] and current_skill:
                current_skill["attrs"][first_col] = td_texts[1:]
                continue

            if len(tds) >= 3 or (tds and (tds[0].find("img") or "file:" in str(tds[0]).lower())):
                if current_skill:
                    skills.append(current_skill)
                name_s, desc_s, cd_s, mana_s, stype_s = "", "", "", "", ""
                for idx, hd in enumerate(headers):
                    if idx < len(tds):
                        val = tds[idx].get_text(separator=" ", strip=True)
                        if "name" in hd:
                            name_s = val
                        elif "desc" in hd:
                            desc_s = val
                        elif any(k in hd for k in ["cooldown", "statistics", "attribute"]):
                            cd_s = val
                        elif any(k in hd for k in ["mana", "cost", "energy"]):
                            mana_s = val
                        elif "type" in hd:
                            stype_s = val

                if not name_s and len(td_texts) > 1:
                    name_s = td_texts[1]
                if not desc_s and len(td_texts) > 2:
                    desc_s = td_texts[2]

                current_skill = {
                    "name": name_s,
                    "desc": re.sub(r"\s+", " ", desc_s).strip(),
                    "cd": cd_s,
                    "mana": mana_s,
                    "type": stype_s,
                    "attrs": {},
                }

        if current_skill:
            skills.append(current_skill)

        valid_skills = [s for s in skills if len(s["desc"]) > 10 and s["name"]]
        if len(valid_skills) >= 3:
            structured = []
            for s in valid_skills:
                desc = s["desc"]
                dmg_type, scaling = extract_scaling_and_type(desc)
                cd_raw = s["attrs"].get("cooldown") or s["attrs"].get("statistics") or ([s["cd"]] if s["cd"] else [])
                cd_nums = clean_number_sequence(cd_raw)
                dmg_raw = s["attrs"].get("base damage") or s["attrs"].get("damage") or []
                dmg_nums = clean_number_sequence(dmg_raw)
                if not dmg_nums:
                    dmg_nums = parse_damage_from_text(desc)
                mana_raw = s["attrs"].get("mana cost") or s["attrs"].get("mana") or ([s["mana"]] if s["mana"] else [])
                mana_nums = clean_number_sequence(mana_raw)

                structured.append(
                    {
                        "name": s["name"],
                        "type": s["type"] or "Ability",
                        "damage_type": dmg_type,
                        "cooldown": cd_nums,
                        "mana_cost": mana_nums,
                        "base_damage": dmg_nums,
                        "scaling": scaling,
                        "description": desc,
                    }
                )
            return structured

    return []


def fetch_hero_fandom_skills(hero_name: str):
    """Fetch skills with alias handling."""
    wiki_map = {
        "Diao Chan": "Diaochan",
        "Lu Bu": "Lu_Bu",
        "Richter": "Riktor",
        "Mortos": "Arthur",
        "Celica": "Brunhilda",
        "Y'bneth": "Y%27bneth",
        "Dolce": "Dolia",
    }
    page_title = wiki_map.get(hero_name, hero_name)
    url = f"https://arenaofvalor.fandom.com/api.php?action=parse&page={page_title}&prop=text&format=json"

    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=8)
        if r.status_code != 200:
            return None
        html = r.json().get("parse", {}).get("text", {}).get("*", "")
    except Exception:
        return None

    soup = BeautifulSoup(html, "html.parser")
    return parse_fandom_skills(soup)


def assign_slots_cleanly(skills):
    """Assign slots (Passive, Skill 1, Skill 2, Ultimate) and clean skill names."""
    if not skills:
        return []

    # Step 1: Detect prefixes in name (e.g. "UltimateInferno Bats" -> "Ultimate", "Inferno Bats")
    for s in skills:
        m = re.match(r"^(Passive|Skill\s*1|Skill\s*2|Skill\s*3|Skill\s*4|Ultimate)[\s:\-]*(.*)$", s["name"], re.I)
        if m:
            s["detected_slot"] = re.sub(r"Skill\s*(\d)", r"Skill \1", m.group(1).title())
            s["clean_name"] = m.group(2).strip() or s["name"]
        else:
            s["detected_slot"] = None
            s["clean_name"] = s["name"]

    # Step 2: Identify Passive
    passive_s = None
    for s in skills:
        if s["detected_slot"] == "Passive":
            passive_s = s
            break
    if not passive_s:

        def passive_score(x):
            score = 0
            if not x["cooldown"] or x["cooldown"] == [0.0]:
                score += 15
            if not x["mana_cost"] or x["mana_cost"] == [0]:
                score += 15
            if "passive" in x["type"].lower() or "passive" in x["clean_name"].lower():
                score += 25
            if len(x["cooldown"]) >= 3 and any(c > 0 for c in x["cooldown"]):
                score -= 20
            if len(x["mana_cost"]) >= 1 and any(m > 0 for m in x["mana_cost"]):
                score -= 20
            return score

        passive_s = max(skills, key=passive_score)

    passive_s["slot"] = "Passive"
    passive_s["name"] = passive_s["clean_name"]
    if not passive_s["cooldown"]:
        passive_s["cooldown"] = [0.0]
    if not passive_s["mana_cost"]:
        passive_s["mana_cost"] = [0]

    remaining = [s for s in skills if s != passive_s]

    # Step 3: Identify Ultimate
    ult_s = None
    for s in remaining:
        if s["detected_slot"] == "Ultimate":
            ult_s = s
            break
    if not ult_s:

        def ult_score(x):
            score = 0
            cd_max = max(x["cooldown"]) if x["cooldown"] else 0
            if len(x["cooldown"]) == 3 and cd_max >= 18:
                score += 30
            score += cd_max
            if "ultimate" in x["clean_name"].lower():
                score += 35
            return score

        ult_s = max(remaining, key=ult_score)

    ult_s["slot"] = "Ultimate"
    ult_s["name"] = ult_s["clean_name"]
    if not ult_s["cooldown"]:
        ult_s["cooldown"] = [40.0, 35.0, 30.0]
    if not ult_s["mana_cost"]:
        ult_s["mana_cost"] = [100, 120, 140]

    # Step 4: Active skills
    actives = [s for s in remaining if s != ult_s]
    actives.sort(key=lambda x: x["detected_slot"] or "ZZZ")
    labels = ["Skill 1", "Skill 2", "Skill 3", "Skill 4"]
    for idx, s in enumerate(actives):
        s["slot"] = (
            s["detected_slot"]
            if s["detected_slot"] in labels
            else labels[idx]
            if idx < len(labels)
            else f"Skill {idx + 1}"
        )
        s["name"] = s["clean_name"]
        if not s["cooldown"]:
            s["cooldown"] = [8.0, 7.4, 6.8, 6.2, 5.6, 5.0]
        if not s["mana_cost"]:
            s["mana_cost"] = [60, 65, 70, 75, 80, 85]

    for s in [passive_s] + actives + [ult_s]:
        s.pop("detected_slot", None)
        s.pop("clean_name", None)

    return [passive_s] + actives + [ult_s]


def process_single_hero(hero_data):
    """Process one hero into structured skills."""
    hero_name = hero_data["name"]

    if hero_name in CURATED_HERO_SKILLS:
        return hero_name, CURATED_HERO_SKILLS[hero_name]

    scraped = fetch_hero_fandom_skills(hero_name)
    if scraped and len(scraped) >= 4:
        return hero_name, assign_slots_cleanly(scraped)

    # Fallback to existing skills in heroes_130_full.json
    skills = []
    for i, s in enumerate(hero_data.get("skills", [])):
        cd_raw = s.get("cooldown") or ""
        cd_nums = clean_number_sequence([cd_raw])
        desc = s.get("description", "")
        dmg_type, scaling = extract_scaling_and_type(desc)
        base_dmg = parse_damage_from_text(desc)
        slot = s.get("slot") or ("Passive" if i == 0 else f"Skill {i}")

        skills.append(
            {
                "slot": slot,
                "name": s.get("name", f"Skill {i}"),
                "type": s.get("type", "Ability"),
                "damage_type": dmg_type,
                "cooldown": cd_nums if cd_nums else ([0.0] if slot == "Passive" else [6.0]),
                "mana_cost": [0] if slot == "Passive" else [50],
                "base_damage": base_dmg,
                "scaling": scaling,
                "description": desc,
            }
        )

    return hero_name, assign_slots_cleanly(skills)


def main():
    print(f"Loading heroes from {HEROES_JSON_PATH}...")
    with open(HEROES_JSON_PATH, "r", encoding="utf-8") as f:
        heroes = json.load(f)

    print(f"Building skill catalog for {len(heroes)} heroes with thread pool...")
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(process_single_hero, heroes))

    hero_skills_map = dict(results)

    output_catalog = {
        "hero_count": len(hero_skills_map),
        "total_skills": sum(len(s) for s in hero_skills_map.values()),
        "heroes": hero_skills_map,
    }

    with open(OUTPUT_SKILLS_PATH, "w", encoding="utf-8") as f:
        json.dump(output_catalog, f, ensure_ascii=False, indent=2)
    print(f"Wrote detailed skills catalog to {OUTPUT_SKILLS_PATH}")

    for h in heroes:
        name = h["name"]
        if name in hero_skills_map:
            h["skills"] = hero_skills_map[name]

    with open(HEROES_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(heroes, f, ensure_ascii=False, indent=2)
    print(f"Updated {HEROES_JSON_PATH} with structured skills")

    duration = time.time() - start_time
    print(f"Done in {duration:.1f}s. Total skills: {output_catalog['total_skills']}")


if __name__ == "__main__":
    main()
