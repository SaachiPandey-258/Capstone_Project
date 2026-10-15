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

if command -v lsof >/dev/null 2>&1; then
    occupied_ports=
    for port in 8001 3001; do
        listeners=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)
        if [ -n "$listeners" ]; then
            occupied_ports="$occupied_ports $port (PID $listeners);"
        fi
    done
    [ -z "$occupied_ports" ] || fail "port(s) already in use:$occupied_ports stop the existing app with Ctrl+C before running start.command again."
fi

GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
if [ -z "$GOOGLE_CLIENT_ID" ] && [ -f "$FRONTEND_DIR/.env.local" ]; then
    GOOGLE_CLIENT_ID=$(awk -F= '
        $1 == "NEXT_PUBLIC_GOOGLE_CLIENT_ID" {
            sub(/^[^=]*=/, "")
            gsub(/\r/, "")
            gsub(/^[ \t]+|[ \t]+$/, "")
            print
            exit
        }
    ' "$FRONTEND_DIR/.env.local")
fi
case "$GOOGLE_CLIENT_ID" in
    *[!A-Za-z0-9._-]*)
        fail "Google client ID contains unsupported characters. Check frontend/.env.local."
        ;;
esac

if [ -n "$PIP" ] && [ -f "$BACKEND_REQUIREMENTS" ]; then
    "$PIP" install -r "$BACKEND_REQUIREMENTS" || fail "backend dependency installation failed"
fi

# Google sign-in only works on origins registered for the OAuth client, so the
# app is opened at localhost; 127.0.0.1 is still accepted by the API.
FRONTEND_ORIGINS="http://localhost:3001,http://127.0.0.1:3001"

if [ -n "$GOOGLE_CLIENT_ID" ]; then
    BACKEND_COMMAND="cd \"$ROOT_DIR\" && GOOGLE_CLIENT_ID=\"$GOOGLE_CLIENT_ID\" FRONTEND_ORIGINS=\"$FRONTEND_ORIGINS\" \"$PYTHON\" -m uvicorn backend.app:app --host 127.0.0.1 --port 8001 --reload --reload-dir backend --reload-dir scripts"
else
    printf '%s\n' "Google sign-in is not configured. Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to frontend/.env.local to enable it."
    BACKEND_COMMAND="cd \"$ROOT_DIR\" && FRONTEND_ORIGINS=\"$FRONTEND_ORIGINS\" \"$PYTHON\" -m uvicorn backend.app:app --host 127.0.0.1 --port 8001 --reload --reload-dir backend --reload-dir scripts"
fi
FRONTEND_COMMAND="cd \"$FRONTEND_DIR\" && NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 npm run dev -- --hostname 127.0.0.1 --port 3001"
BACKEND_URL=http://127.0.0.1:8001
FRONTEND_URL=http://localhost:3001

if [ -d "$FRONTEND_DIR/.next" ]; then
    rm -rf "$FRONTEND_DIR/.next"
fi

wait_for_url() {
    label=$1
    url=$2
    attempts=0
    while [ "$attempts" -lt 60 ]; do
        if curl --silent --fail --max-time 2 "$url" >/dev/null 2>&1; then
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 1
    done
    fail "$label did not become available at $url"
}

if command -v x-terminal-emulator >/dev/null 2>&1; then
    x-terminal-emulator -e sh -c "$BACKEND_COMMAND; exec sh" &
    x-terminal-emulator -e sh -c "$FRONTEND_COMMAND; exec sh" &
else
    printf '%s\n' "No supported terminal launcher found; starting both services in this terminal."
    sh -c "$BACKEND_COMMAND" &
    BACKEND_PID=$!
    sh -c "$FRONTEND_COMMAND" &
    FRONTEND_PID=$!
    trap 'kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true' INT TERM EXIT

    if [ "$(uname -s)" = Darwin ]; then
        wait_for_url "backend" "$BACKEND_URL/api/health"
        wait_for_url "frontend" "$FRONTEND_URL"
        open "$FRONTEND_URL" || fail "could not open the frontend in a browser"
    fi

    printf '%s\n' "Backend: $BACKEND_URL" "Frontend: $FRONTEND_URL"
    wait "$BACKEND_PID" "$FRONTEND_PID"
fi

if command -v x-terminal-emulator >/dev/null 2>&1; then
    printf '%s\n' "Backend: $BACKEND_URL" "Frontend: $FRONTEND_URL"
fi
