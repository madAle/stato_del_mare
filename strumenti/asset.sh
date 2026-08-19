#!/usr/bin/env bash
# Basemap vettoriale e suoi accessori sul bucket.
#
# Si esegue a mano quando serve, non a ogni run: la basemap non e' deperibile.
# Font e sprite si copiano nel bucket e non si linkano al dominio di terzi, se
# no la promessa di non avere dipendenze di esecuzione e' finta.
set -euo pipefail

GIORNO="${1:?uso: asset.sh AAAAMMGG}"
S3="aws s3 --endpoint-url $R2_ENDPOINT"

pmtiles extract "https://build.protomaps.com/${GIORNO}.pmtiles" adriatico.pmtiles \
  --bbox=10.8,39.8,20.1,46.4 --maxzoom=13
$S3 cp adriatico.pmtiles "s3://$R2_BUCKET/basemap/adriatico.pmtiles"

# Font e sprite arrivano clonando il repo degli asset, non a richieste HTTP una
# per intervallo di glifi. Il repo intero pesa 6,5 MB; il ciclo a richieste ne
# faceva 768, e il 2026-08-19 GitHub Pages ha risposto 503 alla numero 250,
# lasciando sul bucket due font su tre e nessuno sprite. Cosi' l'elenco dei file
# viene dal repo invece di essere indovinato provando, e non c'e' piu' un 404 da
# distinguere da un guasto: o il clone riesce, o si ferma tutto.
rm -rf assets
git clone --quiet --depth 1 https://github.com/protomaps/basemaps-assets.git assets
echo "asset.sh: basemaps-assets a $(git -C assets rev-parse HEAD)"

for stack in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  # Se a monte uno stack cambiasse nome, le etichette sparirebbero dalla mappa
  # senza che niente qui fallisca: e' il caso che questa riga intercetta.
  if [ ! -d "assets/fonts/${stack}" ]; then
    echo "asset.sh: manca lo stack ${stack} negli asset di Protomaps" >&2
    exit 1
  fi
  $S3 cp --recursive "assets/fonts/${stack}" "s3://$R2_BUCKET/basemap/fonts/${stack}"
done

for f in light.json light.png light@2x.json light@2x.png; do
  $S3 cp "assets/sprites/v4/$f" "s3://$R2_BUCKET/basemap/sprites/$f"
done
