# Development image for Strapi (Compose mounts source; node_modules is a Linux volume)
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh

COPY . .

ENV NODE_ENV=development
EXPOSE 1337

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "develop"]
