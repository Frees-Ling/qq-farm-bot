#!/bin/bash
# QQ农场自动化 - 本地功能全面测试脚本
# 使用方法: bash test-local.sh
# 确保后端已启动: node core/client.js

BASE="http://localhost:3000"
PASS=0
FAIL=0

test_api() {
    local desc="$1"
    local method="$2"
    local url="$3"
    local data="$4"
    local header="$5"

    if [ "$method" = "GET" ]; then
        if [ -n "$header" ]; then
            RESP=$(curl -s -X GET "$url" -H "$header" 2>&1)
        else
            RESP=$(curl -s -X GET "$url" 2>&1)
        fi
    else
        if [ -n "$header" ]; then
            RESP=$(curl -s -X POST "$url" -H "Content-Type: application/json" -H "$header" -d "$data" 2>&1)
        else
            RESP=$(curl -s -X POST "$url" -H "Content-Type: application/json" -d "$data" 2>&1)
        fi
    fi

    # Check if response contains "ok\":true"
    if echo "$RESP" | grep -q '"ok":true'; then
        echo "  ✅ $desc"
        PASS=$((PASS+1))
    else
        local err=$(echo "$RESP" | grep -o '"error":"[^"]*"' | head -1)
        echo "  ❌ $desc - $err"
        FAIL=$((FAIL+1))
    fi
}

echo ""
echo "================================================"
echo "  QQ农场自动化 - 本地全面测试"
echo "================================================"
echo ""

# 1. 基础服务
echo "--- 1. 基础服务 ---"
curl -s -o /dev/null -w "  服务响应: HTTP %{http_code}\n" "$BASE/"

# 2. 公共API
echo ""
echo "--- 2. 公共API ---"
test_api "公告接口" "GET" "$BASE/api/announcement"
test_api "节点列表" "GET" "$BASE/api/nodes/available"
test_api "OAuth QR生成(QQ)" "POST" "$BASE/api/oauth/qr-create" '{"type":"qq"}'
test_api "OAuth QR生成(微信)" "POST" "$BASE/api/oauth/qr-create" '{"type":"wx"}'

# 3. 登录
echo ""
echo "--- 3. 登录系统 ---"
LOGIN_RESP=$(curl -s -X POST "$BASE/api/login" -H "Content-Type: application/json" -d '{"username":"admin","password":"admin"}')
TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$TOKEN" ]; then
    echo "  ✅ 管理员登录成功"
    PASS=$((PASS+1))
else
    echo "  ❌ 管理员登录失败: $(echo $LOGIN_RESP | grep -o '"error":"[^"]*"')"
    FAIL=$((FAIL+1))
fi

# 4. 需要Token的API
echo ""
echo "--- 4. 账号管理 ---"
if [ -n "$TOKEN" ]; then
    test_api "获取账号列表" "GET" "$BASE/api/accounts" "" "x-admin-token: $TOKEN"
    test_api "获取用户信息" "GET" "$BASE/api/user/me" "" "x-admin-token: $TOKEN"
    test_api "Auth验证" "GET" "$BASE/api/auth/validate" "" "x-admin-token: $TOKEN"

    # 测试创建账号（使用测试code）
    CODE="test_code_$(date +%s)"
    test_api "创建测试账号" "POST" "$BASE/api/accounts" \
        "{\"name\":\"测试账号\",\"code\":\"$CODE\",\"platform\":\"qq\",\"loginType\":\"manual\",\"autoStart\":false}" \
        "x-admin-token: $TOKEN"
fi

# 5. OAuth QR状态
echo ""
echo "--- 5. OAuth QR状态 ---"
test_api "QR状态轮询" "POST" "$BASE/api/oauth/qr-status" '{"code":"test_session_123"}'

# 6. 抓包代理
echo ""
echo "--- 6. 抓包代理 ---"
if [ -n "$TOKEN" ]; then
    test_api "抓包服务信息" "GET" "$BASE/api/capture-proxy/info" "" "x-admin-token: $TOKEN"
fi

# 7. 总结
echo ""
echo "================================================"
echo "  测试完成: ✅ $PASS 通过, ❌ $FAIL 失败"
echo "================================================"
echo ""
echo "登录后端: http://localhost:3000/login"
echo "用户: admin / admin"
echo ""

# 清理测试账号
if [ -n "$TOKEN" ]; then
    ACCOUNTS=$(curl -s "$BASE/api/accounts" -H "x-admin-token: $TOKEN")
    echo "$ACCOUNTS" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | while read id; do
        curl -s -X DELETE "$BASE/api/accounts/$id" -H "x-admin-token: $TOKEN" > /dev/null 2>&1
    done
fi
