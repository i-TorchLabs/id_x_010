#!/usr/bin/env bash
# ====================================================================
# id_x_010 一体化容器部署启动脚本（podman）
#
# 拓扑：单 Pod 四容器，共享网络命名空间
#   db       docker.io/library/postgres:18   :5432 → 宿主机 ${DB_HOST_PORT:-54321}
#   service  localhost/id_x_010-service      127.0.0.1:7000（Litestar + GraphQL，仅 Pod 内可达）
#   web      localhost/id_x_010-web          127.0.0.1:2000（Next.js，仅 Pod 内可达）
#   haproxy  docker.io/library/haproxy:3.0   :8080 → 宿主机 ${POD_PORT:-8010}
#
# 用法：
#   bash up.sh            # 首次构建镜像并启动（幂等，已存在则跳过）
#   bash up.sh --build    # 强制重建 service / web 镜像后启动
# ====================================================================
set -euo pipefail
cd "$(dirname "$0")"

PROJECT_NAME="id_x_010"

# ============================================
# 0. 前置检查与配置加载
# ============================================
if ! command -v podman >/dev/null 2>&1; then
  echo "[up] 错误: 未找到 podman，请先安装（https://podman.io）" >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "[up] 已从 .env.example 生成 .env，请按需修改后重新运行"
  exit 1
fi

# 导出 .env 中全部变量（注释行与空值均可安全处理）
set -a
# shellcheck disable=SC1091
source ./.env
set +a

POSTGRES_DB="${POSTGRES_DB:-id_x_010}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?[up] 请在 .env 中设置 POSTGRES_PASSWORD}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.io/library/postgres:18}"
HAPROXY_IMAGE="${HAPROXY_IMAGE:-docker.io/library/haproxy:3.0}"
# 自建镜像同样使用完全限定名（localhost/ 前缀），避免 short-name 解析歧义
SERVICE_IMAGE="localhost/${PROJECT_NAME}-service"
WEB_IMAGE="localhost/${PROJECT_NAME}-web"
POD_PORT="${POD_PORT:-8010}"
# 宿主机直连数据库端口（db 容器 5432 发布到宿主机该端口）
DB_HOST_PORT="${DB_HOST_PORT:-54321}"

# 提醒关键可选项未配置（不阻断，功能会降级）
# 提供商 api_key 已迁移至 external_provider / local_provider 表，
# 环境变量 EXTERNAL_API_KEY 仅作表无数据时的回退来源
if [ "${LLM_PROVIDER:-external}" = "external" ] && [ -z "${EXTERNAL_API_KEY:-}" ]; then
  echo "[up] 提示: LLM_PROVIDER=external，请确认 external_provider 表已写入提供商配置（或设置 EXTERNAL_API_KEY 作为回退）" >&2
fi

# ============================================
# 1. 构建镜像（若不存在或指定 --build）
# ============================================
if [ "${1:-}" = "--build" ] || ! podman image exists "${SERVICE_IMAGE}" || ! podman image exists "${WEB_IMAGE}"; then
  echo "[up] 构建 service 镜像..."
  podman build --format docker -t "${SERVICE_IMAGE}" -f Dockerfile.service ../../../
  echo "[up] 构建 web 镜像..."
  # NEXT_PUBLIC_ADFS_* 从 .env 读取（SSO 回调地址依赖部署域名）；
  # client_id 公开，client_secret 绝不作为构建参数（不进镜像层）。
  podman build --format docker -t "${WEB_IMAGE}" -f ../web/Dockerfile \
    --build-arg NEXT_PUBLIC_BASE_URL="" \
    --build-arg NEXT_PUBLIC_SUB_VERSION="/b/id_x_010/graphql" \
    --build-arg NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-}" \
    --build-arg NEXT_PUBLIC_ADFS_CLIENT_ID="${NEXT_PUBLIC_ADFS_CLIENT_ID:-}" \
    --build-arg NEXT_PUBLIC_ADFS_REDIRECT_URI="${NEXT_PUBLIC_ADFS_REDIRECT_URI:-}" \
    --build-arg NEXT_PUBLIC_ADFS_RESOURCE="${NEXT_PUBLIC_ADFS_RESOURCE:-}" \
    --build-arg NEXT_PUBLIC_ADFS_BASE_URL="${NEXT_PUBLIC_ADFS_BASE_URL:-}" \
    ../web
fi

# ============================================
# 2. 创建 Pod（已存在则跳过）
#    haproxy:8080 -> pod:8080 -> 宿主机:${POD_PORT}
#    db:5432      -> pod:5432 -> 宿主机:${DB_HOST_PORT}
#    （端口映射在 Pod 创建时固定，已存在的 Pod 无法追加）
# ============================================
if ! podman pod exists "${PROJECT_NAME}"; then
  podman pod create --name "${PROJECT_NAME}" \
    -p "${POD_PORT}:8080" \
    -p "${DB_HOST_PORT}:5432"
  echo "[up] Pod ${PROJECT_NAME} 已创建，端口映射 ${POD_PORT}:8080, ${DB_HOST_PORT}:5432"
