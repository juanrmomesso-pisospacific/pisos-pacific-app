# Pisos Pacific — Express server que sirve el SPA buildeado (dashboard-app/dist).
# Nota: server.js carga 'xlsx' desde dashboard-app/node_modules en runtime, por eso
# NO se podan esas deps.
FROM node:22-slim
WORKDIR /app

# Deps del backend
COPY package*.json ./
RUN npm install --omit=dev

# Deps del frontend (incluye dev: vite/tsc para el build)
COPY dashboard-app/package*.json ./dashboard-app/
RUN cd dashboard-app && npm install

# Código + build del frontend
COPY . .
RUN cd dashboard-app && npm run build

ENV NODE_ENV=production
ENV PORT=3000
# Persistí la DB fuera del repo (montá un volumen en /var/data)
ENV DB_PATH=/var/data/db.json
EXPOSE 3000
CMD ["node", "server.js"]
