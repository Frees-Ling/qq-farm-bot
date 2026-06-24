#!/bin/bash
# ====================================================================
#  QQ农场 Bot - 一键部署脚本
#  适用于 Debian/Ubuntu/CentOS 全新服务器
#  用法: bash <(curl -sL https://raw.githubusercontent.com/Frees-Ling/qq-farm-bot/main/deploy/deploy.sh)
#  或: wget -qO- https://raw.githubusercontent.com/Frees-Ling/qq-farm-bot/main/deploy/deploy.sh | bash
# ====================================================================
set -e

# ---- 颜色定义 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

REPO_URL="https://github.com/Frees-Ling/qq-farm-bot.git"
INSTALL_DIR="/root/qq-farm-bot"
ADMIN_PORT="${ADMIN_PORT:-3000}"
CAPTURE_PORT="${CAPTURE_PORT:-9988}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

# ---- 辅助函数 ----
info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERR]${NC} $1"; }

detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VER=$VERSION_ID
    elif type lsb_release >/dev/null 2>&1; then
        OS=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
        OS_VER=$(lsb_release -sr)
    else
        OS=$(uname -s | tr '[:upper:]' '[:lower:]')
        OS_VER=$(uname -r)
    fi
    info "检测到系统: $OS $OS_VER"
}

check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        err "请以 root 用户运行此脚本 (sudo bash deploy.sh)"
        exit 1
    fi
}

# ---- 步骤 1: 安装系统依赖 ----
install_system_deps() {
    info "步骤 1/7: 安装系统依赖..."

    if command -v apt-get &>/dev/null; then
        # Debian / Ubuntu
        apt-get update -qq
        apt-get install -y -qq curl wget git python3 lsof net-tools 2>/dev/null
        ok "系统依赖安装完成 (apt)"
    elif command -v yum &>/dev/null; then
        # CentOS / Rocky / Alma
        yum install -y -q curl wget git python3 lsof net-tools 2>/dev/null
        ok "系统依赖安装完成 (yum)"
    elif command -v dnf &>/dev/null; then
        dnf install -y -q curl wget git python3 lsof net-tools 2>/dev/null
        ok "系统依赖安装完成 (dnf)"
    elif command -v apk &>/dev/null; then
        # Alpine
        apk add --no-cache curl wget git python3 lsof net-tools 2>/dev/null
        ok "系统依赖安装完成 (apk)"
    else
        warn "不支持的包管理器，请手动安装: curl, wget, git, python3"
    fi
}

# ---- 步骤 2: 安装 Node.js ----
install_nodejs() {
    info "步骤 2/7: 检测/安装 Node.js..."

    if command -v node &>/dev/null; then
        NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VER" -ge 18 ]; then
            ok "Node.js $(node --version) 已满足要求"
            return
        else
            warn "Node.js 版本过低 ($(node --version))，需要 v18+，即将升级..."
        fi
    else
        info "未检测到 Node.js，正在安装..."
    fi

    # 使用 NodeSource 安装 Node.js 20 LTS
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
    apt-get install -y nodejs 2>/dev/null || yum install -y nodejs 2>/dev/null || {
        err "Node.js 安装失败，请手动安装: https://nodejs.org/"
        exit 1
    }

    if command -v node &>/dev/null; then
        ok "Node.js $(node --version) 安装成功"
    else
        err "Node.js 安装后未找到"
        exit 1
    fi
}

# ---- 步骤 3: 安装 pnpm ----
install_pnpm() {
    info "步骤 3/7: 检测/安装 pnpm..."

    if command -v pnpm &>/dev/null; then
        PNPM_VER=$(pnpm --version | cut -d. -f1)
        if [ "$PNPM_VER" -ge 8 ]; then
            ok "pnpm $(pnpm --version) 已满足要求"
            return
        fi
    fi

    # 通过 npm 安装 pnpm
    npm install -g pnpm@latest --quiet 2>/dev/null
    if command -v pnpm &>/dev/null; then
        ok "pnpm $(pnpm --version) 安装成功"
    else
        err "pnpm 安装失败"
        exit 1
    fi
}

# ---- 步骤 4: 克隆/更新代码 ----
clone_repo() {
    info "步骤 4/7: 获取项目代码..."

    if [ -d "$INSTALL_DIR" ]; then
        cd "$INSTALL_DIR"
        if [ -d .git ]; then
            info "项目已存在，更新代码..."
            git fetch origin 2>/dev/null || true
            git reset --hard origin/main 2>/dev/null || true
            ok "代码已更新到最新"
        else
            warn "目录已存在但不是 git 仓库，备份后重新克隆..."
            mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)"
            git clone "$REPO_URL" "$INSTALL_DIR"
            ok "代码克隆完成"
        fi
    else
        info "正在克隆项目..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        ok "代码克隆完成"
    fi

    cd "$INSTALL_DIR"
}

# ---- 步骤 5: 安装项目依赖 ----
install_project_deps() {
    info "步骤 5/7: 安装项目依赖..."

    # 安装全部依赖 (core + web)
    pnpm install -r --no-frozen-lockfile 2>&1 | tail -3
    ok "项目依赖安装完成"

    # 构建前端
    info "正在构建前端页面..."
    pnpm build:web 2>&1 | tail -5
    ok "前端构建完成"
}

# ---- 步骤 6: 创建配置文件 ----
setup_config() {
    info "步骤 6/7: 配置服务..."

    # 如果未设置管理员密码，生成随机密码
    if [ -z "$ADMIN_PASSWORD" ]; then
        ADMIN_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 16 || echo "Admin$(date +%s)")
        warn "管理员密码未指定，已自动生成: $ADMIN_PASSWORD"
        warn "请务必在首次登录后修改密码！"
    fi

    # 检测公网 IP
    PUBLIC_IP=""
    if command -v curl &>/dev/null; then
        PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 ip.sb 2>/dev/null || echo "")
    fi

    # 创建 .env 文件
    cat > "$INSTALL_DIR/.env" << EOF
