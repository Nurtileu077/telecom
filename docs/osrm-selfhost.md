# Self-host OSRM (Kazakhstan)

Public `router.project-osrm.org` is a demo server with aggressive rate
limits — from Vercel egress IPs you hit HTTP 429 on every 4th–5th
request. Hosting your own OSRM removes the limit and is dramatically
faster (single-digit ms per route vs 200–500 ms remote).

This guide covers Kazakhstan; adjust the PBF URL for other regions.

## Requirements

- Server with **8 GB RAM** minimum (12 GB recommended for Kazakhstan)
- **~6 GB free disk** for the extract + processed graph
- Docker installed

## 1. Prepare the data

```bash
mkdir -p /opt/osrm && cd /opt/osrm

# Download Kazakhstan extract (~270 MB)
wget https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf

# Extract road graph (5–15 min, uses ~6 GB RAM)
docker run --rm -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/kazakhstan-latest.osm.pbf

# Partition (1–3 min)
docker run --rm -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/kazakhstan-latest.osrm

# Customize (1–3 min)
docker run --rm -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/kazakhstan-latest.osrm
```

## 2. Run the routing server

```bash
docker run -d --name osrm --restart=unless-stopped \
  -p 5000:5000 \
  -v /opt/osrm:/data \
  ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/kazakhstan-latest.osrm
```

Test:

```bash
curl 'http://localhost:5000/route/v1/driving/68.32,40.77;68.31,40.76?overview=full&geometries=geojson'
```

You should see `{"code":"Ok","routes":[…]}`.

## 3. Expose via HTTPS

GPON Designer runs in a browser, so it needs **HTTPS** to call your OSRM
from a Vercel-deployed app (mixed content otherwise). Easiest: nginx +
Let's Encrypt.

`/etc/nginx/sites-available/osrm`:

```nginx
server {
  listen 443 ssl http2;
  server_name osrm.yourdomain.com;

  # certbot fills these in
  ssl_certificate     /etc/letsencrypt/live/osrm.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/osrm.yourdomain.com/privkey.pem;

  # CORS for the GPON Designer frontend
  add_header Access-Control-Allow-Origin "*" always;
  add_header Access-Control-Allow-Methods "GET, OPTIONS" always;

  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
  }
}
```

```bash
sudo certbot --nginx -d osrm.yourdomain.com
```

## 4. Wire into GPON Designer

In the app:
1. Open the **Инстр.** (Tools) tab in the sidebar
2. Expand **⚙ Сервер маршрутизации**
3. Paste into **Свой OSRM URL**:
   `https://osrm.yourdomain.com/route/v1/driving`

That's it. The router prefers your URL over public mirrors; every
existing button (OSRM, Объединить, Повторить упавшие) uses it
automatically. Successful routes are cached in `localStorage` so even
your own server isn't hit twice for the same pair.

## 5. Keep the data fresh

OSM gets updates daily. To refresh:

```bash
cd /opt/osrm
wget -N https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf
docker run --rm -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/kazakhstan-latest.osm.pbf
docker run --rm -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/kazakhstan-latest.osrm
docker run --rm -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/kazakhstan-latest.osrm
docker restart osrm
```

Recommended cadence: monthly.

## Smallest possible setup (VPS)

A 2-vCPU / 8 GB VPS handles Kazakhstan + ~50 req/s comfortably. Tested
SKUs:
- Hetzner CX22 (~€4/month)
- DigitalOcean Basic 8 GB (~$48/month)
- Yandex Cloud s3-c2-m8 (~5000 ₸/month)

## Troubleshooting

- **`osrm-extract` killed (OOM)** — your VPS has < 6 GB RAM. Either resize
  temporarily for the build, or use the smaller `osrm-extract` profile
  with `--memory 4G`.
- **HTTPS works locally but not from Vercel** — make sure your nginx
  config has the `Access-Control-Allow-Origin` header. Without it the
  browser blocks the response.
- **Routes look the same as public OSRM** — that's expected, both use
  the same OSM data + same routing engine. The benefit is reliability
  and speed, not different routes.
