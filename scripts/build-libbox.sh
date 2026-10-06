#!/usr/bin/env bash
# Собирает движок sing-box в виде библиотеки для Android (libbox.aar) из исходников нужной версии.
# Запускается на GitHub (сборка APK): там есть Android SDK и NDK. Результат кэшируется по версии движка.
# Нужны: Go (версия из go.mod sing-box), Java 17, ANDROID_HOME и ANDROID_NDK_HOME.
#
# Отличия от официальной сборки (cmd/internal/build_libbox): только телефонные процессоры arm64 и armv7
# (без x86 — меньше APK) и без лишних модулей (naive/cronet, tailscale, openvpn, usbip…), которые «Тропа» не
# использует. Протоколы, которые разбирает core/, все на месте: vless/reality, vmess, trojan, shadowsocks,
# hysteria2 и tuic (quic), anytls, wireguard.
set -euo pipefail

VERSION="${SINGBOX_VERSION:?нужна SINGBOX_VERSION, например 1.14.2}"
OUT="${1:?куда положить libbox.aar}"
WORK="$(mktemp -d)"

git clone --quiet --depth 1 --branch "v$VERSION" https://github.com/SagerNet/sing-box "$WORK/sing-box"
cd "$WORK/sing-box"

go install github.com/sagernet/gomobile/cmd/gomobile@v0.1.13
go install github.com/sagernet/gomobile/cmd/gobind@v0.1.13
GOBIN="$(go env GOPATH)/bin"

TAGS="with_gvisor,with_quic,with_wireguard,with_utls,badlinkname,tfogo_checklinkname0"
LDFLAGS="-X github.com/sagernet/sing-box/constant.Version=$VERSION -X runtime.godebugDefault=multipathtcp=0,tlssha1=1 -checklinkname=0 -s -w -buildid="

"$GOBIN/gomobile" bind -v \
  -o "$WORK/libbox.aar" \
  -target android/arm64,android/arm \
  -androidapi 24 \
  -javapkg=io.nekohasekai \
  -libname=box \
  -trimpath -buildvcs=false \
  -ldflags "$LDFLAGS" \
  -tags "$TAGS" \
  ./experimental/libbox

mkdir -p "$(dirname "$OUT")"
cp "$WORK/libbox.aar" "$OUT"
cp LICENSE "$(dirname "$OUT")/LICENSE-sing-box.txt"
echo "libbox.aar готов: $OUT"
