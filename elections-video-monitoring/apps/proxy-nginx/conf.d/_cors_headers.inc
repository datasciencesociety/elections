# Included by every proxy location block
add_header Access-Control-Allow-Origin  "*"                  always;
add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
add_header Access-Control-Allow-Headers "*"                  always;
add_header Access-Control-Expose-Headers "content-length, content-range, accept-ranges" always;
