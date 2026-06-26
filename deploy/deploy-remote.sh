#!/bin/bash
# QQ农场 - 远程服务器一键更新脚本
# 用法: bash deploy-remote.sh
set -e

echo "=========================================="
echo "  QQ 农场 - 远程服务器更新"
echo "=========================================="

echo ""
echo "1/4 拉取最新代码..."
cd /root/qq-farm-bot
git pull origin main
echo "✅ 代码已更新"

echo ""
echo "2/4 安装依赖..."
pnpm install -r
echo "✅ 依赖已安装"

echo ""
echo "3/4 构建前端..."
pnpm build:web
echo "✅ 前端已构建"

echo ""
echo "4/4 重启服务..."
systemctl restart qq-farm-bot
sleep 3

echo ""
echo "=========================================="
echo "  验证"
echo "=========================================="
echo ""
echo "服务状态:"
systemctl status qq-farm-bot --no-pager | head -10
echo ""

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
echo "面板 HTTP: $HTTP_CODE"

echo ""
echo "设备指纹:"
journalctl -u qq-farm-bot --since "1 minute ago" | grep -i "设备\|指纹\|PLM" || echo "  (等待日志...)"
echo ""

echo "=========================================="
echo "  完成"
echo "  面板: http://38.246.244.203:3000"
echo "  日志: journalctl -u qq-farm-bot -f"
echo "=========================================="
