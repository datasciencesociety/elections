#!/bin/bash
set -e

MEDIAMTX_HOST="${MEDIAMTX_HOST:-mediamtx}"
MEDIAMTX_PORT="${MEDIAMTX_PORT:-8554}"
MEDIAMTX_API="http://${MEDIAMTX_HOST}:9997"
STREAMS_JSON="${STREAMS_JSON:-/streams.json}"
VIDEOS_ROOT="${VIDEOS_ROOT:-/videos}"
STREAMS_LIMIT="${STREAMS_LIMIT:-0}"

echo "Waiting for MediaMTX RTSP port $MEDIAMTX_HOST:$MEDIAMTX_PORT ..."
until (echo > /dev/tcp/"$MEDIAMTX_HOST"/"$MEDIAMTX_PORT") 2>/dev/null; do
    sleep 2
done
echo "MediaMTX ready. Starting publishers..."

# Write stream entries to a temp file (optionally limited)
TMPFILE=$(mktemp)
if [ "$STREAMS_LIMIT" -gt 0 ] 2>/dev/null; then
    jq -r 'to_entries[] | "\(.key)\t\(.value)"' "$STREAMS_JSON" | head -n "$STREAMS_LIMIT" > "$TMPFILE"
else
    jq -r 'to_entries[] | "\(.key)\t\(.value)"' "$STREAMS_JSON" > "$TMPFILE"
fi

PIDS=()
while IFS=$'\t' read -r stream_id rel_path; do
    file_path="$VIDEOS_ROOT/$rel_path"
    if [ ! -f "$file_path" ]; then
        echo "WARN: $file_path not found, skipping $stream_id"
        continue
    fi
    echo "Publishing [$stream_id] <- $file_path"
    ffmpeg \
        -re \
        -stream_loop -1 \
        -i "$file_path" \
        -c copy \
        -f rtsp \
        -rtsp_transport tcp \
        "rtsp://$MEDIAMTX_HOST:$MEDIAMTX_PORT/$stream_id" \
        -loglevel warning \
        &
    PIDS+=($!)
done < "$TMPFILE"

rm -f "$TMPFILE"
echo "Started ${#PIDS[@]} publishers. Waiting..."
wait
