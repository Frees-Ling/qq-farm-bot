#!/bin/bash
# QQ农场 - Code捕获调试脚本
# 用法: ssh root@服务器 "bash tools/diagnose-capture.sh"

echo "========================================"
echo "  QQ农场 Code捕获诊断"
echo "========================================"
echo ""

# 1. 检查 sniff 服务
echo ">>> 1. sniff 服务进程"
ps aux | grep sniff9988 | grep -v grep || echo "  ❌ sniff9988 未运行"
echo ""

# 2. 检查端口 9988
echo ">>> 2. 端口 9988 监听状态"
lsof -Pi :9988 -sTCP:LISTEN 2>/dev/null || ss -tlnp | grep 9988 || echo "  ❌ 9988 端口未监听"
echo ""

# 3. 检查端口 3000
echo ">>> 3. 面板端口 3000"
lsof -Pi :3000 -sTCP:LISTEN 2>/dev/null || ss -tlnp | grep 3000
echo ""

# 4. 测试 sniff 是否响应
echo ">>> 4. sniff 健康检查"
curl -s http://localhost:9988/health 2>&1 || echo "  ❌ sniff 无响应"
echo ""
echo ""

# 5. 测试 sniff 转发到面板
echo ">>> 5. 测试 code 转发"
curl -s "http://localhost:9988/?code=test_diagnose_$(date +%s)" 2>&1 | head -c 200
echo ""
echo ""

# 6. 检查面板最近的 code 捕获记录
echo ">>> 6. 最近捕获的 code"
curl -s http://localhost:3000/api/pc-capture/info 2>&1 | head -c 500
echo ""
echo ""

# 7. 检查 store.json 中的 code 记录
echo ">>> 7. accounts.json 账号数"
grep -c '"id"' /root/qq-farm-bot/core/data/accounts.json 2>/dev/null || echo "  文件不存在"
echo ""

# 8. 测试 WebSocket 是否能连接
echo ">>> 8. WebSocket 目标服务器连通性"
curl -s -o /dev/null -w "  gate-obt.nqf.qq.com: %{http_code} (%{time_total}s)" https://gate-obt.nqf.qq.com/ 2>&1 || echo "  ❌ 无法连接"
echo ""

echo "========================================"
echo "  诊断完成"
echo "========================================"
