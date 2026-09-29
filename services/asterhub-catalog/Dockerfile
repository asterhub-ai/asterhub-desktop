FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 CATALOG_DATA_DIR=/srv/catalog
WORKDIR /app
COPY package.json server.mjs ./
COPY data /srv/catalog
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
