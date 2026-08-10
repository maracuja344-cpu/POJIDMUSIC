"""Verify that the versioned PWA shell matches the real production import graph."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "js" / "script.js"
SW_PATH = ROOT / "service-worker.js"
IMPORT_RE = re.compile(
    r"(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)[\"']([^\"']+)[\"']",
    re.MULTILINE,
)


def local_imports(path: Path):
    source = path.read_text(encoding="utf-8")
    for specifier in IMPORT_RE.findall(source):
        parsed = urlparse(specifier)
        if parsed.scheme or not specifier.startswith("."):
            continue
        yield (path.parent / parsed.path).resolve()


def production_graph():
    pending = [ENTRY]
    visited = set()
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        if not path.is_file():
            raise AssertionError(f"Missing imported module: {path.relative_to(ROOT)}")
        visited.add(path)
        pending.extend(local_imports(path))
    return {"./" + path.relative_to(ROOT).as_posix() for path in visited}


def array_values(source: str, name: str):
    match = re.search(
        rf"const\s+{re.escape(name)}\s*=\s*\[(.*?)\];",
        source,
        re.DOTALL,
    )
    if not match:
        raise AssertionError(f"Missing {name}")
    return set(re.findall(r'''["']([^"']+)["']''', match.group(1)))


def main():
    sw = SW_PATH.read_text(encoding="utf-8")
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    client = (ROOT / "js" / "supabase" / "client.js").read_text(encoding="utf-8")
    graph = production_graph()
    critical = array_values(sw, "CRITICAL_SHELL_ASSETS")
    sdk_assets = array_values(sw, "SDK_ASSETS")
    cached_modules = {
        asset for asset in critical
        if asset.startswith("./js/") and asset.endswith(".js")
    }
    missing = sorted(graph - cached_modules)
    extra = sorted(cached_modules - graph)

    assert not missing, "Modules missing from shell: " + ", ".join(missing)
    assert not extra, "Unused JS entries in shell: " + ", ".join(extra)

    release = re.search(r'''RELEASE_VERSION\s*=\s*["']([^"']+)''', sw).group(1)
    assert f'<meta name="pojidmusic-release" content="{release}">' in index

    sdk_import = re.search(r'''from\s+["'](https://esm\.sh/[^"']+)''', client).group(1)
    assert sdk_import in sdk_assets, "Pinned SDK entry is not in SDK_ASSETS"
    assert re.search(r"@supabase/supabase-js@\d+\.\d+\.\d+\?bundle$", sdk_import)

    print(f"PASS production graph: {len(graph)} modules")
    print(f"PASS critical shell: {len(critical)} resources")
    print(f"PASS release marker: {release}")
    print(f"PASS pinned SDK graph: {len(sdk_assets)} resources")


if __name__ == "__main__":
    main()
