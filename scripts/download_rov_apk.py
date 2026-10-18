#!/usr/bin/env python3
"""
scripts/download_rov_apk.py
Download and inspect official Garena RoV (Arena of Valor) APK / XAPK assets.
Supports HTTP Range inspection of package contents without full download,
and full download extraction when --download is specified.
"""

from __future__ import annotations

import argparse
import io
import struct
import zipfile
from pathlib import Path

import requests

PACKAGE_NAME = "com.garena.game.kgth"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# APKPure direct download endpoints
XAPK_URL = f"https://d.apkpure.net/b/XAPK/{PACKAGE_NAME}?version=latest"
BASE_APK_URL = f"https://d.apkpure.net/b/APK/{PACKAGE_NAME}?version=latest"


def inspect_xapk_central_directory(url: str, user_agent: str = DEFAULT_USER_AGENT) -> dict:
    """Inspect XAPK structure using HTTP Range requests."""
    headers = {"User-Agent": user_agent}
    r = requests.head(url, headers=headers, allow_redirects=True, timeout=15)
    if r.status_code != 200:
        raise RuntimeError(f"Failed to resolve XAPK: HTTP {r.status_code}")

    real_url = r.url
    total_length = int(r.headers.get("Content-Length", 0))

    # Request the last 64 KB to locate the End of Central Directory (EOCD)
    headers["Range"] = f"bytes={total_length - 65536}-{total_length - 1}"
    tail = requests.get(real_url, headers=headers, timeout=15).content

    eocd_pos = tail.rfind(b"\x50\x4b\x05\x06")
    if eocd_pos == -1:
        raise RuntimeError("EOCD record not found in tail")

    eocd = tail[eocd_pos:]
    num_records, cd_size, cd_offset = struct.unpack("<HII", eocd[10:20])

    # Fetch the Central Directory
    headers["Range"] = f"bytes={cd_offset}-{cd_offset + cd_size - 1}"
    cd_data = requests.get(real_url, headers=headers, timeout=20).content

    virtual_zip = io.BytesIO(b"\x00" * cd_offset + cd_data + eocd)
    z = zipfile.ZipFile(virtual_zip)

    entries = []
    for info in z.infolist():
        entries.append(
            {
                "filename": info.filename,
                "file_size": info.file_size,
                "compress_size": info.compress_size,
                "header_offset": info.header_offset,
            }
        )

    return {
        "package_name": PACKAGE_NAME,
        "total_bytes": total_length,
        "total_files": num_records,
        "files": entries,
        "real_url": real_url,
    }


def download_file(url: str, out_path: Path, user_agent: str = DEFAULT_USER_AGENT) -> None:
    """Download a file with progress indication."""
    headers = {"User-Agent": user_agent}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, headers=headers, stream=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        downloaded = 0
        chunk_size = 1024 * 1024
        with open(out_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=chunk_size):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = downloaded / total * 100
                        print(
                            f"\rDownloading: {downloaded / 1024 / 1024:.1f}/{total / 1024 / 1024:.1f} MB ({pct:.1f}%)",
                            end="",
                            flush=True,
                        )
        print()


def main():
    parser = argparse.ArgumentParser(description="Garena RoV APK / XAPK Inspector & Downloader")
    parser.add_argument(
        "--inspect", action="store_true", default=True, help="Inspect XAPK structure without full download"
    )
    parser.add_argument("--download", action="store_true", help="Download the complete APK/XAPK")
    parser.add_argument(
        "--out-dir", type=Path, default=Path("downloads/apk"), help="Output directory for downloaded files"
    )
    parser.add_argument(
        "--type", choices=["xapk", "apk"], default="xapk", help="Package type to download (xapk or apk)"
    )
    args = parser.parse_args()

    print(f"=== Garena RoV ({PACKAGE_NAME}) Inspector ===")
    target_url = XAPK_URL if args.type == "xapk" else BASE_APK_URL

    if args.inspect and not args.download:
        print(f"Querying package info via HTTP Range: {target_url} ...")
        info = inspect_xapk_central_directory(target_url)
        print(f"Package: {info['package_name']}")
        print(f"Total Size: {info['total_bytes'] / (1024 * 1024):.2f} MB")
        print(f"Total Files in Package: {info['total_files']}")
        print("\nFiles in bundle:")
        for f in info["files"]:
            print(f"  - {f['filename']:40s} ({f['file_size'] / (1024 * 1024):.2f} MB)")
        return

    if args.download:
        ext = "xapk" if args.type == "xapk" else "apk"
        out_file = args.out_dir / f"rov_latest.{ext}"
        print(f"Downloading {args.type.upper()} to {out_file}...")
        download_file(target_url, out_file)
        print(f"Download complete: {out_file} ({out_file.stat().st_size / (1024 * 1024):.2f} MB)")


if __name__ == "__main__":
    main()
