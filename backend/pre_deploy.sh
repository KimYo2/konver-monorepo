#!/bin/bash

# Pastikan RAILWAY_SERVICE_BASE tersedia
if [ -z "$RAILWAY_SERVICE_BASE" ]; then
  echo "Error: RAILWAY_SERVICE_BASE is not set. This script expects to be run on Railway." >&2
  exit 1
fi

# Pastikan direktori tujuan ada di dalam root layanan backend
mkdir -p templates
mkdir -p static

# Salin konten frontend/templates ke backend/templates
# Menggunakan RAILWAY_SERVICE_BASE untuk menemukan root monorepo
cp -R "${RAILWAY_SERVICE_BASE}/frontend/templates/"* templates/

# Salin konten frontend/static ke backend/static
cp -R "${RAILWAY_SERVICE_BASE}/frontend/static/"* static/

echo "Frontend assets copied to backend service directory." 