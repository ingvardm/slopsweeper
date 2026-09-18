# Project Agents Guide

## Docker Hub Push

For future pushes, use this command:

```bash
docker buildx build --push --platform linux/amd64,linux/arm64 -t ingvardm/minesweeper:VERSION -t ingvardm/minesweeper:latest .
```

Replace `VERSION` with the release version (e.g. `1.0.3`). This builds multi-arch (amd64 + arm64) and pushes in one step — no separate `docker push` needed.
