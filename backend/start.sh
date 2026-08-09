#!/bin/bash
# Kill anything on port 8000
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null
sleep 1
# Start backend
cd "$(dirname "$0")"
exec uvicorn main:app --reload --host 127.0.0.1 --port 8000
