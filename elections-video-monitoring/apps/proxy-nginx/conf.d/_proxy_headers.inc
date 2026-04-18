# Included by every proxy location block
# Note: Host is set per-location dynamically
proxy_set_header User-Agent      "Mozilla/5.0";
proxy_set_header Referer         "https://evideo.bg/";
proxy_set_header X-Real-IP       $remote_addr;
proxy_set_header Connection      "";
proxy_http_version 1.1;

# Strip headers that would confuse the browser context
proxy_hide_header Content-Security-Policy;
proxy_hide_header X-Frame-Options;
proxy_hide_header Strict-Transport-Security;
