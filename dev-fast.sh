#!/bin/bash
# Fast dev: run backend + vite concurrently
echo "Starting dev servers..."
(cd core && node client.js) &
BACKEND_PID=$!
(cd web && npx vite --port 5173) &
VITE_PID=$!
echo "Backend: http://localhost:3000"
echo "Frontend: http://localhost:5173 (HMR)"
echo "Press Ctrl+C to stop"
wait $BACKEND_PID $VITE_PID

