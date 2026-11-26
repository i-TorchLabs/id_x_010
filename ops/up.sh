#!/usr/bin/env bash
# ====================================================================
# id_x_010 容器部署启动脚本（podman，外部第三方 PostgreSQL 模式）
#
# 与 id_x_007 的部署模式对齐：不再内置 db 容器 / pgvector 镜像，
# service 直连 ops/.env 的 DB_* 指定的外部第三方 PostgreSQL；
# 表结构与预置数据（提供商 / 目标库 / 系统模型 / SSO / 初始管理员 /
# 模型价格）由应用启动时幂等创建/播种（create_all + x_seed），
# ops/init/*.sql 仅作手动初始化/审阅参考。
#
# 拓扑：单 Pod 三容器，共享网络命名空间
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
  echo "[up] 已从 .env.example 生成 .env，请填写外部数据库 DB_* 等配置后重新运行"
  exit 1
fi

# 导出 .env 中全部变量（注释行与空值均可安全处理）
set -a
# shellcheck disable=SC1091
source ./.env
set +a

# ---- 外部数据库配置校验 + 清洗（对齐 id_x_007 up.sh） ----
for var in DB_HOST DB_NAME DB_USERNAME DB_PASSWORD; do
  if [ -z "${!var:-}" ]; then
    echo "[up] 错误: ops/.env 缺少外部数据库配置 ${var}" >&2
    exit 1
  fi
done
DB_PORT="${DB_PORT:-5432}"
# 容错：剔除 Windows 编辑器引入的 CR 与首尾空白（否则 TCP/psycopg2 连接都会失败）
for var in DB_HOST DB_PORT DB_NAME DB_USERNAME DB_PASSWORD; do
  val="${!var}"
  val="${val//$'\r'/}"
  val="$(echo "${val}" | xargs)"
  printf -v "${var}" '%s' "${val}"
done

HAPROXY_IMAGE="${HAPROXY_IMAGE:-docker.io/library/haproxy:3.0}"
# 自建镜像使用完全限定名（localhost/ 前缀），避免 short-name 解析歧义
SERVICE_IMAGE="localhost/${PROJECT_NAME}-service"
WEB_IMAGE="localhost/${PROJECT_NAME}-web"
POD_PORT="${POD_PORT:-8010}"

# 提醒关键可选项未配置（不阻断，功能会降级）
# 提供商 api_key 由应用启动播种至 external_provider / local_provider 表，
# 表无数据时相关 Agent 不可用
if [ "${LLM_PROVIDER:-external}" = "external" ]; then
  echo "[up] 提示: LLM_PROVIDER=external，external_provider 表将由应用播种默认网关配置" >&2
fi

# ============================================
# 1. 外部数据库连通性预检（对齐 id_x_007 up.sh）
# ============================================
# TCP 探测（3s 超时）：依工具可用性逐个回退，避免个别 bash 禁用 /dev/tcp 造成假阴性
probe_db() {
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -t 3 >/dev/null 2>&1 && return 0
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 3 "${DB_HOST}" "${DB_PORT}" >/dev/null 2>&1 && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket; s=socket.socket(); s.settimeout(3); s.connect(('${DB_HOST}', int('${DB_PORT}')))" 2>/dev/null && return 0
  fi
  timeout 3 bash -c "exec 3<>/dev/tcp/${DB_HOST}/${DB_PORT}" 2>/dev/null && return 0
  return 1
}

if [ "${SKIP_DB_CHECK:-}" = "1" ]; then
  echo "[up] SKIP_DB_CHECK=1，跳过宿主机侧数据库连通性预检"
elif [ "${DB_HOST}" = "host.containers.internal" ]; then
  # 该域名仅容器内可解析，宿主机侧无法预检，跳过（由容器内探测兜底）
  echo "[up] DB_HOST=host.containers.internal，跳过宿主机侧连通性预检"
