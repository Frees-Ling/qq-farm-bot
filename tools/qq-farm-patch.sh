#!/bin/bash
#
# QQ农场 - PC一键全栈配置工具 (macOS/Linux版)
# 自动检测Node.js环境（如缺失则自动下载安装），下载补丁脚本并注入到QQ经典农场
#

SERVER_IP="{{SERVER_IP}}"
SNIFF_PORT="{{SNIFF_PORT}}"
PANEL_PORT="{{PANEL_PORT}}"
WS_URL="ws://${SERVER_IP}:${SNIFF_PORT}/admin"
PANEL_URL="http://${SERVER_IP}:${PANEL_PORT}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERR]${NC} $1"; }

banner() {
    clear 2>/dev/null || true
    echo "============================================"
    echo "     QQ农场 - PC一键全栈配置工具"
    echo "============================================"
    echo " 服务器: ${SERVER_IP}:${SNIFF_PORT}"
    echo " 面板: ${PANEL_URL}"
    echo "============================================"
    echo ""
}

# ========== 步骤1：检测/安装 Node.js ==========
ensure_node() {
    info "步骤 1/4: 检测 Node.js 环境..."

    local node_path=""
    node_path=$(command -v node 2>/dev/null || true)

    if [ -n "$node_path" ]; then
        local ver=$("$node_path" --version 2>/dev/null)
        ok "Node.js 已安装: $ver ($node_path)"
        echo "$node_path"
        return 0
    fi

    # 检查常见路径
    for p in "/usr/local/bin/node" "/opt/homebrew/bin/node" "$HOME/.nvm/versions/node/*/bin/node" "$HOME/.local/bin/node"; do
        for f in $p; do
            if [ -f "$f" ]; then
                local ver=$("$f" --version 2>/dev/null)
                ok "Node.js 已安装: $ver ($f)"
                echo "$f"
                return 0
            fi
        done
    done

    warn "未检测到 Node.js，正在自动下载安装..."

    local install_dir="$HOME/.qq-farm-nodejs"
    local node_exe="$install_dir/bin/node"

    if [ -f "$node_exe" ]; then
        local ver=$("$node_exe" --version 2>/dev/null)
        ok "Node.js 已存在: $ver (缓存)"
        echo "$node_exe"
        return 0
    fi

    # 检测架构
    local arch=""
    local os_name=""
    case "$(uname -s)" in
        Darwin) os_name="darwin"; arch=$(uname -m); [ "$arch" = "arm64" ] && arch="arm64" || arch="x64" ;;
        Linux)  os_name="linux"; arch=$(uname -m); [ "$arch" = "x86_64" ] && arch="x64" || arch="arm64" ;;
        *) err "不支持的操作系统: $(uname -s)"; return 1 ;;
    esac

    local node_version="22.14.0"
    local url="https://nodejs.org/dist/v${node_version}/node-v${node_version}-${os_name}-${arch}.tar.gz"
    local tmp_dir="/tmp/node-install-$$"

    info "   下载 Node.js ${node_version} (${os_name}-${arch})..."
    info "   ${url}"

    mkdir -p "$tmp_dir"
    if command -v curl &>/dev/null; then
        curl -fsSL "$url" -o "$tmp_dir/node.tar.gz" 2>/dev/null || {
            err "下载失败"; return 1
        }
    elif command -v wget &>/dev/null; then
        wget -q "$url" -O "$tmp_dir/node.tar.gz" 2>/dev/null || {
            err "下载失败"; return 1
        }
    else
        err "未找到 curl 或 wget，请先安装"
        return 1
    fi

    info "   下载完成，正在解压..."
    mkdir -p "$install_dir"
    tar -xzf "$tmp_dir/node.tar.gz" -C "$tmp_dir" 2>/dev/null
    mv "$tmp_dir/node-v${node_version}-${os_name}-${arch}/"* "$install_dir/" 2>/dev/null
    rm -rf "$tmp_dir"

    if [ -f "$node_exe" ]; then
        local ver=$("$node_exe" --version 2>/dev/null)
        ok "Node.js 安装成功: $ver"
        echo "$node_exe"
        return 0
    else
        err "安装后未找到 node"
        return 1
    fi
}

