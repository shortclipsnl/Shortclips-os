#!/bin/bash
# Dubbelklik om de verwerk-server van de Shortclips AI Editor te starten.
# De eerste keer installeert dit ook Node.js en de benodigde onderdelen.
cd "$(dirname "$0")" || exit 1
export NVM_DIR="$HOME/.nvm"
if ! command -v node >/dev/null 2>&1; then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "Node.js installeren…"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  . "$NVM_DIR/nvm.sh"
  command -v node >/dev/null 2>&1 || nvm install 22
fi
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
echo "Node $(node -v)"
if [ ! -f .venv-vi/.ai-editor-setup-done ]; then
  echo "Onderdelen installeren (eenmalig, kan een paar minuten duren)…"
  npm install --no-audit --no-fund || { echo "npm install mislukt"; read -r -p "Druk op Enter om te sluiten"; exit 1; }
  "$HOME/.local/bin/uv" pip install -p .venv-vi/bin/python faster-whisper pillow numpy || { echo "Python-onderdelen mislukt"; read -r -p "Druk op Enter om te sluiten"; exit 1; }
  touch .venv-vi/.ai-editor-setup-done
fi
./scripts/start-ai-editor-worker.sh
echo
read -r -p "De verwerk-server is gestopt. Druk op Enter om dit venster te sluiten."
