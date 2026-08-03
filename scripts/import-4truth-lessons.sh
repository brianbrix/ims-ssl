#!/usr/bin/env bash
set -euo pipefail

SOURCE_URL="${SOURCE_URL:-https://www.4truth.ca/downloads/sabbath-school-lessons/}"
API_BASE_URL="${API_BASE_URL:-${VPS_API_BASE_URL:-}}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
TITLE_FALLBACK="${TITLE:-Sabbath School Lessons}"
PERIOD_PREFIX="${PERIOD_PREFIX:-}"
DRY_RUN="${DRY_RUN:-0}"

is_true() {
  case "$1" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ -z "$API_BASE_URL" ]]; then
  echo "Missing API_BASE_URL. Example: API_BASE_URL=https://your-vps.example.com" >&2
  exit 1
fi

if ! is_true "$DRY_RUN" && [[ -z "$ADMIN_TOKEN" ]]; then
  echo "Missing ADMIN_TOKEN. Set it to the VPS admin passcode." >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

html_file="$tmpdir/source.html"
lessons_file="$tmpdir/lessons.tsv"
existing_file="$tmpdir/existing-keys.txt"
existing_json="$tmpdir/existing-lessons.json"

curl -fsSL \
  -H "user-agent: sabbath-school-reader-import/1.0" \
  "$SOURCE_URL" \
  -o "$html_file"

python3 - "$html_file" "$SOURCE_URL" "$TITLE_FALLBACK" "$PERIOD_PREFIX" > "$lessons_file" <<'PY'
from __future__ import annotations

import html
import re
import sys
from pathlib import Path
from urllib.parse import urljoin

html_file = Path(sys.argv[1])
source_url = sys.argv[2]
title_fallback = sys.argv[3]
period_prefix = sys.argv[4]

source_html = html_file.read_text(encoding="utf-8", errors="ignore")
anchor_pattern = re.compile(r'<a\b[^>]*href=["\']([^"\']+\.pdf)["\'][^>]*>([\s\S]*?)</a>', re.I)
lessons = []
seen = set()

for href, inner_html in anchor_pattern.findall(source_html):
    raw_text = html.unescape(re.sub(r'<[^>]+>', ' ', inner_html))
    normalized_text = re.sub(r'\s+', ' ', raw_text).strip()
    year_match = re.search(r'(19|20)\d{2}', normalized_text)
    quarter_match = re.search(r'(1\s*&\s*2|3\s*&\s*4)\s*quarter', normalized_text, re.I)

    if not year_match:
        continue

    year = int(year_match.group(0))
    quarter = ''
    if quarter_match:
        quarter_text = quarter_match.group(1)
        quarter = re.sub(r'\s+', ' ', quarter_text).strip()
        quarter = f'{quarter} quarter'

    period = f'{period_prefix} {year}'.strip() if period_prefix else normalized_text
    source = urljoin(source_url, href)
    key = (year, quarter, source)
    if key in seen:
        continue
    seen.add(key)
    lessons.append((year, quarter, title_fallback, period, source))

lessons.sort(key=lambda item: (-item[0], item[1]))
for year, quarter, title, period, source in lessons:
    print(f'{year}\t{quarter}\t{title}\t{period}\t{source}')
PY

if ! is_true "$DRY_RUN"; then
  curl -fsSL "$API_BASE_URL/api/lessons" -o "$existing_json"

  python3 - "$existing_json" "$existing_file" <<'PY'
from __future__ import annotations

import json
import sys
from pathlib import Path

input_file = Path(sys.argv[1])
output_file = Path(sys.argv[2])
lessons = json.loads(input_file.read_text(encoding='utf-8'))
with output_file.open('w', encoding='utf-8') as handle:
    for lesson in lessons:
        year = lesson.get('year')
        quarter = lesson.get('quarter') or ''
        handle.write(f'{year}:{quarter}\n')
PY
else
  : > "$existing_file"
fi

found_count=0
uploaded_count=0
skipped_count=0

while IFS=$'\t' read -r year quarter title period source_url; do
  [[ -z "${year:-}" ]] && continue
  found_count=$((found_count + 1))
  lesson_key="${year}:${quarter}"

  if [[ -s "$existing_file" ]] && grep -Fxq "$lesson_key" "$existing_file"; then
    echo "Skipping existing ${year} ${quarter:-quarter}."
    skipped_count=$((skipped_count + 1))
    continue
  fi

  if is_true "$DRY_RUN"; then
    echo "[dry-run] ${year} ${quarter:-quarter} -> ${source_url}"
    continue
  fi

  pdf_file="$tmpdir/${year}-${quarter:-quarter}.pdf"
  safe_filename="${year}-${quarter:-quarter}.pdf"
  safe_filename="${safe_filename//[^A-Za-z0-9._-]/-}"

  curl -fsSL \
    -H "user-agent: sabbath-school-reader-import/1.0" \
    "$source_url" \
    -o "$pdf_file"

  response_file="$tmpdir/upload-response.json"
  http_status="$(curl -sS -o "$response_file" -w '%{http_code}' \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -F "file=@${pdf_file};filename=${safe_filename};type=application/pdf" \
    -F "title=${title}" \
    -F "period=${period}" \
    -F "year=${year}" \
    -F "quarter=${quarter}" \
    "$API_BASE_URL/api/lessons")"

  if [[ "$http_status" != 2* ]]; then
    echo "Upload failed for ${source_url} (${http_status})." >&2
    cat "$response_file" >&2
    exit 1
  fi

  uploaded_count=$((uploaded_count + 1))
  echo "Uploaded ${year} ${quarter:-quarter}."
done < "$lessons_file"

echo "Found ${found_count} lesson(s), uploaded ${uploaded_count}, skipped ${skipped_count}."
