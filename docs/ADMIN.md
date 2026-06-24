# QQ农场 Bot - 管理员文档

> 本文档面向服务器运维人员和管理员，涵盖部署、配置、日常运维和故障排除。

---

## 目录

1. [快速部署](#1-快速部署)
2. [日常管理](#2-日常管理)
3. [用户管理](#3-用户管理)
4. [账号管理](#4-账号管理)
5. [PC 监听配置](#5-pc-监听配置)
6. [手机抓包配置](#6-手机抓包配置)
7. [Code 捕获方式说明](#7-code-捕获方式说明)
8. [监控与日志](#8-监控与日志)
9. [备份与恢复](#9-备份与恢复)
10. [更新升级](#10-更新升级)
11. [故障排除](#11-故障排除)
12. [安全建议](#12-安全建议)

---

## 1. 快速部署

### 方式一：一键部署脚本（推荐）

在全新服务器上运行：

```bash
bash <(curl -sL https://raw.githubusercontent.com/Frees-Ling/qq-farm-bot/main/deploy/deploy.sh)
```

脚本会自动完成：
1. 安装系统依赖（curl, wget, git, python3）
2. 安装 Node.js 20 LTS
3. 安装 pnpm
4. 克隆项目代码
5. 安装项目依赖并构建前端
6. 创建配置文件和 systemd 服务
7. 启动服务

部署完成后会显示面板地址和初始管理员密码。

### 方式二：Docker 部署

```bash
# 1. 克隆代码
git clone https://github.com/Frees-Ling/qq-farm-bot.git /root/qq-farm-bot
cd /root/qq-farm-bot

# 2. 编辑 docker-compose.yml，修改 ADMIN_PASSWORD

# 3. 启动
docker compose up -d --build

# 4. 创建持久化数据目录
mkdir -p data
```

### 方式三：手动部署

```bash
# 1. 安装依赖
apt-get update && apt-get install -y curl wget git python3
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm

# 2. 克隆代码
git clone https://github.com/Frees-Ling/qq-farm-bot.git /root/qq-farm-bot
cd /root/qq-farm-bot

# 3. 安装依赖并构建
pnpm install -r
pnpm build:web

# 4. 启动
ADMIN_PORT=3000 ADMIN_PASSWORD=your_password node core/client.js
```

### 环境要求

| 项目 | 最低要求 | 推荐 |
|------|---------|------|
| 系统 | Ubuntu 20.04+ / Debian 11+ / CentOS 8+ | Ubuntu 22.04 |
| CPU | 1 核 | 2 核+ |
| 内存 | 512 MB | 2 GB+ |
| 存储 | 1 GB | 10 GB+ |
| Node.js | 18+ | 20 LTS |
| Python | 3.6+ | 3.10+ |

### 开放端口

| 端口 | 用途 | 是否必须开放 |
|------|------|------------|
| 3000 | 管理面板 (HTTP) | 是 (对外) |
| 9988 | Code 捕获服务 | 是 (机器间) |

---

## 2. 日常管理

### 服务管理

```bash
# 查看面板状态
systemctl status qq-farm-bot

# 查看捕获服务状态
systemctl status qq-farm-sniff

# 重启面板
systemctl restart qq-farm-bot

# 重启捕获服务
systemctl restart qq-farm-sniff

# 查看实时日志
journalctl -u qq-farm-bot -f

# 查看最近 50 行日志
journalctl -u qq-farm-bot -n 50 --no-pager

# 查看错误日志
journalctl -u qq-farm-bot -n 100 --no-pager | grep -i "error\|fail\|exception"
```

### 面板功能速览

| 页面 | 路径 | 功能 |
|------|------|------|
| 仪表盘 | `/` | 总览、所有账号运行状态 |
| 账号列表 | `/accounts` | 管理所有农场账号 |
| PC 监听 | `/pc-capture` | 下载配置脚本、监听扫码 |
| 添加账号 | `/add-account` | 手动填码、微信扫码、手机抓包 |
| 使用教程 | `/tutorial` | 完整配置教程 |
| 消息中心 | `/messages` | 系统公告与通知 |
| 管理设置 | `/admin` | 用户管理、卡密、系统设置（仅管理员） |

---

## 3. 用户管理

### 用户角色

| 角色 | 权限 |
|------|------|
| `admin` | 全部权限：用户管理、卡密管理、系统设置、公告发布 |
| `user` | 常规权限：登录面板、管理自己的账号、续费 |

### 管理员操作

进入面板 → 管理设置 (`/admin`)：

**创建用户：**
- 点击「添加用户」
- 输入用户名、密码
- 设置有效天数、可用配额

**重置密码：**
- 在用户列表中找到对应用户
- 点击「重置密码」
- 输入新密码
- 对应用户将被强制下线

**编辑用户：**
- 可修改：启用/禁用、有效期限、配额
- 禁用用户后，该用户所有账号将停止运行

### 卡密系统

管理员可以在「卡密管理」中生成卡密：

1. 点击「生成卡密」
2. 设置天数、配额数量
3. 系统生成卡密码 (XXXX-XXXX-XXXX 格式)
4. 将卡密分发给用户
5. 用户在「添加账号」→「输入卡密」中兑换

### 配额说明

- 配额 = 可绑定的最大账号数量
- 用户消耗配额后不会恢复（一次性消耗）
- 有效期过期后账号停止运行，但数据保留

---

## 4. 账号管理

### 添加账号

有四种方式添加农场账号：

| 方式 | 适用场景 | 说明 |
|------|---------|------|
| 手动输入 Code | 快速测试 | 直接粘贴 Code 字符串 |
| PC 监听 | 本机/远程 Windows | 注入补丁自动捕获 |
| 微信扫码 | 手机端 | 生成二维码，微信扫码 |
| 手机抓包 | Android/iOS | 通过代理捕获 |

### 账号配置

每个账号可独立配置：

- **自动种植**：选择要种植的作物
- **自动浇水**：开启/关闭
- **自动施肥**：开启/关闭
- **自动除草/除虫**：开启/关闭
- **自动收获**：成熟时自动收获
- **自动播种**：收获后自动播种
- **好友操作**：偷取/浇水/除草
- **任务间隔**：自定义任务执行间隔

### 账号状态

| 状态 | 图标 | 含义 |
|------|------|------|
| 运行中 | 🟢 | 正常挂机 |
| 已停止 | 🔴 | 手动停止或异常 |
| 离线 | ⚠️ | 网络断开，等待重连 |
| 过期 | 🔒 | 用户配额或有效期已过 |
| 禁用 | ⛔ | 管理员禁用 |

---

## 5. PC 监听配置

PC 监听是推荐的主捕获方式，支持 Windows / macOS / Linux。

### 工作原理

1. 在 PC 上运行配置脚本
2. 脚本搜索 QQ 农场缓存目录中的 `game.js`
3. 注入代码捕获补丁
4. 打开 QQ 经典农场小程序时，补丁自动拦截 WebSocket 连接
5. 提取 Code 发送到服务器

### 本机模式（面板和 QQ 在同一台电脑）

1. 在面板 → PC 监听页面点击「下载一键配置脚本」
2. 根据系统提示运行脚本：
   - **Windows**: 双击 `qq-farm-patch.bat`（右键以管理员身份运行）
   - **macOS/Linux**: `chmod +x qq-farm-patch.sh && ./qq-farm-patch.sh`
3. 脚本会自动完成：检测 Node.js → 下载补丁 → 搜索缓存的 game.js → 注入补丁
4. 点击「开始监听」

### 远程模式（面板在服务器，你在自己电脑上）

1. 在面板 → PC 监听页面查看服务器连接信息
2. 点击「下载一键配置脚本」
3. 在你的电脑上运行下载的脚本
4. 脚本下载远程服务器的补丁并注入到本地 QQ 缓存
5. 补丁会自动将捕获到的 Code 发送回服务器
6. 点击「开始监听」等待 Code 捕获

### 脚本下载说明

面板会自动检测你的操作系统（Windows/macOS/Linux）并提供对应的脚本：

| 系统 | 脚本 | 运行方式 |
|------|------|---------|
| Windows | `qq-farm-patch.bat` | 双击运行 |
| macOS | `qq-farm-patch.sh` | `chmod +x qq-farm-patch.sh && ./qq-farm-patch.sh` |
| Linux | `qq-farm-patch.sh` | `chmod +x qq-farm-patch.sh && ./qq-farm-patch.sh` |

### Windows 常见问题

**脚本闪退 / 没有数字签名错误：**
- 确保用 `.bat` 文件运行（不是 `.ps1`）
- `.bat` 文件会自动调用 PowerShell 并绕过执行策略

**找不到游戏缓存：**
- 确保先打开 PC QQ 上的 QQ 经典农场小程序（进入一次即可）
- 如果仍然找不到，尝试重新安装 QQ 经典农场

**补丁注入不成功：**
- 确保以管理员身份运行
- 检查 QQ 版本是否最新

---

## 6. 手机抓包配置

### 方式一：mitmproxy（推荐）

在服务器上部署 mitmproxy 代理：

```bash
# 安装 mitmproxy
pip3 install mitmproxy

# 启动 mitmproxy 代理（端口 8899）
mitmdump -s tools/mitm-qq-farm-code-capture.py --listen-host 0.0.0.0 --listen-port 8899
```

手机端配置：

1. 设置 WiFi 代理为服务器 IP + 端口 8899
2. 浏览器访问 `http://mitm.it` 安装证书（Android 需要）
3. 打开 QQ 或微信中的 QQ 经典农场
4. mitmproxy 自动捕获 Code 并发送到面板

### 方式二：Android 抓包

1. 安装 HttpCanary / Packet Capture 等抓包工具
2. 配置代理到服务器端口 8899
3. 打开 QQ 经典农场
4. 在抓包记录中搜索 `gate-obt.nqf.qq.com` 的 WebSocket 连接
5. 提取 URL 中的 `code` 参数

---

## 7. Code 捕获方式说明

### 什么是 Code？

Code 是 QQ 农场登录的身份凭证，通过 WebSocket 连接时作为参数传递。
格式：通常是较长的一串 Base64 编码字符串。

### 捕获方式对比

| 方式 | 成功率 | 难度 | 说明 |
|------|--------|------|------|
| PC 补丁 | ⭐⭐⭐⭐⭐ | 低 | Windows QQ 自动捕获，推荐 |
| 微信扫码 | ⭐⭐⭐⭐ | 低 | 生成二维码微信扫即可 |
| 手机抓包 | ⭐⭐⭐ | 中 | 需配置代理、安装证书 |
| 手动输入 | ⭐⭐ | 低 | Code 有时效性，需快速使用 |

### Code 的时效性

- Code 通常在生成后 1-5 分钟内有效
- 建议捕获后立即使用
- 如果提示 "Code 失效"，重新捕获即可

---

## 8. 监控与日志

### 内置日志

日志位于 `core/data/logs/` 目录：

```bash
# 查看所有日志文件
ls -la /root/qq-farm-bot/core/data/logs/

# 查看今日日志
tail -f /root/qq-farm-bot/core/data/logs/*.log
```

### 系统日志

```bash
# 面板日志
journalctl -u qq-farm-bot -f

# 捕获服务日志
journalctl -u qq-farm-sniff -f

# 导出最近24小时日志
journalctl -u qq-farm-bot --since "24 hours ago" > qq-farm-bot.log
```

### 健康检查

```bash
# 检查端口
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
lsof -Pi :3000 -sTCP:LISTEN
lsof -Pi :9988 -sTCP:LISTEN

# 检查 node 进程
ps aux | grep node | grep client.js

# 检查 python 进程
ps aux | grep sniff9988

# 内存使用
ps -o pid,%cpu,%mem,rss,cmd --sort=-%mem | head -5
```

---

## 9. 备份与恢复

### 备份数据

```bash
# 一键备份
cp -a /root/qq-farm-bot/core/data /root/qq-farm-bot-backups/data.$(date +%Y%m%d_%H%M%S)

# 定期备份（添加到 crontab）
0 3 * * * cp -a /root/qq-farm-bot/core/data /root/qq-farm-bot-backups/data.$(date +\%Y\%m\%d)
```

### 备份关键文件

| 文件 | 内容 | 重要程度 |
|------|------|---------|
| `core/data/store.json` | 全局配置和账号配置 | ❗非常重要 |
| `core/data/accounts.json` | 账号列表（不含密码） | ❗非常重要 |
| `core/data/users.json` | 用户账号和密码哈希 | ❗非常重要 |
| `core/data/cards.json` | 卡密数据 | ❗非常重要 |

### 迁移到新服务器

```bash
# 在新服务器上先部署
bash <(curl -sL https://raw.githubusercontent.com/Frees-Ling/qq-farm-bot/main/deploy/deploy.sh)

# 停止服务
systemctl stop qq-farm-bot

# 将旧服务器的 core/data/ 目录复制到新服务器
# (通过 scp 或 rsync)
scp -r user@old-server:/root/qq-farm-bot/core/data /root/qq-farm-bot/core/

# 重启服务
systemctl start qq-farm-bot
```

---

## 10. 更新升级

### 常规更新

```bash
cd /root/qq-farm-bot
git pull origin main
pnpm install -r
pnpm build:web
systemctl restart qq-farm-bot
```

### 使用 install.sh

```bash
# 如果之前是用 deploy.sh 部署的，直接运行
cd /root/qq-farm-bot && bash install.sh
```

### 更新后的验证

```bash
# 1. 检查服务状态
systemctl status qq-farm-bot --no-pager

# 2. 检查面板可访问
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/

# 3. 检查捕获服务
lsof -Pi :9988 -sTCP:LISTEN

# 4. 查看日志有无报错
journalctl -u qq-farm-bot -n 30 --no-pager | grep -i "error\|fail"
```

---

## 11. 故障排除

### 面板无法访问

```
症状：浏览器访问 http://IP:3000 超时或拒绝连接
```

1. 检查服务是否运行：
   ```bash
   systemctl status qq-farm-bot
   ```

2. 检查端口监听：
   ```bash
   lsof -Pi :3000 -sTCP:LISTEN
   ```

3. 检查防火墙：
   ```bash
   # 如果使用 ufw
   ufw status
   ufw allow 3000
   
   # 如果使用 iptables
   iptables -L -n | grep 3000
   ```

4. 查看启动日志：
   ```bash
   journalctl -u qq-farm-bot -n 50 --no-pager
   ```

### 客户端版本过低

```
症状：账号上线几秒后被踢，日志显示"客户端版本过低"
```

**原因：** QQ 农场服务器要求客户端版本必须包含日期后缀。

**修复：** 更新服务器上的客户端版本号：
1. 在管理面板 → 管理设置 → 系统配置中修改客户端版本
2. 版本格式：`X.Y.Z.W_YYYYMMDD`（如 `1.12.1.6_20260624`）
3. 保存后所有 Worker 自动使用新版本重连

**或手动修改文件：**
- `core/src/config/config.js` — `CLIENT_VERSION` 常量
- 修改后重启服务

### Code 捕获不到

```
症状：PC 监听一直等待，捕获不到 Code
```

1. 确认 PC 补丁已成功注入（查看脚本输出日志）
2. 确认嗅探服务运行中：
   ```bash
   systemctl status qq-farm-sniff
   lsof -Pi :9988 -sTCP:LISTEN
   ```
3. 确认 QQ 经典农场已打开小程序页面
4. 检查捕获服务日志：
   ```bash
   journalctl -u qq-farm-sniff -n 50 --no-pager
   ```
5. 在手机上直接打开 QQ 经典农场测试（排除 PC QQ 问题）

### WebSocket 连接失败

```
症状：账号状态显示"离线"或频繁重连
```

- 检查服务器网络是否通畅
- Code 可能已过期，重新捕获
- 确认客户端版本格式正确

### 账号被踢下线

```
症状：账号运行一段时间后突然离线
```

常见原因：
1. 客户端版本过旧 → 更新版本号
2. 同账号在其他地方登录 → 确认账号唯一性
3. 网络不稳定 → 检查服务器网络
4. Code 过期 → 重新绑定账号
5. QQ 服务器维护 → 等待恢复

### 用户密码忘记

管理员可以在面板 → 管理设置中重置任意用户的密码：
1. 找到对应用户
2. 点击「重置密码」
3. 输入新密码
4. 用户将被强制下线，需使用新密码登录

### 数据库损坏

```
症状：JSON 文件解析错误，服务启动失败
```

```bash
# 1. 停止服务
systemctl stop qq-farm-bot

# 2. 查找最近的备份
ls -la /root/qq-farm-bot-backups/

# 3. 恢复备份
cp /root/qq-farm-bot-backups/data.20260601/core/data/store.json /root/qq-farm-bot/core/data/

# 4. 启动服务
systemctl start qq-farm-bot

# 5. 检查是否正常
curl -s http://localhost:3000/api/accounts | head -c 200
```

### 磁盘空间不足

```bash
# 检查磁盘
df -h

# 清理日志
journalctl --vacuum-time=7d
rm -rf /root/qq-farm-bot/core/data/logs/*.log

# 清理 npm cache
pnpm store prune
npm cache clean --force
```

---

## 12. 安全建议

### 初始安全配置

1. **部署后立即修改管理员密码**
2. **使用强密码**（大小写字母 + 数字 + 特殊字符，12 位以上）
3. **配置防火墙**，仅开放必要端口

### 防火墙配置

```bash
# ufw (Ubuntu/Debian)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp       # SSH
ufw allow 3000/tcp     # 面板
ufw allow 9988/tcp     # Code 捕获
ufw enable

# iptables
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
iptables -A INPUT -p tcp --dport 9988 -j ACCEPT
iptables -A INPUT -j DROP
```

### 定期维护

- 每周检查系统更新：`apt update && apt upgrade`
- 每周检查项目更新：`cd ~/qq-farm-bot && git pull`
- 每月备份数据到远程存储
- 监控磁盘使用和内存占用

### 安全注意事项

- ❌ 不要暴露端口 9988 到公网（仅限需要 PC 监听的机器访问）
- ❌ 不要使用弱密码
- ❌ 不要在公共网络中使用无 HTTPS 的面板
- ✅ 建议使用 Nginx 反向代理 + HTTPS
- ✅ 定期检查用户列表，清理不活跃用户

---

> **相关文档：** [开发者文档](DEVELOPER.md) | [部署脚本](../deploy/deploy.sh)
