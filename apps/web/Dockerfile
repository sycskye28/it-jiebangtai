FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM deps AS build
ARG VITE_API_BASE_URL=http://localhost:4000
ARG VITE_REQUIRE_FEISHU_LOGIN=false
ARG VITE_FEISHU_WEBAPP_AUTO_LOGIN=false
ARG VITE_FEISHU_REMOTE_DEBUG=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_REQUIRE_FEISHU_LOGIN=$VITE_REQUIRE_FEISHU_LOGIN
ENV VITE_FEISHU_WEBAPP_AUTO_LOGIN=$VITE_FEISHU_WEBAPP_AUTO_LOGIN
ENV VITE_FEISHU_REMOTE_DEBUG=$VITE_FEISHU_REMOTE_DEBUG
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w packages/shared && npm run build -w apps/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