# QQ Farm Bot 环境配置
ADMIN_PORT=$ADMIN_PORT
ADMIN_PASSWORD=$ADMIN_PASSWORD
FARM_PUBLIC_IP=$PUBLIC_IP
FARM_PANEL_API=http://127.0.0.1:$ADMIN_PORT/api/pending-code
FARM_CAPTURE_PORT=$CAPTURE_PORT
FARM_CAPTURE_USERNAME=admin
NODE_ENV=production
TZ=Asia/Shanghai
EOF

    ok "配置文件已创建 (.env)"

    # 安装 systemd 服务
    info "安装 systemd 服务..."

    # 主面板服务
    cat > /etc/systemd/system/qq-farm-bot.service << 'SERVICEOF'
[Unit]
Description=QQ Farm Bot - Main Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/qq-farm-bot
EnvironmentFile=/root/qq-farm-bot/.env
ExecStart=/usr/bin/node core/client.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICEOF

    # 代码捕获服务 (sniff9988)
    cat > /etc/systemd/system/qq-farm-sniff.service << 'SERVICEOF'
[Unit]
Description=QQ Farm Code Capture Service
After=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/qq-farm-bot
ExecStart=/usr/bin/python3 tools/sniff9988.py
Restart=always
RestartSec=3
Environment=FARM_PANEL_API=http://127.0.0.1:3000/api/pending-code
Environment=FARM_CAPTURE_PORT=9988

[Install]
WantedBy=multi-user.target
SERVICEOF

    systemctl daemon-reload
    ok "systemd 服务安装完成"
}

# ---- 步骤 7: 启动服务 ----
start_services() {
    info "步骤 7/7: 启动服务..."

    # 先杀旧进程
    for port in $ADMIN_PORT $CAPTURE_PORT; do
        PID=$(lsof -ti:$port 2>/dev/null || true)
        if [ -n "$PID" ]; then
            kill -9 "$PID" 2>/dev/null || true
            info "端口 $port 旧进程已清理"
        fi
    done
    sleep 1

    # 启动主服务
    systemctl enable qq-farm-bot 2>/dev/null
    systemctl start qq-farm-bot
    info "等待面板启动..."
    sleep 4

    # 检查面板
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$ADMIN_PORT/" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        ok "面板启动成功！"
    else
        warn "面板状态码: $HTTP_CODE (首次启动可能需要更长时间)"
        warn "查看日志: journalctl -u qq-farm-bot -n 20 --no-pager"
    fi

    # 启动 sniff 服务
    systemctl enable qq-farm-sniff 2>/dev/null || true
    systemctl start qq-farm-sniff 2>/dev/null || true
    sleep 2

    SNIFF_OK=$(lsof -Pi :$CAPTURE_PORT -sTCP:LISTEN 2>/dev/null && echo "1" || echo "0")
    if [ "$SNIFF_OK" = "1" ]; then
        ok "Code捕获服务启动成功 (端口 $CAPTURE_PORT)"
    else
        warn "Code捕获服务未运行，可稍后手动启动: systemctl start qq-farm-sniff"
    fi

    # 测试 pending-code 接口
    curl -s "http://localhost:$ADMIN_PORT/api/pending-code?code=deploy_test" 2>/dev/null | grep -q "ok" && \
        ok "pending-code 接口正常" || warn "pending-code 接口异常"
}

# ---- 完成 ----
print_summary() {
    PANEL_IP="${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}"

    echo ""
    echo -e "${GREEN}====================================================================${NC}"
    echo -e "${GREEN}          QQ农场 Bot 部署完成！${NC}"
    echo -e "${GREEN}====================================================================${NC}"
    echo ""
    echo -e "  面板地址:  ${CYAN}http://${PANEL_IP}:${ADMIN_PORT}${NC}"
    echo -e "  管理员:    ${YELLOW}admin${NC}"
    echo -e "  密码:      ${YELLOW}${ADMIN_PASSWORD}${NC}"
    echo ""
    echo -e "  ${RED}⚠ 请务必在首次登录后修改密码！${NC}"
    echo ""
    echo -e "  ${BLUE}数据目录:${NC} $INSTALL_DIR/core/data/"
    echo -e "  ${BLUE}日志查看:${NC} journalctl -u qq-farm-bot -f"
    echo ""
    echo -e "  ${BLUE}常用命令:${NC}"
    echo "    systemctl status qq-farm-bot     # 面板状态"
    echo "    systemctl status qq-farm-sniff   # 捕获服务状态"
    echo "    systemctl restart qq-farm-bot     # 重启面板"
    echo "    journalctl -u qq-farm-bot -n 50  # 查看最近日志"
    echo ""
    echo -e "  ${BLUE}更新:${NC}"
    echo "    cd $INSTALL_DIR && git pull origin main && pnpm install -r && pnpm build:web && systemctl restart qq-farm-bot"
    echo ""
    echo -e "${GREEN}====================================================================${NC}"
    echo ""
}

# ---- 主流程 ----
main() {
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN}    QQ农场 Bot - 一键部署脚本${NC}"
    echo -e "${CYAN}    https://github.com/Frees-Ling/qq-farm-bot${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo ""

    check_root
    detect_distro
    echo ""
    install_system_deps
    echo ""
    install_nodejs
    echo ""
    install_pnpm
    echo ""
    clone_repo
    echo ""
    install_project_deps
    echo ""
    setup_config
    echo ""
    start_services
    echo ""
    print_summary
}

main "$@"
