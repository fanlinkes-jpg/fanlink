FROM mcr.microsoft.com/playwright:v1.64.0-jammy

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NITRO_PRESET=node-server
RUN npm run build
ENV HOST=0.0.0.0
ENV PORT=8080
VOLUME ["/app/data"]
CMD ["node", ".output/server/index.mjs"]
