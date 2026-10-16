#!/usr/bin/env bash
# Deploy Jadi WNI ke Kubernetes (https://jadi-wni.pinuspintar.com).
#
# Contoh:
#   REGISTRY=registry.pinuspintar.com/apps \
#   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy \
#   ./deploy/deploy.sh
#
# Variabel (env):
#   REGISTRY             default docker.io/luklukls (image: luklukls/jadi-wni:<tag>); jalankan `docker login` dulu
#   GOOGLE_CLIENT_ID     } wajib saat pertama kali (disimpan di Secret; kalau kosong dan
#   GOOGLE_CLIENT_SECRET } Secret sudah ada, Secret lama dipakai)
#   AI_API_KEY           (opsional) aktifkan Netizen AI; ikut disimpan di Secret yang sama
#   HOST                 default jadi-wni.pinuspintar.com
#   NAMESPACE            default jadi-wni
#   IMAGE_TAG            default: git short sha (atau timestamp)
#   IMAGE                override nama image penuh (lewati build bila SKIP_BUILD=1)
#   SKIP_BUILD=1         jangan build/push, pakai IMAGE yang sudah ada
#   KUBE_CONTEXT         context kubectl (default: context aktif)
#   INGRESS_CLASS        default traefik
#   CLUSTER_ISSUER       cert-manager ClusterIssuer (default letsencrypt-prod; kosongkan "-" bila TLS dikelola lain)
#   STORAGE_CLASS        StorageClass PVC (default: bawaan cluster)
#   DRY_RUN=1            hanya cetak manifest, tidak menerapkan
set -euo pipefail

cd "$(dirname "$0")/.."

# deploy/.env (di-gitignore) berisi rahasia: GOOGLE_*, AI_*; env yang sudah di-set tetap menang
if [ -f deploy/.env ]; then set -a; . deploy/.env; set +a; fi

REGISTRY="${REGISTRY:-docker.io/lukluk}"
HOST="${HOST:-jadi-wni.pinuspintar.com}"
NAMESPACE="${NAMESPACE:-jadi-wni}"
INGRESS_CLASS="${INGRESS_CLASS:-traefik}"
CLUSTER_ISSUER="${CLUSTER_ISSUER:--}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' tidak ditemukan di PATH." >&2; exit 1; }; }
[ "${DRY_RUN:-0}" = "1" ] || need kubectl
[ "${SKIP_BUILD:-0}" = "1" ] || [ "${DRY_RUN:-0}" = "1" ] || need docker

if [ -z "${IMAGE:-}" ]; then

  IMAGE="${REGISTRY%/}/jadi-wni:${IMAGE_TAG}"
fi

KCTL=(kubectl)
[ -z "${KUBE_CONTEXT:-}" ] || KCTL+=(--context "$KUBE_CONTEXT")

echo "==> Image     : $IMAGE" >&2
echo "==> Host      : https://$HOST" >&2
echo "==> Namespace : $NAMESPACE" >&2

# 1. build + push
if [ "${SKIP_BUILD:-0}" != "1" ] && [ "${DRY_RUN:-0}" != "1" ]; then
  echo "==> Build & push image" >&2
  docker build -t "$IMAGE" .
  docker push "$IMAGE"
fi

# 2. render manifest
if [ "$CLUSTER_ISSUER" = "-" ]; then CERT_ANN='# (TLS dikelola di luar cert-manager)'; else CERT_ANN="cert-manager.io/cluster-issuer: \"$CLUSTER_ISSUER\""; fi
if [ -n "${STORAGE_CLASS:-}" ]; then SC_LINE="storageClassName: $STORAGE_CLASS"; else SC_LINE='# storageClassName: bawaan cluster'; fi

MANIFEST="$(sed \
  -e "s|__NAMESPACE__|$NAMESPACE|g" \
  -e "s|__HOST__|$HOST|g" \
  -e "s|__IMAGE__|$IMAGE|g" \
  -e "s|__INGRESS_CLASS__|$INGRESS_CLASS|g" \
  -e "s|__CERT_ANNOTATION__|$CERT_ANN|g" \
  -e "s|__STORAGE_CLASS_LINE__|$SC_LINE|g" \
  deploy/k8s.yaml)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "$MANIFEST"
  exit 0
fi

# 3. namespace dulu (Secret butuh namespace), lalu Secret OAuth
echo "==> Terapkan namespace" >&2
"${KCTL[@]}" create namespace "$NAMESPACE" --dry-run=client -o yaml | "${KCTL[@]}" apply -f -

if [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  echo "==> Simpan Secret Google OAuth" >&2
  "${KCTL[@]}" -n "$NAMESPACE" create secret generic jadi-wni-secret \
    --from-literal=GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
    --from-literal=GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
    --from-literal=AI_BASE_URL="${AI_BASE_URL:-}" \
    --from-literal=AI_MODEL="${AI_MODEL:-}" \
    --from-literal=AI_API_KEY="${AI_API_KEY:-}" \
    --dry-run=client -o yaml | "${KCTL[@]}" apply -f -
elif ! "${KCTL[@]}" -n "$NAMESPACE" get secret jadi-wni-secret >/dev/null 2>&1; then
  echo "ERROR: Secret jadi-wni-secret belum ada. Set GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET." >&2
  exit 1
fi

# 4. apply semua
echo "==> Terapkan manifest" >&2
echo "$MANIFEST" | "${KCTL[@]}" apply -f -

# 5. tunggu rollout
echo "==> Menunggu rollout" >&2
"${KCTL[@]}" -n "$NAMESPACE" rollout status deployment/jadi-wni --timeout=180s

cat <<EOF

Selesai. https://$HOST

Cek:
  kubectl -n $NAMESPACE get pods,ingress,certificate
  kubectl -n $NAMESPACE logs deploy/jadi-wni -f

Pastikan:
  - DNS A/CNAME $HOST -> IP/hostname ingress controller
  - Google OAuth redirect URI: https://$HOST/auth/google/callback
EOF
