# id_x_010 前端镜像（Next.js + Node.js runtime）。
#
# 构建上下文为 x_models/id_x_010/web：
#   podman build -t id_x_010-web -f x_models/id_x_010/web/Dockerfile x_models/id_x_010/web
#
# 运行时端口 2000（由 next start 通过 PORT 环境变量决定），
# haproxy 在同 Pod 内通过 127.0.0.1:2000 访问。

# --------------------------- 构建阶段 ---------------------------
FROM node:24-alpine AS build

WORKDIR /app

# 声明构建参数（由 up.sh 的 --build-arg 注入）
# Next.js 在构建时把 NEXT_PUBLIC_* 内联到客户端 bundle，必须在此设置
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_SUB_VERSION

# 按 lockfile 严格安装（可复现构建；npm 扁平化 node_modules 自动解析
# @heroui/react 的 peer dep；npmmirror 镜像源保持国内构建速度）
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com

# 再拷贝源码（.dockerignore 已排除 node_modules / .next / .env.local，
# NEXT_PUBLIC_* 由下方 ENV 注入，优先级高于 .env.local）
COPY . .

# 显式导出 ARG 为 ENV，确保 Next.js 构建期一定能拿到
ENV NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL} \
    NEXT_PUBLIC_SUB_VERSION=${NEXT_PUBLIC_SUB_VERSION}

# 构建后裁掉 devDependencies（typescript / tailwind / @types 等），
# 运行阶段只携带生产依赖
RUN npm run build \
    && npm prune --omit=dev

# --------------------------- 运行阶段 ---------------------------
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=2000 \
    HOSTNAME=0.0.0.0

# 拷贝构建产物与运行时所需文件（node 镜像自带非 root 的 node 用户）
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./
COPY --from=build --chown=node:node /app/postcss.config.mjs ./
COPY --from=build --chown=node:node /app/tsconfig.json ./

USER node

EXPOSE 2000
CMD ["npm", "start"]
