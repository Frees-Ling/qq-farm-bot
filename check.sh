#!/bin/bash
# QQ农场 - 服务器全面诊断脚本
# 用法: bash check.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

log() { echo -e "$1"; }
ok() { echo -e "  ${GREEN}✅${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}❌${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠️${NC} $1"; WARN=$((WARN+1)); }

echo ""
echo "================================================"
echo "  QQ农场 服务器全面诊断"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================"
echo ""

# ======== 1. 系统基础 ========
echo "--- 1/8 系统基础 ---"

if [ -d /root/qq-farm-bot ]; then
    ok "项目目录 /root/qq-farm-bot 存在"
else
    fail "项目目录不存在"
fi

DISK=$(df -h / | awk 'NR==2{print $5}' | sed 's/%//')
if [ "$DISK" -lt 90 ]; then
    ok "磁盘使用率: $DISK%"
else
    fail "磁盘使用率: $DISK%"
fi

MEM=$(free | awk '/Mem/{printf "%d", $3/$2*100}')
if [ "$MEM" -lt 90 ]; then
    ok "内存使用率: $MEM%"
else
    fail "内存使用率: $MEM%"
fi

echo ""

# ======== 2. Git代码 ========
echo "--- 2/8 Git代码 ---"

cd /root/qq-farm-bot 2>/dev/null || { fail "无法进入项目目录"; cd ~; }

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null)
if [ "$LOCAL" = "$REMOTE" ]; then
    ok "代码已是最新 ($(echo $LOCAL | cut -c1-8))"
elif [ -n "$REMOTE" ]; then
    warn "代码不是最新 本地=$(echo $LOCAL | cut -c1-8) 远程=$(echo $REMOTE | cut -c1-8)"
else
    warn "无法检查远程版本"
fi

# 检查是否有未提交的修改
if git diff --quiet 2>/dev/null; then
    ok "无未提交修改"
else
    warn "有未提交的本地修改"
fi

echo ""

# ======== 3. 端口进程 ========
echo "--- 3/8 端口进程 ---"

# 面板端口
if lsof -Pi :3000 -sTCP:LISTEN 2>/dev/null >/dev/null; then
    PANEL_PID=$(lsof -ti :3000 2>/dev/null)
    ok "面板端口3000: 运行中 (PID=$PANEL_PID)"
else
    fail "面板端口3000: 未监听"
fi

# sniff端口
if lsof -Pi :9988 -sTCP:LISTEN 2>/dev/null >/dev/null; then
    SNIFF_PID=$(lsof -ti :9988 2>/dev/null)
    ok "sniff端口9988: 运行中 (PID=$SNIFF_PID)"
else
    fail "sniff端口9988: 未监听"
fi

# 检查双端口是否有冲突
PANEL_PORT=$(lsof -Pi :3000 -sTCP:LISTEN 2>/dev/null | wc -l)
SNIFF_PORT=$(lsof -Pi :9988 -sTCP:LISTEN 2>/dev/null | wc -l)
if [ "$PANEL_PORT" -gt 2 ]; then
    warn "面板端口有多个进程占用"
fi
if [ "$SNIFF_PORT" -gt 2 ]; then
    warn "sniff端口有多个进程占用"
fi

echo ""

# ======== 4. API健康 ========
echo "--- 4/8 API健康 ---"

# Ping
PING=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/ping --connect-timeout 5 2>/dev/null || echo "000")
if [ "$PING" = "200" ]; then
    ok "API /api/ping: HTTP 200"
else
    fail "API /api/ping: HTTP $PING"
fi

