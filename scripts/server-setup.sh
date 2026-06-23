#!/bin/bash
# QQ农场 - 服务器自动化部署与测试脚本
# 用法: bash scripts/server-setup.sh

set -e

echo "============================================"
echo "  服务器自动检测与修复"
echo "============================================"
echo ""

# 1. 检查目录
if [ ! -d "/root/qq-farm-bot" ]; then
    echo "❌ 未找到 /root/qq-farm-bot，请确认路径"
    exit 1
fi
cd /root/qq-farm-bot
echo "✅ 项目目录: $(pwd)"

# 2. 拉取最新代码
echo ""
echo "--- 拉取最新代码 ---"
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
    echo "⏳ 有更新，正在拉取..."
    git pull origin main
else
    echo "✅ 代码已是最新"
fi
echo "当前版本: $(git log -1 --format='%h %s')"

# 3. 重建前端
echo ""
echo "--- 重建前端 ---"
cd web
npx vite build --mode production 2>&1 | tail -3
cd ..
echo "✅ 前端构建完成"

# 4. 更新systemd配置
echo ""
echo "--- 更新systemd服务 ---"
cp -f deploy/sniff9988.service /etc/systemd/system/
cp -f deploy/qq-farm-bot.service /etc/systemd/system/
systemctl daemon-reload
echo "✅ 服务配置已更新"

# 5. 检查端口占用并释放
echo ""
echo "--- 端口检查 ---"
for port in 3000 9988; do
    PID=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "⏳ 端口 $port 被 PID $PID 占用，正在释放..."
        kill -9 $PID 2>/dev/null || true
    fi
done
sleep 1
echo "✅ 端口已释放"

# 6. 重启服务
echo ""
echo "--- 重启服务 ---"
systemctl restart sniff9988 2>/dev/null || true
systemctl restart qq-farm-bot 2>/dev/null || true
sleep 3
echo "✅ 服务已重启"

# 7. 健康检查
echo ""
echo "--- 健康检查 ---"
# 检测面板
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 面板: HTTP $HTTP_CODE"
else
    echo "❌ 面板: HTTP $HTTP_CODE"
fi

# 检测sniff9988
if lsof -Pi :9988 -sTCP:LISTEN 2>/dev/null >/dev/null; then
    echo "✅ sniff9988: 运行中"
else
    echo "❌ sniff9988: 未运行"
fi

# 检测API
PING=$(curl -s http://localhost:3000/api/ping 2>/dev/null || echo "")
if echo "$PING" | grep -q "ok"; then
    echo "✅ API: 正常"
else
    echo "❌ API: 异常"
fi

# 8. 测试pending-code接口
echo ""
echo "--- 待认领接口测试 ---"
curl -s "http://localhost:3000/api/pending-code?code=test_code_123" 2>/dev/null | grep -q "ok.*true" && echo "✅ pending-code GET: 正常" || echo "❌ pending-code GET: 异常"

# 9. 登录测试
echo ""
echo "--- 登录测试 ---"
TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123456"}' 2>/dev/null | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$TOKEN" ]; then
    echo "✅ 登录成功 (admin)"

    # 测试claim接口
    CLAIM=$(curl -s -X POST http://localhost:3000/api/pending-code/claim \
      -H "x-admin-token: $TOKEN" 2>/dev/null)
    echo "✅ claim接口: $CLAIM"
else
    echo "❌ 登录失败，试试密码 admin / admin"
    TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
      -H "Content-Type: application/json" \
      -d '{"username":"admin","password":"admin"}' 2>/dev/null | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$TOKEN" ]; then
        echo "✅ 登录成功 (admin/admin)"
    else
        echo "⚠️ 两种密码都失败"
    fi
fi

echo ""
echo "============================================"
echo "  完成！打开 http://38.246.244.203:3000"
echo "============================================"
