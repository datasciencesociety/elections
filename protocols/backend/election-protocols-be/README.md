# Election Protocols Backend Service

## Build Container Locally

```sh
# Navigate to the package directory
cd protocols/

# Build the Docker image for the election protocols backend
docker build -t election-protocols-be -f backend/election-protocols-be/Dockerfile .

# Run the container
docker run -d -p 4010:4010 --name election-protocols-be election-protocols-be
```
