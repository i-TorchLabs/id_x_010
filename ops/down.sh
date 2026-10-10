#!/usr/bin/env bash
# ====================================================================
# id_x_010 一体化容器部署停止/清理脚本（podman）
#
# 用法：
#   bash down.sh              # 移除容器与 Pod（保留镜像与数据卷）
#   bash down.sh --volumes    # 同时删除数据卷（数据库与日志，不可恢复！）
#   bash down.sh --images     # 同时删除本项目构建的镜像
#   bash down.sh --all        # 同时删除数据卷与镜像（完全清理）
# ====================================================================
set -euo pipefail
cd "$(dirname "$0")"

PROJECT_NAME="id_x_010"

REMOVE_VOLUMES=0
REMOVE_IMAGES=0
for arg in "$@"; do
  case "$arg" in
    -v|--volumes) REMOVE_VOLUMES=1 ;;
    -i|--images)  REMOVE_IMAGES=1 ;;
    -a|--all)     REMOVE_VOLUMES=1; REMOVE_IMAGES=1 ;;
    -h|--help)
      echo "用法: bash down.sh [--volumes|--images|--all]"
      echo "  --volumes, -v   同时删除数据卷（${PROJECT_NAME}_db / ${PROJECT_NAME}_logs，不可恢复）"
      echo "  --images,  -i   同时删除本项目构建的镜像（service / web）"
      echo "  --all,     -a   同时删除数据卷与镜像（完全清理）"
      exit 0
      ;;
    *)
      echo "[down] 未知参数: $arg（支持 --volumes / --images / --all / --help）" >&2
      exit 1
      ;;
  esac
done

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
# 3. 可选：删除本项目构建的镜像（默认保留）
#    官方镜像（postgres / haproxy）为共享依赖，始终不删
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
# 4. 可选：删除数据卷（默认保留，数据库不丢）
# ============================================
if [ "$REMOVE_VOLUMES" = "1" ]; then
  for vol in "${PROJECT_NAME}_db" "${PROJECT_NAME}_logs"; do
    if podman volume exists "$vol"; then
      podman volume rm "$vol" >/dev/null
      echo "[down] 数据卷 $vol 已删除"
    fi
  done
else
  echo "[down] 数据卷 ${PROJECT_NAME}_db / ${PROJECT_NAME}_logs 已保留（如需清除: bash down.sh --volumes）"
fi

echo "[down] 清理完成"
