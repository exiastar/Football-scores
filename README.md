# Football Scores (Gridiron)

A lightweight, self-hosted web application for tracking live NFL and College Football (NCAA) scores. Features a secure authentication screen and is fully containerized for easy deployment via Docker.

## Features

*   **Live NFL Scoreboard:** Real-time game tracking.
*   **NCAA College Football Integration:** Live data pulled directly from the ESPN College Football API.
*   **Secure Access:** Built-in authenticated login screen to protect your dashboard.
*   **Containerized:** Built for rapid deployment in homelab environments.

## Prerequisites

*   Docker installed and running.

## Deployment

Deploy the Gridiron container using the Docker CLI. You must pass the `APP_PASSWORD` environment variable to configure the web authentication screen. 

### Docker Run

```bash
docker run -d \
  --name gridiron \
  -p 8080:80 \
  -e APP_PASSWORD="your_secure_password_here" \
  --restart unless-stopped \
  exiastar/football-scores:latest