# ========== 步骤2：下载补丁脚本 ==========
download_patch() {
    local node_path=$1
    info "步骤 2/4: 下载补丁脚本..."

    local script_file="$(dirname "$0")/patch-qq-farm-code-capture.js"
    local url="${PANEL_URL}/api/pc-capture/download-patch"

    if [ -f "$script_file" ]; then
        ok "补丁脚本已存在，跳过下载"
        echo "$script_file"
        return 0
    fi

    if command -v curl &>/dev/null; then
        curl -fsSL "$url" -o "$script_file" 2>/dev/null || {
            err "下载失败，请检查网络连接"
            return 1
        }
    elif command -v wget &>/dev/null; then
        wget -q "$url" -O "$script_file" 2>/dev/null || {
            err "下载失败，请检查网络连接"
            return 1
        }
    else
        err "未找到 curl 或 wget"
        return 1
    fi

    if [ -f "$script_file" ]; then
        ok "补丁脚本下载成功"
        echo "$script_file"
    else
        err "下载失败"
        return 1
    fi
}

# ========== 步骤3：搜索QQ缓存目录 ==========
find_game_js() {
    info "步骤 3/4: 搜索QQ经典农场缓存..."

    local search_roots=(
        "$HOME/.config/QQEX/miniapp"
        "$HOME/.local/share/QQEX/miniapp"
        "/snap/qq/current/.config/QQ/miniapp"
    )

    local found=()
    for root in "${search_roots[@]}"; do
        if [ -d "$root" ]; then
            while IFS= read -r -d '' f; do
                found+=("$f")
            done < <(find "$root" -name "game.js" -path "*1112386029_*" -print0 2>/dev/null)
        fi
    done

    if [ ${#found[@]} -eq 0 ]; then
        warn "未找到QQ经典农场的游戏缓存"
        warn "请先打开PC QQ上的QQ经典农场，然后关闭QQ重新运行本脚本"
        return 1
    fi

    # 按修改时间排序取最新
    local latest=""
    for f in "${found[@]}"; do
        if [ -z "$latest" ] || [ "$(stat -f "%m" "$f" 2>/dev/null || stat -c "%Y" "$f" 2>/dev/null)" -gt "$(stat -f "%m" "$latest" 2>/dev/null || stat -c "%Y" "$latest" 2>/dev/null)" ]; then
            latest="$f"
        fi
    done

    ok "找到游戏缓存: $latest"
    echo "$latest"
}

# ========== 步骤4：注入补丁 ==========
install_patch() {
    local node_path=$1
    local game_js=$2
    local script_file="$(dirname "$0")/patch-qq-farm-code-capture.js"

    info "步骤 4/4: 注入捕获补丁..."

    if "$node_path" "$script_file" --target "$game_js" --capture-ws "$WS_URL"; then
        ok "补丁注入成功!"
        return 0
    else
        warn "补丁注入可能未完全成功"
        return 1
    fi
}

# ========== 主流程 ==========
main() {
    banner

    local node_path
    node_path=$(ensure_node) || { err "Node.js 安装失败"; exit 1; }

    local script_file
    script_file=$(download_patch "$node_path") || exit 1

    local game_js
    game_js=$(find_game_js) || exit 1

    if install_patch "$node_path" "$game_js"; then
        echo ""
        echo -e "${GREEN}============================================${NC}"
        echo -e "${GREEN}  ✅ 配置完成！${NC}"
        echo -e "${CYAN}  请打开 PC QQ 上的 QQ经典农场${NC}"
        echo -e "${CYAN}  Code 将自动被捕获并发送到服务器${NC}"
        echo -e "${CYAN}  面板: ${PANEL_URL}${NC}"
        echo -e "${GREEN}============================================${NC}"
    else
        echo ""
        echo -e "${YELLOW}  ⚠️ 配置未完全完成${NC}"
        echo -e "${YELLOW}  手动运行: ${node_path} ${script_file} --target '${game_js}' --capture-ws '${WS_URL}'${NC}"
    fi
}

main
