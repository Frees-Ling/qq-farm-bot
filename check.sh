#!/bin/bash
# QQ农场 - 服务器全面诊断脚本 v2
# 用法: bash check.sh [--fix]  加 --fix 自动修复可修复的问题

set -e
cd /root/qq-farm-bot 2>/dev/null || { echo "❌ 项目目录不存在"; exit 1; }

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0; FIXES=""
ok() { echo -e "  ${GREEN}✅${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}❌${NC} $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠️${NC} $1"; WARN=$((WARN+1)); }
section() { echo ""; echo -e "${CYAN}--- $1 ---${NC}"; }

echo ""
echo "================================================"
echo "  QQ农场 服务器全面诊断 v2"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  主机: $(hostname)"
echo "  内核: $(uname -r)"
echo "================================================"

# ==================== 1. 系统资源 ====================
section "1/12 系统资源"

# CPU
CPU_LOAD=$(uptime | grep -oP 'load average:.*' | grep -oP '\d+\.\d+' | head -1)
if [ -n "$CPU_LOAD" ] && [ "${CPU_LOAD%.*}" -lt 4 ]; then
    ok "CPU负载: $CPU_LOAD"
else
    warn "CPU负载较高: $CPU_LOAD"
fi

# 内存
MEM_TOTAL=$(free -h | awk '/Mem:/{print $2}')
MEM_USED=$(free -h | awk '/Mem:/{print $3}')
MEM_PCT=$(free | awk '/Mem:/{printf "%.0f", $3/$2*100}')
if [ "$MEM_PCT" -lt 80 ]; then
    ok "内存: $MEM_USED/$MEM_TOTAL ($MEM_PCT%)"
else
    warn "内存使用率高: $MEM_USED/$MEM_TOTAL ($MEM_PCT%)"
fi

# 磁盘
DISK_PCT=$(df / | awk 'NR==2{print+$5}')
DISK_AVAIL=$(df -h / | awk 'NR==2{print $4}')
if [ "$DISK_PCT" -lt 85 ]; then
    ok "磁盘: 剩余$DISK_AVAIL (已用$DISK_PCT%)"
else
    fail "磁盘空间不足: 剩余$DISK_AVAIL (已用$DISK_PCT%)"
fi

# Node版本
NODE_VER=$(node -v 2>/dev/null || echo "未安装")
if [ -n "$NODE_VER" ] && [ "$NODE_VER" != "未安装" ]; then
    ok "Node.js: $NODE_VER"
else
    fail "Node.js 未安装"
fi

# Python版本
PY_VER=$(python3 --version 2>/dev/null || echo "未安装")
if [ -n "$PY_VER" ] && [ "$PY_VER" != "未安装" ]; then
    ok "Python: $PY_VER"
else
    fail "Python 未安装"
fi

# 网络连通性
if ping -c 1 -W 2 114.114.114.114 >/dev/null 2>&1; then
    ok "网络连通: 正常"
else
    warn "网络连接受限"
fi

# ==================== 2. 项目文件 ====================
section "2/12 项目文件"

for f in "core/client.js" "core/src/controllers/admin.js" "tools/sniff9988.py" "tools/mitm-qq-farm-code-capture.py" "web/src/views/Login.vue" "web/src/App.vue"; do
    if [ -f "$f" ]; then
        ok "文件存在: $f"
    else
        fail "文件缺失: $f"
    fi
done

# 关键目录权限
for d in "core/data" "logs" "web/dist"; do
    if [ -d "$d" ]; then
        ok "目录存在: $d"
    else
        warn "目录缺失: $d (可能未构建)"
    fi
done

# 前端构建
if [ -f "web/dist/index.html" ]; then
    BUILD_SIZE=$(du -sh web/dist 2>/dev/null | awk '{print $1}')
    ok "前端已构建 ($BUILD_SIZE)"
else
    fail "前端未构建 (需运行: cd web && npx vite build --mode production)"
