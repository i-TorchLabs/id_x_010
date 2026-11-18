#!/usr/bin/env bash
# ====================================================================
# id_x_010 容器部署停止/清理脚本（podman，外部第三方 PostgreSQL 模式）
#
# 数据不在本机（外部第三方库）；日志经 bind mount 落在 ../logs，
# 容器清理不会影响宿主机日志文件。
#
# 用法：
#   bash down.sh              # 移除容器与 Pod（保留镜像）
#   bash down.sh --legacy-vol # 顺带删除旧版命名卷 id_x_010_logs（不可恢复！）
#   bash down.sh --images     # 同时删除本项目构建的镜像
#   bash down.sh --all        # 同时删除旧命名卷与镜像（完全清理；
#                             # 宿主机 ../logs 日志目录仍保留，按需手动删）
# ====================================================================
set -euo pipefail
cd "$(dirname "$0")"

PROJECT_NAME="id_x_010"
LEGACY_VOLUME="${PROJECT_NAME}_logs"

REMOVE_VOLUMES=0
REMOVE_IMAGES=0
for arg in "$@"; do
  case "$arg" in
    -v|--volumes|--legacy-vol) REMOVE_VOLUMES=1 ;;
    -i|--images)  REMOVE_IMAGES=1 ;;
    -a|--all)     REMOVE_VOLUMES=1; REMOVE_IMAGES=1 ;;
    -h|--help)
      echo "用法: bash down.sh [--legacy-vol|--images|--all]"
      echo "  --legacy-vol, -v  同时删除旧版命名卷 ${LEGACY_VOLUME}（日志已改用 ../logs bind mount）"
      echo "  --images,    -i   同时删除本项目构建的镜像（service / web）"
      echo "  --all,       -a   同时删除旧命名卷与镜像（完全清理；../logs 日志保留）"
      exit 0
      ;;
    *)
      echo "[down] 未知参数: $arg（支持 --legacy-vol / --images / --all / --help）" >&2
      exit 1
      ;;
  esac
done

# ============================================
# 1. 移除容器（顺序与启动相反；无 db 容器——数据库为外部第三方库）
# ============================================
for name in "${PROJECT_NAME}-haproxy" "${PROJECT_NAME}-web" "${PROJECT_NAME}-service"; do
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
# 3. 可选：删除本项目构建的镜像（默认保留）
#    官方镜像（haproxy）为共享依赖，始终不删
# ============================================
if [ "$REMOVE_IMAGES" = "1" ]; then
  for image in "localhost/${PROJECT_NAME}-service" "localhost/${PROJECT_NAME}-web"; do
    if podman image exists "$image"; then
      if podman rmi "$image" >/dev/null 2>&1; then
        echo "[down] 镜像 $image 已删除"
      else
        echo "[down] 镜像 $image 删除失败（可能仍被引用）"
      fi
    fi
  done
else
  echo "[down] 镜像已保留（如需清除: bash down.sh --images）"
fi

# ============================================
# 4. 可选：删除旧版命名卷（默认保留）
#    日志已改用 bind mount 落宿主机 ../logs，容器清理不影响日志文件；
#    本步骤仅清理历史遗留的命名卷
# ============================================
if [ "$REMOVE_VOLUMES" = "1" ]; then
  if podman volume exists "${LEGACY_VOLUME}"; then
    podman volume rm "${LEGACY_VOLUME}" >/dev/null
    echo "[down] 旧命名卷 ${LEGACY_VOLUME} 已删除"
  else
    echo "[down] 旧命名卷 ${LEGACY_VOLUME} 不存在，跳过"
  fi
else
  echo "[down] 旧命名卷 ${LEGACY_VOLUME} 已保留（如需清除: bash down.sh --legacy-vol）"
fi

echo "[down] 日志目录（bind mount 宿主机侧）: $(cd .. && pwd)/logs"

echo "[down] 清理完成"
