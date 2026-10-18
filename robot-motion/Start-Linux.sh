#!/bin/bash
set -e

# Resolve the directory where this script is located
cd "$(dirname "$(readlink -f "$0")")"

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22.12+ from https://nodejs.org then run this again.'
  read -r -p 'Press Enter to close.'
  exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  npm ci || { read -r -p 'Installation failed. Press Enter to close.'; exit 1; }
fi

# Run dev server
npm run dev -- --open
