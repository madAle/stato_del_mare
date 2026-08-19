#!/usr/bin/env bash
# Basemap vettoriale e suoi accessori sul bucket.
#
# Si esegue a mano quando serve, non a ogni run: la basemap non e' deperibile.
# Font e sprite si copiano nel bucket e non si linkano al dominio di terzi, se
# no la promessa di non avere dipendenze di esecuzione e' finta.
set -euo pipefail

GIORNO="${1:?uso: asset.sh AAAAMMGG}"
ASSETS=https://protomaps.github.io/basemaps-assets
S3="aws s3 --endpoint-url $R2_ENDPOINT"

pmtiles extract "https://build.protomaps.com/${GIORNO}.pmtiles" adriatico.pmtiles \
  --bbox=10.8,39.8,20.1,46.4 --maxzoom=13
$S3 cp adriatico.pmtiles "s3://$R2_BUCKET/basemap/adriatico.pmtiles"

for stack in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  codificato=$(printf %s "$stack" | jq -sRr @uri)
  for inizio in $(seq 0 256 65280); do
    intervallo="${inizio}-$((inizio + 255))"
    # Il 404 e' normale: un font non copre necessariamente ogni intervallo di
    # glifi. Qualunque altro esito (timeout, DNS, disconnessione, 5xx) deve
    # fermare lo script: senza questa distinzione un incidente di rete a meta'
    # ciclo carica un font incompleto sul bucket senza che niente lo segnali.
    if ! codice=$(curl -s -o glifo.pbf -w "%{http_code}" "$ASSETS/fonts/${codificato}/${intervallo}.pbf"); then
      echo "asset.sh: errore di rete su ${stack} ${intervallo}" >&2
      exit 1
    fi
    case "$codice" in
      200) $S3 cp glifo.pbf "s3://$R2_BUCKET/basemap/fonts/${stack}/${intervallo}.pbf" ;;
      404) ;;
      *) echo "asset.sh: ${stack} ${intervallo}: HTTP ${codice}" >&2; exit 1 ;;
    esac
  done
done

for f in light.json light.png light@2x.json light@2x.png; do
  curl -sfO "$ASSETS/sprites/v4/$f"
  $S3 cp "$f" "s3://$R2_BUCKET/basemap/sprites/$f"
done
