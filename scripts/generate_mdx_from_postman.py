import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POSTMAN_PATH = Path(r"C:\Users\Jasmon\Downloads\Online Check Writer API V3.postman_collection.json")
OUTPUT_ROOT = ROOT / "api-reference" / "generated"


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "endpoint"


def extract_path_and_method(item):
    req = item.get("request", {})
    method = req.get("method", "GET").upper()
    url = req.get("url", {})

    # Prefer path array from Postman
    path_parts = url.get("path")
    if isinstance(path_parts, list) and path_parts:
        path = "/" + "/".join(str(p).strip() for p in path_parts if str(p).strip())
    else:
        raw = url.get("raw", "")
        # Strip {{BASE_URL}} or similar
        m = re.search(r"}}(.*)", raw)
        path = m.group(1) if m else raw
        if not path.startswith("/"):
            path = "/" + path

    # Remove empty trailing slash
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    return method, path


def extract_example_response(item):
    responses = item.get("response") or []
    if not responses:
        return None
    body = responses[0].get("body")
    if not body:
        return None
    body = body.strip()
    # Try to pretty-format JSON if possible
    try:
        parsed = json.loads(body)
        return json.dumps(parsed, indent=2)
    except Exception:
        return body


def write_endpoint_page(group_segments, item, out_dir: Path, index_entries):
    name = item.get("name") or "Endpoint"
    method, path = extract_path_and_method(item)
    description = ""
    req = item.get("request", {})
    if isinstance(req.get("description"), str):
        description = req["description"].strip()

    example = extract_example_response(item)

    # Build file path
    group_slug_parts = [slugify(seg) for seg in group_segments if seg]
    file_slug = slugify(name)
    rel_dir = Path(*group_slug_parts) if group_slug_parts else Path(".")
    full_dir = out_dir / rel_dir
    full_dir.mkdir(parents=True, exist_ok=True)
    file_path = full_dir / f"{file_slug}.mdx"

    # MDX frontmatter and content
    api_value = f"{method} {path}"
    title = name

    lines = []
    lines.append("---")
    lines.append(f"title: '{title}'")
    lines.append(f"api: '{api_value}'")
    lines.append("---")
    lines.append("")
    if description:
        lines.append(description)
        lines.append("")
    lines.append("## Request")
    lines.append("")
    lines.append(f"Endpoint: `{api_value}`")
    lines.append("")
    lines.append("### Example")
    lines.append("")
    lines.append("```bash")
    lines.append(f'curl --location "$BASE_URL{path}" \\')
    lines.append('  --header "Authorization: Bearer $AUTH_TOKEN"')
    lines.append("```")
    lines.append("")
    if example:
        lines.append("## Response example")
        lines.append("")
        lines.append("```json")
        lines.append(example)
        lines.append("```")
        lines.append("")

    file_path.write_text("\n".join(lines), encoding="utf-8")

    # Index entry
    rel_page_path = f"api-reference/generated/{rel_dir.as_posix()}/{file_slug}".replace("//", "/").rstrip("/")
    index_entries.append(
        {
            "group": " / ".join(group_segments) if group_segments else "",
            "title": title,
            "method": method,
            "path": path,
            "page": rel_page_path,
        }
    )


def walk_items(items, parent_segments, out_dir: Path, index_entries):
    for item in items or []:
        name = item.get("name") or ""
        children = item.get("item")
        if children:
            # Folder
            walk_items(children, parent_segments + [name], out_dir, index_entries)
        else:
            # Leaf request
            write_endpoint_page(parent_segments, item, out_dir, index_entries)


def write_index_page(out_dir: Path, index_entries):
    index_path = ROOT / "api-reference" / "all-endpoints.mdx"
    lines = []
    lines.append("---")
    lines.append("title: 'All endpoints'")
    lines.append("description: 'Index of all Online Check Writer API v3 endpoints generated from the Postman collection'")
    lines.append("---")
    lines.append("")
    lines.append("This page lists all endpoints that were generated from the Online Check Writer API v3 Postman collection.")
    lines.append("")
    lines.append("| Group | Method | Path | Page |")
    lines.append("| --- | --- | --- | --- |")
    for entry in sorted(index_entries, key=lambda e: (e["group"], e["path"], e["method"])):
        group = entry["group"] or "Root"
        method = entry["method"]
        path = entry["path"]
        page = entry["page"]
        lines.append(f"| {group} | `{method}` | `{path}` | [{entry['title']}](/{page}) |")

    index_path.write_text("\n".join(lines), encoding="utf-8")


def main():
    if not POSTMAN_PATH.exists():
        raise SystemExit(f"Postman collection not found at {POSTMAN_PATH}")

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    with POSTMAN_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)

    items = data.get("item") or []
    index_entries = []
    walk_items(items, [], OUTPUT_ROOT, index_entries)
    write_index_page(OUTPUT_ROOT, index_entries)
    print(f"Generated {len(index_entries)} endpoint pages under {OUTPUT_ROOT}")


if __name__ == "__main__":
    main()

