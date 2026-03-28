FROM alpine:3.19
RUN apk add --no-cache ffmpeg jq bash curl
COPY publish.sh /publish.sh
RUN chmod +x /publish.sh
ENTRYPOINT ["/publish.sh"]
