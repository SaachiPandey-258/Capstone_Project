#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$ROOT_DIR/.venv"
BACKEND_REQUIREMENTS="$BACKEND_DIR/requirements.txt"

fail() {
    printf 'start.command: %s\n' "$1" >&2
    exit 1
}

[ -d "$BACKEND_DIR" ] || fail "backend directory not found: $BACKEND_DIR"
[ -d "$FRONTEND_DIR" ] || fail "frontend directory not found: $FRONTEND_DIR"

if [ -x "$VENV_DIR/bin/python" ]; then
    PYTHON="$VENV_DIR/bin/python"
    PIP="$VENV_DIR/bin/pip"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON=$(command -v python3)
    PIP=
else
    fail "Python 3 was not found. Install Python 3 or create $VENV_DIR."
fi

command -v npm >/dev/null 2>&1 || fail "npm was not found. Install Node.js and npm."

if [ -n "$PIP" ] && [ -f "$BACKEND_REQUIREMENTS" ]; then
    "$PIP" install -r "$BACKEND_REQUIREMENTS" || fail "backend dependency installation failed"
fi

BACKEND_COMMAND="cd \"$BACKEND_DIR\" && FRONTEND_ORIGINS=http://127.0.0.1:3001 \"$PYTHON\" -m uvicorn main:app --host 127.0.0.1 --port 8001"
FRONTEND_COMMAND="cd \"$FRONTEND_DIR\" && NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 npm run dev -- --hostname 127.0.0.1 --port 3001"

if command -v osascript >/dev/null 2>&1; then
    if ! osascript - "$BACKEND_COMMAND" <<'APPLESCRIPT'
on run argv
    tell application "Terminal" to do script (item 1 of argv)
end run
APPLESCRIPT
    then
        fail "could not open a backend terminal"
    fi
    if ! osascript - "$FRONTEND_COMMAND" <<'APPLESCRIPT'
on run argv
    tell application "Terminal" to do script (item 1 of argv)
end run
APPLESCRIPT
    then
        fail "could not open a frontend terminal"
    fi
elif command -v x-terminal-emulator >/dev/null 2>&1; then
    x-terminal-emulator -e sh -c "$BACKEND_COMMAND; exec sh" &
    x-terminal-emulator -e sh -c "$FRONTEND_COMMAND; exec sh" &
else
    printf '%s\n' "No supported terminal launcher found; starting both services in this terminal."
    sh -c "$BACKEND_COMMAND" &
    BACKEND_PID=$!
    sh -c "$FRONTEND_COMMAND" &
    FRONTEND_PID=$!
    trap 'kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true' INT TERM EXIT
    wait "$BACKEND_PID" "$FRONTEND_PID"
fi

printf '%s\n' "Backend: http://127.0.0.1:8001" "Frontend: http://127.0.0.1:3001"
