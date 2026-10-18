#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22.12+ from https://nodejs.org then run this again.'
  read '?Press Return to close.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || { read '?Installation failed. Press Return to close.'; exit 1; }
fi
npm run dev -- --open
