#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$repo_dir/site/images"
if [ -d "$repo_dir/docs/images" ]; then
  cp -R "$repo_dir/docs/images/." "$repo_dir/site/images/"
else
  echo "docs/images is not present yet; screenshots will be unavailable." >&2
fi
cd "$repo_dir/site"
port=${PORT:-8000}
echo "Preview: http://localhost:$port"
exec python3 -m http.server "$port" --bind 127.0.0.1
