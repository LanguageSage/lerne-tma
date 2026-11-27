"""Build and verify a deterministic PEP 427 lerne-sqlite-schema wheel using stdlib only."""

from __future__ import annotations

import argparse
import base64
import csv
from hashlib import sha256
import io
import json
from pathlib import Path
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "sqlite_schema"
PACKAGE = PROJECT / "lerne_sqlite_schema"


def package_files() -> dict[str, str]:
    files: dict[str, str] = {}
    for path in sorted(PACKAGE.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
            continue
        raw = path.read_bytes()
        if b"\r" in raw:
            raise RuntimeError(f"Package source must use LF line endings: {path}")
        rel = path.relative_to(PACKAGE).as_posix()
        files[rel] = sha256(raw).hexdigest()
    return files


def verify_sources() -> dict:
    pyproject = tomllib.loads((PROJECT / "pyproject.toml").read_text(encoding="utf-8"))
    project = pyproject["project"]
    version = project["version"]
    init_text = (PACKAGE / "__init__.py").read_text(encoding="utf-8")
    if f'__version__ = "{version}"' not in init_text:
        raise RuntimeError("pyproject.toml and __init__.py versions differ")

    manifest = json.loads((PACKAGE / "schema_manifest.json").read_text(encoding="utf-8"))
    files = package_files()
    for entry in manifest["migrations"]:
        rel = f"migrations/{entry['filename']}"
        if files.get(rel) != entry["sha256"]:
            raise RuntimeError(f"schema_manifest.json mismatch for {rel}")

    return {
        "name": project["name"],
        "version": version,
        "description": project["description"],
        "requires_python": project["requires-python"],
        "schema_format": manifest["format"],
        "schema_version": manifest["schema_version"],
        "files": files,
    }


def verify_wheel(wheel_path: Path) -> dict:
    meta = verify_sources()
    dist_info = f"lerne_sqlite_schema-{meta['version']}.dist-info"
    with zipfile.ZipFile(wheel_path) as zf:
        members = set(zf.namelist())
        expected_pkg = {f"lerne_sqlite_schema/{rel}" for rel in meta["files"]}
        if not expected_pkg.issubset(members):
            raise RuntimeError("Wheel missing package files")
        for rel, expected in meta["files"].items():
            actual = sha256(zf.read(f"lerne_sqlite_schema/{rel}")).hexdigest()
            if actual != expected:
                raise RuntimeError(f"Wheel file mismatch: {rel}")
        records = list(csv.reader(io.StringIO(zf.read(f"{dist_info}/RECORD").decode("utf-8"))))
        for name, digest, size in records:
            if name == f"{dist_info}/RECORD":
                continue
            raw = zf.read(name)
            expected_digest = "sha256=" + base64.urlsafe_b64encode(sha256(raw).digest()).rstrip(b"=").decode()
            if digest != expected_digest or size != str(len(raw)):
                raise RuntimeError(f"Wheel RECORD mismatch: {name}")
    return {
        "name": meta["name"],
        "version": meta["version"],
        "schema_format": meta["schema_format"],
        "schema_version": meta["schema_version"],
        "files": meta["files"],
        "wheel": wheel_path.name,
        "wheel_sha256": sha256(wheel_path.read_bytes()).hexdigest(),
    }


def build_wheel(output_dir: Path, *, manifest_out: Path | None = None) -> dict:
    meta = verify_sources()
    version = meta["version"]
    dist_info = f"lerne_sqlite_schema-{version}.dist-info"
    wheel_name = f"lerne_sqlite_schema-{version}-py3-none-any.whl"
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / wheel_name

    entries: dict[str, bytes] = {}
    for rel in sorted(meta["files"]):
        entries[f"lerne_sqlite_schema/{rel}"] = (PACKAGE / rel).read_bytes()

    entries[f"{dist_info}/METADATA"] = (
        "Metadata-Version: 2.1\n"
        f"Name: {meta['name']}\n"
        f"Version: {version}\n"
        f"Summary: {meta['description']}\n"
        f"Requires-Python: {meta['requires_python']}\n"
    ).encode("utf-8")
    entries[f"{dist_info}/WHEEL"] = (
        "Wheel-Version: 1.0\n"
        "Generator: lerne-sqlite-schema-builder\n"
        "Root-Is-Purelib: true\n"
        "Tag: py3-none-any\n"
    ).encode("utf-8")
    entries[f"{dist_info}/top_level.txt"] = b"lerne_sqlite_schema\n"

    rows: list[list[str]] = []
    for name in sorted(entries):
        raw = entries[name]
        digest = "sha256=" + base64.urlsafe_b64encode(sha256(raw).digest()).rstrip(b"=").decode()
        rows.append([name, digest, str(len(raw))])
    record_path = f"{dist_info}/RECORD"
    rows.append([record_path, "", ""])
    buf = io.StringIO(newline="")
    csv.writer(buf, lineterminator="\n").writerows(rows)
    entries[record_path] = buf.getvalue().encode("utf-8")

    fixed_time = (2026, 11, 27, 0, 0, 0)
    tmp = target.with_name(wheel_name + ".tmp")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=fixed_time)
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, entries[name], compresslevel=9)
    tmp.replace(target)

    result = verify_wheel(target)
    if manifest_out is not None:
        manifest_out.parent.mkdir(parents=True, exist_ok=True)
        manifest_out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "local/test-data/sqlite-schema-dist")
    parser.add_argument("--manifest-out", type=Path, default=None)
    parser.add_argument("--verify", type=Path, default=None)
    args = parser.parse_args()
    if args.verify is not None:
        print(json.dumps(verify_wheel(args.verify), indent=2))
        return
    print(json.dumps(build_wheel(args.output, manifest_out=args.manifest_out), indent=2))


if __name__ == "__main__":
    main()