fi

# 核心依赖
if [ -d "core/node_modules" ]; then
    ok "后端依赖已安装"
else
    fail "后端依赖未安装 (需运行: cd core && npm install)"
fi

# ==================== 3. Git/代码版本 ====================
section "3/12 代码版本"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
ok "分支: $BRANCH"

LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null)
if [ "$LOCAL" = "$REMOTE" ]; then
    ok "代码版本: 最新 ($(echo $LOCAL | cut -c1-8))"
else
    warn "代码版本: 本地=$(echo $LOCAL | cut -c1-8) vs 远程=$(echo $REMOTE | cut -c1-8)"
    FIXES="$FIXES\n  - 拉取更新: git pull origin main"
fi

# 最近的提交
echo "  最近提交:"
git log --oneline -5 2>/dev/null | while read line; do echo "    $line"; done

if git diff --quiet 2>/dev/null; then
    ok "工作区: 干净"
else
    warn "有本地未提交修改"
fi

# ==================== 4. 服务/进程 ====================
section "4/12 服务状态"

# systemd服务
for svc in "qq-farm-bot" "qq-farm-sniff"; do
    if systemctl is-active --quiet $svc 2>/dev/null; then
        ok "服务 $svc: 运行中"
    elif systemctl list-units --full -all 2>/dev/null | grep -q "$svc"; then
        fail "服务 $svc: 已停止"
        FIXES="$FIXES\n  - 启动: systemctl start $svc"
    else
        warn "服务 $svc: 未安装"
    fi
done

# 端口
for port in 3000 9988; do
    PID=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$PID" ]; then
        PROC=$(ps -p $PID -o comm= 2>/dev/null || echo "unknown")
        ok "端口 $port: 被 $PROC (PID=$PID) 占用"
        # 检查多个进程
        COUNT=$(lsof -ti:$port 2>/dev/null | wc -l)
        if [ "$COUNT" -gt 1 ]; then
            warn "端口 $port: 有 $COUNT 个进程!"
        fi
    else
        fail "端口 $port: 未监听"
    fi
done

# 进程内存占用
for port in 3000 9988; do
    PID=$(lsof -ti:$port 2>/dev/null | head -1)
    if [ -n "$PID" ]; then
        MEM_USAGE=$(ps -o rss= -p $PID 2>/dev/null | awk '{printf "%.0fMB", $1/1024}' || echo "?")
        ok "  进程 $PID (端口$port): 内存 $MEM_USAGE"
    fi
done

# ==================== 5. API端点 ====================
section "5/12 API接口"

apis=("api/ping" "api/nodes/available" "api/announcement")
for api in "${apis[@]}"; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/$api --connect-timeout 5 2>/dev/null || echo "000")
    if [ "$CODE" = "200" ]; then
        ok "GET /$api: HTTP 200"
    else
        fail "GET /$api: HTTP $CODE"
    fi
done

# 待认领接口
for method in GET POST; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X $method "http://localhost:3000/api/pending-code?code=diag_$(date +%s)" --connect-timeout 5 2>/dev/null || echo "000")
    if [ "$CODE" = "200" ]; then
        ok "$METHOD /api/pending-code: HTTP 200"
    else
        fail "$METHOD /api/pending-code: HTTP $CODE"
    fi
done