elif ! podman pod inspect "${PROJECT_NAME}" | grep -Eq "[\":]${DB_HOST_PORT}[,\"}]"; then
  echo "[up] 提示: 现有 Pod 未映射 ${DB_HOST_PORT}:5432（数据库端口），如需发布请先 bash down.sh 再重新运行" >&2
fi

# ============================================
# 3. 创建数据卷（已存在则跳过）
# ============================================
for vol in "${PROJECT_NAME}_db" "${PROJECT_NAME}_logs"; do
  if ! podman volume exists "${vol}"; then
    podman volume create "${vol}" >/dev/null
    echo "[up] 数据卷 ${vol} 已创建"
  fi
done

# ============================================
# 4. 启动容器（已存在则跳过）
# ============================================

# -- db --
if ! podman container exists "${PROJECT_NAME}-db"; then
  podman run -d \
    --pod "${PROJECT_NAME}" \
    --name "${PROJECT_NAME}-db" \
    --restart unless-stopped \
    -e POSTGRES_DB="${POSTGRES_DB}" \
    -e POSTGRES_USER="${POSTGRES_USER}" \
    -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
    -v "${PROJECT_NAME}_db":/var/lib/postgresql \
    -v ./init:/docker-entrypoint-initdb.d:ro,z \
    --health-cmd "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}" \
    --health-interval 10s \
    --health-timeout 5s \
    --health-retries 10 \
    --health-start-period 20s \
    "${POSTGRES_IMAGE}"
  echo "[up] ${PROJECT_NAME}-db 已启动"
else
  echo "[up] ${PROJECT_NAME}-db 已存在，跳过"
fi

# 等待 db 就绪
echo "[up] 等待 db 健康检查通过..."
for i in $(seq 1 60); do
  status=$(podman inspect "${PROJECT_NAME}-db" --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
  if [ "$status" = "healthy" ]; then
    echo "[up] db 已就绪"
    break
  fi
  if [ "$i" = "60" ]; then
    echo "[up] 等待 db 超时，继续启动..."
  fi
  sleep 1
done

# -- service --
# 环境变量完全由 --env-file 注入（引擎层 env_loader 对根 .env 为 override=False，
# 与容器环境变量效果一致，故不再额外挂载 .env 文件）。
if ! podman container exists "${PROJECT_NAME}-service"; then
  podman run -d \
    --pod "${PROJECT_NAME}" \
    --name "${PROJECT_NAME}-service" \
    --restart unless-stopped \
    --env-file .env \
    -e DB_NAME="${POSTGRES_DB}" \
    -e DB_HOST=127.0.0.1 \
    -e DB_PORT=5432 \
    -e DB_USERNAME="${POSTGRES_USER}" \
    -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
    -e PROJECT_PATH=/app/i-Core \
    -v "${PROJECT_NAME}_logs":/app/i-Core/logs \
    --health-cmd "curl -sf -X POST http://127.0.0.1:7000/b/id_x_010/graphql -H 'Content-Type: application/json' -d '{\"query\":\"{ health { status } }\"}' || exit 1" \
    --health-interval 15s \
    --health-timeout 5s \
    --health-retries 10 \
    --health-start-period 30s \
    "${SERVICE_IMAGE}"
  echo "[up] ${PROJECT_NAME}-service 已启动"
else
  echo "[up] ${PROJECT_NAME}-service 已存在，跳过"
fi

# -- web --
if ! podman container exists "${PROJECT_NAME}-web"; then
  podman run -d \
    --pod "${PROJECT_NAME}" \
    --name "${PROJECT_NAME}-web" \
    --restart unless-stopped \
    --health-cmd "wget -q -O /dev/null http://127.0.0.1:2000/ || exit 1" \
    --health-interval 15s \
    --health-timeout 5s \
    --health-retries 10 \
    --health-start-period 20s \
    "${WEB_IMAGE}"
  echo "[up] ${PROJECT_NAME}-web 已启动"
else
  echo "[up] ${PROJECT_NAME}-web 已存在，跳过"
fi

# -- haproxy --
if ! podman container exists "${PROJECT_NAME}-haproxy"; then
  podman run -d \
    --pod "${PROJECT_NAME}" \
    --name "${PROJECT_NAME}-haproxy" \
    --restart unless-stopped \
    -v ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro,z \
    "${HAPROXY_IMAGE}"
  echo "[up] ${PROJECT_NAME}-haproxy 已启动"
else
  echo "[up] ${PROJECT_NAME}-haproxy 已存在，跳过"
fi

# ============================================
# 5. 端到端验证（宿主机视角）
# ============================================
if command -v curl >/dev/null 2>&1; then
  echo "[up] 等待 haproxy 入口就绪..."
  for i in $(seq 1 30); do
    if curl -sf -o /dev/null "http://localhost:${POD_PORT}/"; then
      echo "[up] 入口已就绪"
      break
    fi
    if [ "$i" = "30" ]; then
      echo "[up] 警告: 入口验证超时，请用 podman logs ${PROJECT_NAME}-haproxy 排查" >&2
    fi
    sleep 1
  done
fi

echo "[up] 所有服务已启动，访问入口: http://localhost:${POD_PORT}/"
podman pod ls --filter name="${PROJECT_NAME}"
podman ps --filter pod="${PROJECT_NAME}" --format "table {{.Names}}\t{{.Status}}"
