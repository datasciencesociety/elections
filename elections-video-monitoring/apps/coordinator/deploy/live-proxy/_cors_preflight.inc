# Included as the first line of every proxy location block
if ($request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin  "*"                  always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "*"                  always;
    return 204;
}