# 前端页面
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --connect-timeout 5 2>/dev/null || echo "000")
if [ "$CODE" = "200" ]; then
    TITLE=$(curl -s http://localhost:3000/ 2>/dev/null | grep -oP '<title>[^<]+</title>' || echo "")
    ok "前端页面: HTTP 200 $TITLE"
else
    fail "前端页面: HTTP $CODE"
fi

# 版本信息
VERSION=$(curl -s http://localhost:3000/api/ping 2>/dev/null | grep -oP '"version":"[^"]*"' | cut -d'"' -f4)
if [ -n "$VERSION" ]; then
    ok "面板版本: $VERSION"
fi

# ==================== 6. 认证系统 ====================
section "6/12 用户认证"

TOKEN=""
declare -A USER_ROLES
for cred in "admin:Admin@123456" "admin:admin" "Frees:Frees"; do
    USER=$(echo $cred | cut -d: -f1)
    PASSW=$(echo $cred | cut -d: -f2)
    RESP=$(curl -s -X POST http://localhost:3000/api/login \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$USER\",\"password\":\"$PASSW\"}" 2>/dev/null || echo "")
    T=$(echo "$RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    ROLE=$(echo "$RESP" | grep -o '"role":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$T" ]; then
        ok "登录: $USER / $PASSW (角色: $ROLE)"
        [ -z "$TOKEN" ] && TOKEN="$T"
        USER_ROLES["$USER"]="$ROLE"
    else
        ERR=$(echo "$RESP" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
        warn "登录失败: $USER / $PASSW ($ERR)"
    fi
done

if [ -z "$TOKEN" ]; then
    fail "所有账号均无法登录"
    TOKEN="INVALID"
fi

# ==================== 7. 业务接口 ====================
section "7/12 业务功能"

if [ "$TOKEN" != "INVALID" ]; then
    # claim接口
    CLAIM=$(curl -s -X POST http://localhost:3000/api/pending-code/claim \
        -H "x-admin-token: $TOKEN" 2>/dev/null || echo "")
    if echo "$CLAIM" | grep -q '"ok":true'; then
        ok "claim接口: 正常"
    else
        ERR=$(echo "$CLAIM" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
        fail "claim接口: $ERR"
    fi

    # 账号列表
    ACCOUNTS=$(curl -s http://localhost:3000/api/accounts \
        -H "x-admin-token: $TOKEN" 2>/dev/null || echo "")
    TOTAL=$(echo "$ACCOUNTS" | grep -o '"total":[0-9]*' | cut -d: -f2 || echo "0")
    if [ -n "$TOTAL" ]; then
        ok "账号列表: $TOTAL 个农场账号"
        if [ "$TOTAL" -gt 0 ]; then
            echo "$ACCOUNTS" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | while read name; do
                echo "      - $name"
            done
        fi
    else
        fail "账号列表获取失败"
    fi

    # 用户信息
    USER_INFO=$(curl -s http://localhost:3000/api/user/me \
        -H "x-admin-token: $TOKEN" 2>/dev/null || echo "")
    if echo "$USER_INFO" | grep -q '"ok":true'; then
        ok "用户信息接口: 正常"
    else
        warn "用户信息接口异常"
    fi

    # OAuth配置
    OAUTH=$(curl -s http://localhost:3000/api/admin/oauth \
        -H "x-admin-token: $TOKEN" 2>/dev/null || echo "")
    if echo "$OAUTH" | grep -q '"ok":true\|"error"'; then
        ok "OAuth接口: 正常"
    else
        warn "OAuth接口异常"
    fi

    # 公告接口
    NOTICE=$(curl -s http://localhost:3000/api/announcement 2>/dev/null || echo "")
    if echo "$NOTICE" | grep -q '"ok":true'; then
        ok "公告接口: 正常"
    else
        warn "公告接口异常"
    fi
fi

# ==================== 8. 抓包系统 ====================
section "8/12 抓包系统"

# sniff代码配置
echo "  sniff默认配置文件:"
grep -n "^DEFAULT_USERNAME\|^PANEL_API\|^LISTEN_HOST\|^LISTEN_PORT\|^ONESHOT" tools/sniff9988.py 2>/dev/null | while read line; do
    echo "    $line"
done

# sniff环境变量
echo "  sniff环境变量:"
ENVS=$(systemctl show qq-farm-sniff 2>/dev/null | grep "^Environment=" || echo "未设置")
echo "    $ENVS"

# sniff是否在转发
if lsof -Pi :9988 -sTCP:LISTEN 2>/dev/null >/dev/null; then
    SNIFF_PID=$(lsof -ti :9988 2>/dev/null | head -1)
    UPTIME=$(ps -o etime= -p $SNIFF_PID 2>/dev/null | tr -d ' ' || echo "?")
    ok "sniff进程已运行 $UPTIME"

    # 检查sniff日志
    SNIFF_LOG=$(journalctl -u qq-farm-sniff --no-pager -n 5 2>/dev/null | grep "forwarding to\|Listening on" | tail -1 || echo "")
    if [ -n "$SNIFF_LOG" ]; then
        ok "  sniff最近日志: $SNIFF_LOG"
    fi
fi

# 捕获日志
if [ -f "core/data/capture-system.log" ]; then
    LOG_SIZE=$(wc -l < core/data/capture-system.log 2>/dev/null || echo 0)
    ok "捕获日志: $LOG_SIZE 条记录"
    LAST=$(tail -5 core/data/capture-system.log 2>/dev/null || echo "")
    if [ -n "$LAST" ]; then
        echo "  最近记录:"
        echo "$LAST" | while read line; do echo "    $line"; done
    fi
else
    warn "捕获日志文件不存在 (首次运行后自动创建)"
fi

# 手机抓包日志
PHONE_LOG="logs/phone-code-capture.log"
if [ -f "$PHONE_LOG" ]; then
    PHONE_SIZE=$(wc -l < $PHONE_LOG 2>/dev/null || echo 0)
    GATE_HITS=$(grep -c "gate-obt" $PHONE_LOG 2>/dev/null || echo 0)
    DECRYPTED=$(grep -c "decrypted" $PHONE_LOG 2>/dev/null || echo 0)
    FORWARDED=$(grep -c "forwarded" $PHONE_LOG 2>/dev/null || echo 0)
    ok "手机抓包日志: $PHONE_SIZE 行"
    echo "    gate-obt请求: $GATE_HITS | 解密成功: $DECRYPTED | 已转发: $FORWARDED"
else
    warn "手机抓包日志不存在"
fi

# ==================== 9. sniff与接口路由 ====================
section "9/12 路由与配置"

echo "  claim路由位置:"
grep -n "pending-code/claim\|registerClaimRoute\|authRequired" core/src/controllers/admin.js 2>/dev/null | head -5 | while read line; do
    echo "    $line"
done

echo "  auth中间件行号:"
grep -n "app.use.*/api'.*req.path" core/src/controllers/admin.js 2>/dev/null || echo "    未找到"

echo "  pending-code接口行号:"
grep -n "pending-code" core/src/controllers/admin.js 2>/dev/null | head -10 | while read line; do
    echo "    $line"
done

# ==================== 10. 数据文件 ====================
section "10/12 数据文件"

for f in "core/data/users.json" "core/data/store.json" "core/data/cards.json"; do
    if [ -f "$f" ]; then
        SIZE=$(du -h "$f" 2>/dev/null | awk '{print $1}')
        OK=$(python3 -c "import json; json.load(open('$f')); print('ok')" 2>/dev/null || echo "error")
        if [ "$OK" = "ok" ]; then
            ok "数据文件: $f ($SIZE) JSON格式正确"
        else
            fail "数据文件: $f JSON格式错误!"
        fi
    else
        warn "数据文件不存在: $f"
    fi
done

# 用户数量
if [ -f "core/data/users.json" ]; then
    USER_COUNT=$(python3 -c "import json; print(len(json.load(open('core/data/users.json')).get('users',[])))" 2>/dev/null || echo "?")
    ok "注册用户: $USER_COUNT 人"
    echo "  用户列表:"
    python3 -c "
import json
for u in json.load(open('core/data/users.json')).get('users',[]):
    r = u.get('role','?')
    c = '有卡密' if u.get('card') else '无卡密'
    print(f'    - {u[\"username\"]} ({r}) {c}')
" 2>/dev/null || echo "    解析失败"
fi

# ==================== 11. 外部可访问性 ====================
section "11/12 外部访问"

# 检查是否可从外网访问
EXTERNAL_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ip.sb 2>/dev/null || echo "")
if [ -n "$EXTERNAL_IP" ]; then
    ok "外网IP: $EXTERNAL_IP"
    if [ "$EXTERNAL_IP" = "38.246.244.203" ]; then
        ok "面板URL: http://38.246.244.203:3000"
    else
        warn "外网IP ($EXTERNAL_IP) 与预期 (38.246.244.203) 不符"
    fi
else
    warn "无法获取外网IP"
fi

# 本地监听
echo "  监听地址:"
ss -tlnp 2>/dev/null | grep -E "3000|9988" | while read line; do echo "    $line"; done

# 防火墙
if command -v ufw &>/dev/null; then
    ufw status | grep -q "active" && warn "UFW防火墙已开启，可能阻挡外部连接" || ok "UFW防火墙未启用"
elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --state 2>/dev/null | grep -q "running" && warn "firewalld已开启" || ok "firewalld未启用"
else
    ok "未检测到防火墙"
fi

# ==================== 12. 性能与日志 ====================
section "12/12 日志与性能"

# 面板日志错误数
ERROR_COUNT=$(journalctl -u qq-farm-bot --no-pager -n 500 2>/dev/null | grep -c "error\|Error\|SyntaxError\|Error:" || echo 0)
WARN_COUNT=$(journalctl -u qq-farm-bot --no-pager -n 500 2>/dev/null | grep -ci "warn\|警告" || echo 0)
ok "面板日志: $ERROR_COUNT 个错误, $WARN_COUNT 个警告"

# sniff日志错误数
if systemctl is-active --quiet qq-farm-sniff 2>/dev/null; then
    SNIFF_ERROR=$(journalctl -u qq-farm-sniff --no-pager -n 200 2>/dev/null | grep -c "Error\|error\|Traceback" || echo 0)
    ok "sniff日志: $SNIFF_ERROR 个错误"
fi

# 最近错误(显示最近3个)
echo "  最近错误(如有):"
journalctl -u qq-farm-bot --no-pager -n 200 2>/dev/null | grep -iE "error|syntax|exception|fail" | tail -3 | while read line; do
    echo "    $line"
done

# uptime
if [ -n "$(lsof -ti :3000 2>/dev/null)" ]; then
    PANEL_PID=$(lsof -ti :3000 2>/dev/null | head -1)
    PANEL_UPTIME=$(ps -o etime= -p $PANEL_PID 2>/dev/null | tr -d ' ' || echo "?")
    ok "面板已运行: $PANEL_UPTIME"
fi

# ==================== 最终报告 ====================
echo ""
echo "================================================"
echo -e "  ${GREEN}诊断报告${NC}"
echo "================================================"
echo ""
echo -e "  ${GREEN}通过${NC}: $PASS    ${RED}失败${NC}: $FAIL    ${YELLOW}警告${NC}: $WARN   总计: $((PASS+FAIL+WARN))"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo -e "  ${RED}⚠️ 存在 $FAIL 个问题需要修复${NC}"
elif [ "$WARN" -gt 0 ]; then
    echo -e "  ${YELLOW}⚠️ 存在 $WARN 个建议处理${NC}"
else
    echo -e "  ${GREEN}✅ 全部正常！${NC}"
fi

if [ -n "$FIXES" ]; then
    echo ""
    echo "自动修复建议:"
    echo -e "$FIXES"
fi

echo ""
echo "快速命令:"
echo "  systemctl status qq-farm-bot      # 面板状态"
echo "  systemctl status qq-farm-sniff    # sniff状态"
echo "  journalctl -u qq-farm-bot -f     # 实时面板日志"
echo "  journalctl -u qq-farm-sniff -f   # 实时sniff日志"
echo "  bash install.sh                   # 一键重装"
echo "================================================"

# 自动清理测试数据（无论 --fix 还是单独调用）
cleanup_test_data() {
    local cleaned=0
    echo ""
    echo "--- 清理测试数据 ---"

    # 1. 清空capture-system.log中的测试记录（diag_ / check_test_ / install_test）
    if [ -f "core/data/capture-system.log" ]; then
        BEFORE=$(wc -l < core/data/capture-system.log 2>/dev/null || echo 0)
        grep -v "diag_\|check_test_\|install_test" core/data/capture-system.log > /tmp/capture-clean.log 2>/dev/null
        mv /tmp/capture-clean.log core/data/capture-system.log
        AFTER=$(wc -l < core/data/capture-system.log 2>/dev/null || echo 0)
        REMOVED=$((BEFORE - AFTER))
        if [ "$REMOVED" -gt 0 ]; then
            echo "  ✅ 已清理 $REMOVED 条测试日志记录"
            cleaned=$((cleaned+1))
        fi
    fi

    # 2. 重启面板清空内存中的pending队列（所有未认领的test code自动消失）
    #    但先把已认领的正常记录留下
    if systemctl is-active --quiet qq-farm-bot 2>/dev/null; then
        # 通过API删除已认领的测试Code账号
        TOKEN=$(curl -s -X POST http://localhost:3000/api/login \
            -H "Content-Type: application/json" \
            -d '{"username":"admin","password":"Admin@123456"}' 2>/dev/null | grep -o '"token":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")
        if [ -n "$TOKEN" ]; then
            ACCOUNTS=$(curl -s http://localhost:3000/api/accounts -H "x-admin-token: $TOKEN" 2>/dev/null || echo "")
            echo "$ACCOUNTS" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for a in d.get('data',{}).get('accounts',[]):
        name = a.get('name','')
        code = a.get('code','')
        # 标记测试账号（diag_/check_test_/install_test开头的code创建的）
        if code.startswith('diag_') or code.startswith('check_test_') or code.startswith('install_test'):
            print(f'TEST_ACCOUNT:{a[\"id\"]}:{name}')
except: pass
" 2>/dev/null | while read line; do
                if echo "$line" | grep -q "TEST_ACCOUNT:"; then
                    AID=$(echo $line | cut -d: -f2)
                    ANAME=$(echo $line | cut -d: -f3)
                    curl -s -X DELETE "http://localhost:3000/api/accounts/$AID" -H "x-admin-token: $TOKEN" >/dev/null 2>&1
                    echo "  ✅ 已删除测试账号: $ANAME (ID=$AID)"
                    cleaned=$((cleaned+1))
                fi
            done
        fi
        # 重启面板清空内存pending队列
        systemctl restart qq-farm-bot 2>/dev/null
        echo "  ✅ 已清空pending队列"
        cleaned=$((cleaned+1))
    fi

    if [ "$cleaned" -gt 0 ]; then
        echo "  ✅ 清理完成"
    else
        echo "  无需清理"
    fi
}

# 如果传了 --fix 参数
if [ "$1" = "--fix" ]; then
    echo ""
    echo "--- 自动修复 ---"
    if ! systemctl is-active --quiet qq-farm-bot 2>/dev/null; then
        echo "⏳ 启动面板..."
        systemctl start qq-farm-bot
        sleep 3
    fi
    if ! systemctl is-active --quiet qq-farm-sniff 2>/dev/null; then
        echo "⏳ 启动sniff..."
        systemctl start qq-farm-sniff
    fi
    # 清理测试数据
    cleanup_test_data
    echo ""
    echo "✅ 修复完成，重新运行 bash check.sh 确认"
fi

# 如果传了 --clean，只清理测试数据不修其他
if [ "$1" = "--clean" ]; then
    cleanup_test_data
fi