else
  echo "[up] 检测外部数据库连通性 ${DB_HOST}:${DB_PORT} ..."
  db_ok=0
  for _ in $(seq 1 5); do
    if probe_db; then db_ok=1; break; fi
    sleep 2
  done
  if [ "${db_ok}" != "1" ]; then
    echo "[up] 错误: 宿主机无法 TCP 直连 ${DB_HOST}:${DB_PORT}（ping 通不代表端口通）" >&2
    echo "[up] 排查: 1) psql \"host=${DB_HOST} port=${DB_PORT} user=${DB_USERNAME} dbname=${DB_NAME}\" -c 'select 1' 验证；" >&2
    echo "[up]       2) 多为数据库服务器防火墙未放行本机 IP，或 listen_addresses / 端口不对；" >&2
    echo "[up]       3) 确认宿主机确实可连，可 SKIP_DB_CHECK=1 bash up.sh 跳过本预检。" >&2
    exit 1
  fi
fi

# ============================================
# 2. 构建镜像（若不存在或指定 --build）
# ============================================
if [ "${1:-}" = "--build" ] \
   || ! podman image exists "${SERVICE_IMAGE}" \
   || ! podman image exists "${WEB_IMAGE}"; then
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
# 3. 创建 Pod（已存在则跳过）
#    haproxy:8080 -> pod:8080 -> 宿主机:${POD_PORT}
# ============================================
if ! podman pod exists "${PROJECT_NAME}"; then
  # ChinaRouter HK 节点固定解析：避免走 GA 公网线路导致 TLS 后空回复。
  # Pod 级 --add-host 写入共享网络命名空间，service/web/haproxy 均可解析。
  podman pod create --name "${PROJECT_NAME}" \
    -p "${POD_PORT}:8080" \
    --add-host=apihk.chinarouter.net:47.84.61.46
  echo "[up] Pod ${PROJECT_NAME} 已创建，端口映射 ${POD_PORT}:8080"
fi

# ============================================
# 4. 准备宿主机日志目录（bind mount 透传至 x_models/id_x_010/logs）
#    容器内 service 以 uid 10001（app）运行，rootless podman 下该 uid
#    映射到宿主机 subuid 段、与目录属主不同——1777（sticky+全员可写）
#    保证容器可写入，sticky 位防互删（对齐 id_x_007 的做法）。
# ============================================
LOGS_HOST_DIR="$(cd .. && pwd)/logs"
mkdir -p "${LOGS_HOST_DIR}"
chmod 1777 "${LOGS_HOST_DIR}"

# 迁移提示：旧版曾用命名卷 id_x_010_logs，改为 bind mount 后不再使用；
# 卷内历史日志如需保留可手动导出（podman volume export）后删除卷
if podman volume exists "${PROJECT_NAME}_logs"; then
  echo "[up] 提示: 检测到旧命名卷 ${PROJECT_NAME}_logs（已改用 ../logs bind mount，" >&2
  echo "[up]       如不再需要可执行: podman volume rm ${PROJECT_NAME}_logs）" >&2
fi

# ============================================
# 5. 启动容器（已存在则跳过）
# ============================================

# -- service --
# 环境变量完全由 --env-file 注入（引擎层 env_loader 对根 .env 为 override=False，
# 与容器环境变量效果一致，故不再额外挂载 .env 文件）。
# DB_* 显式以 -e 再注入一遍，确保覆盖 .env 中可能残留的同名占位。
if ! podman container exists "${PROJECT_NAME}-service"; then
  podman run -d \
    --pod "${PROJECT_NAME}" \
    --name "${PROJECT_NAME}-service" \
    --restart unless-stopped \
    --env-file .env \
    -e DB_NAME="${DB_NAME}" \
    -e DB_HOST="${DB_HOST}" \
    -e DB_PORT="${DB_PORT}" \
    -e DB_USERNAME="${DB_USERNAME}" \
    -e DB_PASSWORD="${DB_PASSWORD}" \
    -e ADMIN_EMAIL="${ADMIN_EMAIL:-}" \
    -e ADMIN_PASSWORD="${ADMIN_PASSWORD:-}" \
    -e PROJECT_PATH=/app/i-Core \
    -v "${LOGS_HOST_DIR}":/app/i-Core/logs \
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

# 容器内部连通性探测：宿主机通 ≠ 容器通（rootless NAT / 防火墙 FORWARD 链 / MTU 均可能拦截）
echo "[up] 检测容器内部 -> ${DB_HOST}:${DB_PORT} 连通性 ..."
container_db_ok=0
for _ in $(seq 1 5); do
  if podman exec "${PROJECT_NAME}-service" python -c "import socket; s=socket.socket(); s.settimeout(3); s.connect(('${DB_HOST}', int('${DB_PORT}')))" 2>/dev/null; then
    container_db_ok=1
    break
  fi
  sleep 2
