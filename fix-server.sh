#!/bin/bash
set -e

# QQ农场 - 服务器一键修复脚本
# 在服务器上执行: bash fix-server.sh

echo "========================================"
echo "  QQ农场 服务器一键修复"
echo "========================================"
echo ""

# 0. 进入目录
cd ~/qq-farm-bot
echo "✅ 目录: $(pwd)"

# 1. 拉取最新代码
echo ""
echo "--- 1/6 拉取最新代码 ---"
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
    git pull origin main
    echo "✅ 已更新 $(echo $LOCAL | cut -c1-8) → $(echo $REMOTE | cut -c1-8)"
else
    echo "✅ 已是最新 ($(echo $LOCAL | cut -c1-8))"
fi

# 2. 重建前端
echo ""
echo "--- 2/6 重建前端 ---"
cd web
npx vite build --mode production 2>&1 | tail -3
cd ..
echo "✅ 前端构建完成"

# 3. 更新systemd配置
echo ""
echo "--- 3/6 更新systemd服务 ---"
cp -f deploy/sniff9988.service /etc/systemd/system/
cp -f deploy/qq-farm-bot.service /etc/systemd/system/
systemctl daemon-reload
echo "✅ systemd配置已更新"

# 4. 强制杀掉旧进程（关键！确保老进程不会残留）
echo ""
echo "--- 4/6 清理旧进程 ---"
OLDPID=$(lsof -ti:9988 2>/dev/null || true)
if [ -n "$OLDPID" ]; then
    echo "⏳ 端口9988旧进程 PID=$OLDPID，强制杀掉..."
    kill -9 $OLDPID 2>/dev/null || true
    sleep 2
fi

OLDPID=$(lsof -ti:3000 2>/dev/null || true)
if [ -n "$OLDPID" ] && [ "$OLDPID" != "$$" ]; then
    echo "⏳ 端口3000旧进程 PID=$OLDPID，强制杀掉..."
    kill -9 $OLDPID 2>/dev/null || true
    sleep 2
fi
echo "✅ 旧进程已清理"

# 5. 重启服务
echo ""
echo "--- 5/6 重启服务 ---"
systemctl restart sniff9988 2>/dev/null || true
systemctl restart qq-farm-bot 2>/dev/null || true
sleep 3

# 检查sniff是否启动成功
if lsof -Pi :9988 -sTCP:LISTEN 2>/dev/null >/dev/null; then
    echo "✅ sniff9988: 运行中"
else
    echo "⚠️ sniff9988: 尝试直接启动..."
    cd ~/qq-farm-bot
    nohup python3 tools/sniff9988.py > /dev/null 2>&1 &
    sleep 2
fi

# 6. 验证
echo ""
echo "--- 6/6 验证 ---"

# 面板
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
echo "  面板: HTTP $HTTP_CODE"

# sniff转发地址
FORWARD_TO=$(journalctl -u sniff9988 --no-pager -n 5 2>/dev/null | grep "forwarding to" | tail -1 || echo "")
if echo "$FORWARD_TO" | grep -q "pending-code"; then
    echo "  sniff转发: ✅ /api/pending-code (正确)"
elif echo "$FORWARD_TO" | grep -q "code-capture"; then
    echo "  sniff转发: ❌ /api/code-capture (错误! 需要检查配置)"
else
    echo "  sniff转发: ⚠️ 无法确认"
fi

# API
curl -s http://localhost:3000/api/ping 2>/dev/null | grep -q "ok" && echo "  API: ✅" || echo "  API: ❌"

# pending-code接口
curl -s "http://localhost:3000/api/pending-code?code=test_$(date +%s)" 2>/dev/null | grep -q "ok" && echo "  pending-code: ✅" || echo "  pending-code: ❌"

echo ""
echo "========================================"
echo " 完成！用以下步骤验证："
echo "  1. 开无痕浏览器访问 http://38.246.244.203:3000"
echo "  2. 用 Frees/Frees 登录"
echo "  3. 添加账号 → PC监听 → 开始监听"
echo "  4. 打开PC QQ农场"
echo "  5. 查日志确认: journalctl -u sniff9988 -f | grep \"forward url\""
echo "========================================"