# API返回数据
PING_DATA=$(curl -s http://localhost:3000/api/ping 2>/dev/null || echo "")
if echo "$PING_DATA" | grep -q '"ok":true'; then
    ok "API 数据格式正确"
else
    fail "API 数据异常: $PING_DATA"
fi

# 待认领接口
PENDING=$(curl -s "http://localhost:3000/api/pending-code?code=check_test_$(date +%s)" 2>/dev/null || echo "")
if echo "$PENDING" | grep -q '"ok":true'; then
    ok "pending-code接口: 正常"
else
    fail "pending-code接口: 异常"
fi

# 节点接口
NODES=$(curl -s http://localhost:3000/api/nodes/available 2>/dev/null || echo "")
if echo "$NODES" | grep -q '"ok":true'; then
    ok "nodes接口: 正常"
else
    fail "nodes接口: 异常"
fi

echo ""

# ======== 5. 登录 ========
echo "--- 5/8 账户认证 ---"

TOKEN=""
for cred in "admin:Admin@123456" "admin:admin" "Frees:Frees"; do
    USER=$(echo $cred | cut -d: -f1)
    PASSW=$(echo $cred | cut -d: -f2)
    RESP=$(curl -s -X POST http://localhost:3000/api/login \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$USER\",\"password\":\"$PASSW\"}" 2>/dev/null || echo "")
    TOKEN=$(echo "$RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$TOKEN" ]; then
        ok "登录成功: $USER / $PASSW"
        break
    fi
done

if [ -z "$TOKEN" ]; then
    fail "所有账号登录失败"
fi

# claim接口
if [ -n "$TOKEN" ]; then
    CLAIM=$(curl -s -X POST http://localhost:3000/api/pending-code/claim \
        -H "x-admin-token: $TOKEN" 2>/dev/null || echo "")
    if echo "$CLAIM" | grep -q '"ok":true'; then
        ok "claim接口: 正常"
    else
        fail "claim接口: $CLAIM"
    fi

    # 账号列表
    ACCOUNTS=$(curl -s http://localhost:3000/api/accounts \
        -H "x-admin-token: $TOKEN" 2>/dev/null || echo "")
    TOTAL=$(echo "$ACCOUNTS" | grep -o '"total":[0-9]*' | cut -d: -f2)
    if [ -n "$TOTAL" ]; then
        ok "账号列表: $TOTAL 个账号"
        echo "$ACCOUNTS" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | while read name; do
            echo "       - $name"
        done
    else
        fail "账号列表获取失败"
    fi
fi

echo ""

# ======== 6. sniff配置 ========
echo "--- 6/8 sniff配置 ---"

# 检查sniff默认配置
SNIFF_DEFAULT=$(grep "PANEL_API.*default" /root/qq-farm-bot/tools/sniff9988.py 2>/dev/null || grep "PANEL_API = " /root/qq-farm-bot/tools/sniff9988.py 2>/dev/null)
if echo "$SNIFF_DEFAULT" | grep -q "pending-code"; then
    ok "sniff默认转发地址: /api/pending-code"
else
    warn "sniff默认转发地址可能不对: $SNIFF_DEFAULT"
fi

SNIFF_USER=$(grep "DEFAULT_USERNAME" /root/qq-farm-bot/tools/sniff9988.py 2>/dev/null | head -1)
if echo "$SNIFF_USER" | grep -q '""'; then
    ok "sniff默认用户名为空(正确)"
else
    warn "sniff默认用户名: $SNIFF_USER"
fi

# 检查sniff实际转发地址
SNIFF_ENV=$(systemctl show qq-farm-sniff 2>/dev/null | grep "FARM_PANEL_API" || echo "")
if echo "$SNIFF_ENV" | grep -q "pending-code"; then
    ok "sniff环境变量指向: pending-code"
elif [ -z "$SNIFF_ENV" ]; then
    SNIFF_ENV2=$(systemctl show qq-farm-sniff 2>/dev/null | grep "Environment" || echo "(无环境变量)")
    warn "sniff未设FARM_PANEL_API，使用默认值"
else
    warn "sniff环境变量: $SNIFF_ENV"
fi

echo ""

# ======== 7. game.js补丁 ========
echo "--- 7/8 game.js补丁 ---"

QQ_CACHE=$(find /root -path "*/miniapp_src/*" -name "game.js" 2>/dev/null | head -5)
if [ -n "$QQ_CACHE" ]; then
    PATCHED=$(grep -c "QQ_FARM_CODE_CAPTURE" $QQ_CACHE 2>/dev/null || echo 0)
    if [ "$PATCHED" -gt 0 ]; then
        ok "game.js补丁已注入 ($(echo $QQ_CACHE | head -1))"
    else
        warn "找到game.js但补丁未注入"
    fi
else
    warn "未找到QQ Farm缓存（不在本机或从未开过农场）"
fi

echo ""

# ======== 8. 综合报告 ========
echo "================================================"
echo "  诊断报告"
echo "================================================"
echo ""
echo -e "  ${GREEN}通过${NC}: $PASS    ${RED}失败${NC}: $FAIL    ${YELLOW}警告${NC}: $WARN"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo -e "  ${RED}⚠️ 存在 $FAIL 个问题需要修复${NC}"
elif [ "$WARN" -gt 0 ]; then
    echo -e "  ${YELLOW}⚠️ 存在 $WARN 个警告建议检查${NC}"
else
    echo -e "  ${GREEN}✅ 全部正常！${NC}"
fi
echo ""

# 给出修复建议
if [ "$FAIL" -gt 0 ] || [ "$WARN" -gt 0 ]; then
    echo "修复建议:"
    echo "  完整重装: bash ~/qq-farm-bot/install.sh"
    echo "  查看日志: journalctl -u qq-farm-bot -f"
    echo "  sniff日志: journalctl -u qq-farm-sniff -f"
    echo ""
fi

echo "================================================"
