#!/bin/bash
set -e

echo "==================================="
echo "  QQ农场 - 一键安装启动脚本"
echo "  用法: bash install.sh"
echo "==================================="
echo ""

cd ~/qq-farm-bot || { echo "❌ 找不到 ~/qq-farm-bot"; exit 1; }

# 1. 拉取最新代码
echo "--- 1/5 拉取代码 ---"
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main 2>/dev/null)
if [ "$LOCAL" != "$REMOTE" ]; then
    git pull origin main
    echo "✅ 已更新"
else
    echo "✅ 已是最新"
fi

# 2. 重建前端
echo ""
echo "--- 2/5 重建前端 ---"
cd web
npx vite build --mode production 2>&1 | tail -1
cd ..

# 3. 杀了所有旧进程
echo ""
echo "--- 3/5 清理旧进程 ---"
for port in 3000 9988; do
    PID=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$PID" ]; then
        kill -9 $PID 2>/dev/null || true
        echo "  ⏳ 端口$port 旧进程(PID=$PID)已杀"
    fi
done
sleep 2

# 4. 安装服务（只用一个service搞定）
echo ""
echo "--- 4/5 安装服务 ---"

# 先停掉systemd服务避免冲突
systemctl stop qq-farm-bot 2>/dev/null || true
systemctl stop sniff9988 2>/dev/null || true
systemctl disable sniff9988 2>/dev/null || true

# 安装面板服务
cat > /etc/systemd/system/qq-farm-bot.service << 'SERVICEOF'
[Unit]
Description=QQ Farm Bot
After=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/qq-farm-bot
ExecStart=/usr/bin/node core/client.js
Restart=always
RestartSec=3
Environment=ADMIN_PORT=3000

[Install]
WantedBy=multi-user.target
SERVICEOF

# 安装sniff服务
cat > /etc/systemd/system/qq-farm-sniff.service << 'SERVICEOF'
[Unit]
Description=QQ Farm Code Capture
After=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/qq-farm-bot
ExecStart=/usr/bin/python3 tools/sniff9988.py
Restart=always
RestartSec=3
Environment=FARM_PANEL_API=http://127.0.0.1:3000/api/pending-code

[Install]
WantedBy=multi-user.target
SERVICEOF

systemctl daemon-reload
echo "✅ 服务安装完成"

# 5. 启动
echo ""
echo "--- 5/5 启动服务 ---"
systemctl start qq-farm-bot
sleep 4

# 检查面板
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 面板: http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):3000"
else
    echo "❌ 面板启动失败，查看日志: journalctl -u qq-farm-bot -n 30 --no-pager"
    journalctl -u qq-farm-bot -n 10 --no-pager 2>/dev/null | grep -i "error\|syntax" || true
    exit 1
fi

# 启动sniff
systemctl start qq-farm-sniff
sleep 2
SNIFF_OK=$(lsof -Pi :9988 -sTCP:LISTEN 2>/dev/null && echo "1" || echo "0")
if [ "$SNIFF_OK" = "1" ]; then
    echo "✅ sniff: 端口9988运行中"
else
    echo "❌ sniff启动失败"
    journalctl -u qq-farm-sniff -n 10 --no-pager 2>/dev/null | grep -i "error\|syntax" || true
fi

# 测试pending-code接口
curl -s "http://localhost:3000/api/pending-code?code=install_test" 2>/dev/null | grep -q "ok" && \
    echo "✅ pending-code接口正常" || echo "⚠️ pending-code接口异常"

echo ""
echo "==================================="
echo "  启动完成!"
echo "  面板: http://38.246.244.203:3000"
echo "  账号: admin / Admin@123456"
echo "==================================="
echo ""
echo "常用命令:"
echo "  systemctl status qq-farm-bot     # 查看面板状态"
echo "  systemctl status qq-farm-sniff   # 查看sniff状态"
echo "  journalctl -u qq-farm-bot -f     # 实时查看日志"
echo ""
