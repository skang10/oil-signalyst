FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Baked into the built JS bundle at build time (Vite inlines
# import.meta.env.* at build, not at container start). Empty string, not
# unset - src/lib/api.ts's `?? 'http://localhost:8000'` fallback only
# triggers on null/undefined, so an explicit "" here makes every request
# path- and origin-relative, letting nginx.conf proxy /api and /ws to the
# backend service same-origin with the SPA - no CORS config needed for
# the containerized stack at all, unlike `npm run dev`'s cross-port setup.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
