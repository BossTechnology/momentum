#!/bin/bash
# integrity.sh — checkpoint. Hashes every tracked source file.
# Compare against .integrity-baseline; any diff not written by me is quarantined.
# Incident 4 taught the gap: root files are covered too, this script included.
cd "$(dirname "$0")"
{ find src api test build config harness supabase -type f \( -name '*.js' -o -name '*.html' -o -name '*.json' -o -name '*.csv' -o -name '*.md' -o -name '*.sql' \) 2>/dev/null;
  ls package.json package-lock.json vercel.json .gitignore CLAUDE.md README.md integrity.sh 2>/dev/null; } | sort | xargs md5sum
