#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 项目名称（取自上级目录名，与项目同名）
PROJECT_NAME=$(basename "$(dirname "$(pwd)")")

# ============================================
# 1. 移除容器（顺序与启动相反）
# ============================================
for name in "${PROJECT_NAME}-haproxy" "${PROJECT_NAME}-web" "${PROJECT_NAME}-service" "${PROJECT_NAME}-db"; do
  if podman container exists "$name"; then
    podman rm -f "$name" >/dev/null
    echo "[down] 容器 $name 已移除"
  fi
done

# ============================================
# 2. 删除 Pod
# ============================================
if podman pod exists "${PROJECT_NAME}"; then
  podman pod rm -f "${PROJECT_NAME}"
  echo "[down] Pod ${PROJECT_NAME} 已删除"
fi

# ============================================
# 3. 删除本项目构建的镜像
#    官方镜像（postgres / haproxy）为共享依赖，保留
# ============================================
for image in "${PROJECT_NAME}-service" "${PROJECT_NAME}-web"; do
  if podman image exists "$image"; then
    if podman rmi "$image" >/dev/null 2>&1; then
      echo "[down] 镜像 $image 已删除"
    else
      echo "[down] 镜像 $image 删除失败（可能仍被引用）"
    fi
  fi
done

echo "[down] 容器、镜像与 Pod 已清理"
