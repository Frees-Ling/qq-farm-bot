#!/bin/bash
# 快速构建脚本（跳过TypeScript检查，速度提升2-3倍）
set -e
echo "=== 快速构建 Web 前端 ==="
cd "$(dirname "$0")/web"
npx vite build --mode production
echo "构建完成！"
cd ..
echo "=== 启动服务器 ==="
cd core && node client.js