done
if [ "${container_db_ok}" = "1" ]; then
  echo "[up] 容器内部连接数据库正常"
else
  echo "[up] 警告: 容器内部无法 TCP 直连 ${DB_HOST}:${DB_PORT}（宿主机侧预检已通过则多为容器网络问题）" >&2
  echo "[up] 排查: 1) rootless podman 查看网络后端: podman info --format '{{.Host.NetworkBackend}}'；" >&2
  echo "[up]          pasta 后端偶发 MTU/路由问题，可改 slirp4netns 对比重建 Pod；" >&2
  echo "[up]       2) rootful 部署检查 firewalld/nftables 是否拦截容器源网段的 FORWARD/MASQUERADE；" >&2
  echo "[up]       3) 数据库侧 pg_hba.conf 须放行宿主机 IP（容器出站经 NAT 后源地址即宿主机 IP）；" >&2
  echo "[up]       4) 看后端具体报错: podman logs ${PROJECT_NAME}-service" >&2
fi

# 外部 LLM 网关出网预检（不阻断启动）。
# 现象对齐：TLS 能建连但对端空回复 / RemoteProtocolError，与「Key 无效」不同；
# 宿主机与容器同时失败时，优先查网关侧 IP 白名单 / 线路，而非 Pod 网络策略。
LLM_EGRESS_URL="${LLM_EGRESS_URL:-https://apihk.chinarouter.net/v1/models}"
echo "[up] 检测 LLM 网关出网 ${LLM_EGRESS_URL} ..."
probe_llm_http() {
  # $1=host|container
  local where="$1"
  if [ "${where}" = "host" ]; then
    curl -sS -o /dev/null --connect-timeout 5 --max-time 12 \
      -w '%{http_code}' "${LLM_EGRESS_URL}" 2>/dev/null || echo "000"
  else
    podman exec "${PROJECT_NAME}-service" python -c "
import urllib.request
try:
    r = urllib.request.urlopen('${LLM_EGRESS_URL}', timeout=12)
    print(r.status)
except Exception:
    print('000')
" 2>/dev/null || echo "000"
  fi
}
host_llm_code="$(probe_llm_http host | tr -d '\r\n')"
ctr_llm_code="$(probe_llm_http container | tr -d '\r\n')"
# 2xx/3xx/401/403 都算「链路可达」（401/403 说明网关在回 HTTP，只是鉴权）
llm_reachable() {
  case "$1" in
    2*|3*|401|403) return 0 ;;
    *) return 1 ;;
  esac
}
if llm_reachable "${host_llm_code}" && llm_reachable "${ctr_llm_code}"; then
  echo "[up] LLM 网关出网正常（host=${host_llm_code}, container=${ctr_llm_code}）"
elif llm_reachable "${host_llm_code}" && ! llm_reachable "${ctr_llm_code}"; then
  echo "[up] 警告: 宿主机可达 LLM 网关（${host_llm_code}），容器不可达（${ctr_llm_code}）——偏容器网络/代理" >&2
  echo "[up] 排查: podman info NetworkBackend；对比 HTTP(S)_PROXY；必要时 --network=host 试验" >&2
elif ! llm_reachable "${host_llm_code}" && ! llm_reachable "${ctr_llm_code}"; then
  echo "[up] 警告: 宿主机与容器均无法从 LLM 网关拿到 HTTP 响应（host=${host_llm_code}, container=${ctr_llm_code}）" >&2
  echo "[up] 这通常不是镜像构建问题：DNS/TCP/TLS 可能正常，但对端空回复（RemoteProtocolError）。" >&2
  echo "[up] 请向 ChinaRouter 确认本机出口 IP 是否在白名单；可用 curl ifconfig.me 查看出口。" >&2
else
  echo "[up] 警告: LLM 网关探测异常 host=${host_llm_code} container=${ctr_llm_code}" >&2
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
# 6. 端到端验证（宿主机视角）
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
echo "[up] 数据库（外部第三方 PostgreSQL）: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
podman pod ls --filter name="${PROJECT_NAME}"
podman ps --filter pod="${PROJECT_NAME}" --format "table {{.Names}}\t{{.Status}}"
