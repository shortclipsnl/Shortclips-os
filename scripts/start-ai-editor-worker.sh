#!/bin/bash
# Start de verwerk-server van de Shortclips AI Editor op deze Mac.
#
# De worker draait altijd de laatste versie van main (dezelfde code als het
# portaal op Vercel), in een eigen kopie: .worktrees/worker. Zo maakt het niet
# uit op welke branch deze map zelf staat. Bij elke start wordt main opgehaald.
# Leest .env.local (Supabase, Google, Anthropic) en daarna .env.worker
# (productiedatabase). Laat dit Terminal-venster open zolang er gemonteerd moet worden.
ROOT="$(cd "$(dirname "$0")/.." && pwd)" || exit 1
W="$ROOT/.worktrees/worker"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if [ ! -f "$ROOT/.env.worker" ]; then
  echo "Bestand .env.worker ontbreekt. Zet daarin DATABASE_URL=... (uit Vercel)."; exit 1
fi
grep -q "^.worktrees" "$ROOT/.git/info/exclude" 2>/dev/null || echo ".worktrees/" >> "$ROOT/.git/info/exclude"
echo "Laatste versie van main ophalen…"
git -C "$ROOT" fetch -q origin main || echo "Ophalen mislukt (geen internet?), de vorige versie wordt gebruikt."
if [ ! -d "$W" ]; then
  git -C "$ROOT" worktree add -q --detach "$W" origin/main || exit 1
else
  git -C "$W" checkout -q --detach origin/main || exit 1
fi
for x in node_modules .venv-vi .env.local .env.worker; do
  [ -e "$W/$x" ] || ln -s "$ROOT/$x" "$W/$x"
done
# Pakketten komen uit deze map (node_modules). Wijken die op main af, dan melden.
node -e 'const a=require(process.argv[1]),b=require(process.argv[2]);const k=o=>JSON.stringify({...o.dependencies,...o.devDependencies});if(k(a)!==k(b))console.log("Let op: main gebruikt andere pakketten dan deze map. Draai hier eenmalig npm install als de worker een fout geeft.")' "$W/package.json" "$ROOT/package.json"
cd "$W" || exit 1
echo "Versie: $(git log -1 --format='%h %s')"
set -a
. ./.env.local
. ./.env.worker
set +a
export DATABASE_DRIVER=postgres
echo "AI Editor worker start (Ctrl+C om te stoppen)…"
exec npm run ai-editor:worker
