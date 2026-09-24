
#!/data/data/com.termux/files/usr/bin/bash
# Uso: bash -s -- URL_RAW_DEL_REPO URL_FIREBASE
RAW="$1"; DB="$2"
pkg install -y nodejs git curl
mkdir -p ~/darkmatter && cd ~/darkmatter || exit 1
for f in agent.cjs bot.cjs package.json; do
  curl -fsSL "$RAW/$f" -o "$f" || { echo "No pude bajar $f de $RAW"; exit 1; }
done
echo "{\"db\":\"$DB\"}" > agent.json
npm install --no-audit --no-fund || exit 1
termux-wake-lock 2>/dev/null
node agent.cjs
