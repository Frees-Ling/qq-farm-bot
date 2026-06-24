<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'

const router = useRouter()
const activeSection = ref<string>('addAccount')

const sections = [
  { key: 'addAccount', label: '📱 添加账户', icon: '' },
  { key: 'pcCapture', label: '💻 PC监听配置', icon: '' },
  { key: 'manage', label: '⚙️ 账户管理', icon: '' },
  { key: 'faq', label: '❓ 常见问题', icon: '' },
]
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">📖 使用教程</h1>
        <p class="mt-1 text-sm text-foreground-muted">了解如何添加账户、配置监听以及管理农场机器人</p>
      </div>
    </div>

    <!-- 导航标签 -->
    <div class="flex flex-wrap gap-1 border-b border-border-subtle pb-2">
      <button
        v-for="s in sections"
        :key="s.key"
        class="rounded-t-lg px-3 py-1.5 text-sm font-medium transition-colors"
        :class="activeSection === s.key
          ? 'bg-elevated text-foreground border-b-2 border-accent'
          : 'text-foreground-muted hover:text-foreground hover:bg-elevated/50'"
        @click="activeSection = s.key"
      >
        {{ s.label }}
      </button>
    </div>

    <!-- ===== 添加账户 ===== -->
    <div v-if="activeSection === 'addAccount'" class="space-y-4">
      <div class="card p-5">
        <h2 class="text-lg font-semibold text-foreground mb-3">📱 添加账户方式</h2>
        <p class="text-sm text-foreground-muted mb-4">本面板支持以下 5 种方式添加农场账户，选择最适合你的方式。</p>

        <div class="space-y-4">
          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">1️⃣ 手动填码</h3>
            <p class="text-sm text-foreground-muted">如果你已经通过其他方式获取了 Code，可以直接在添加账户弹窗的"手动填码"标签页中输入。</p>
            <ul class="mt-2 list-disc pl-5 text-sm text-foreground-muted space-y-1">
              <li>在侧边栏点击"添加账户"→ "手动填码"</li>
              <li>填入 Code、账户名称，选择平台（QQ/微信）</li>
              <li>点击"添加"即可</li>
            </ul>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">2️⃣ PC QQ 监听（推荐）</h3>
            <p class="text-sm text-foreground-muted">在电脑上安装补丁后，打开QQ经典农场即可自动捕获Code。</p>
            <ul class="mt-2 list-disc pl-5 text-sm text-foreground-muted space-y-1">
              <li>推荐方式，无需手机操作</li>
              <li>支持 Windows / macOS / Linux</li>
              <li>点击下方按钮查看详细配置步骤</li>
            </ul>
            <BaseButton variant="primary" size="sm" class="mt-3" @click="activeSection = 'pcCapture'">查看PC配置教程 →</BaseButton>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">3️⃣ 手机代理抓包</h3>
            <p class="text-sm text-foreground-muted">通过设置手机 HTTP 代理，拦截QQ农场小程序的 WebSocket 连接。</p>
            <ul class="mt-2 list-disc pl-5 text-sm text-foreground-muted space-y-1">
              <li>需要手机和服务器在同一网络（或服务器有公网IP）</li>
              <li>需要安装 mitmproxy CA 证书（Android/iOS）</li>
              <li>详细步骤请查看抓包教程页面</li>
            </ul>
            <BaseButton variant="outline" size="sm" class="mt-3" @click="router.push('/proxy-tutorial')">查看抓包教程 →</BaseButton>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">4️⃣ QQ 扫码登录</h3>
            <p class="text-sm text-foreground-muted">使用手机QQ扫描二维码登录。</p>
            <ul class="mt-2 list-disc pl-5 text-sm text-foreground-muted space-y-1">
              <li>点击"添加账户"→ "QQ扫码"</li>
              <li>用手机QQ扫描二维码</li>
              <li>扫码成功后需要在PC QQ上打开QQ经典农场完成Code获取</li>
            </ul>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">5️⃣ 微信扫码登录</h3>
            <p class="text-sm text-foreground-muted">使用微信扫描二维码自动登录。</p>
            <ul class="mt-2 list-disc pl-5 text-sm text-foreground-muted space-y-1">
              <li>点击"添加账户"→ "微信扫码"</li>
              <li>用手机微信扫描二维码</li>
              <li>确认登录后自动创建账户</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== PC监听配置 ===== -->
    <div v-if="activeSection === 'pcCapture'" class="space-y-4">
      <div class="card p-5">
        <h2 class="text-lg font-semibold text-foreground mb-3">💻 PC监听配置</h2>
        <p class="text-sm text-foreground-muted mb-4">补丁脚本会自动注入到 QQ 经典农场的 game.js 中，拦截 WebSocket 连接并提取 Code。</p>

        <div class="space-y-6">
          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">🖥️ 本地模式（在本机使用）</h3>
            <p class="text-sm text-foreground-muted">如果你的浏览器访问的是 localhost，直接点击"PC监听"→"开始监听"即可。</p>
            <ol class="mt-2 list-decimal pl-5 text-sm text-foreground-muted space-y-1">
              <li>在侧边栏导航到 "PC监听" 页面</li>
              <li>点击"开始监听"</li>
              <li>打开电脑上的 QQ 经典农场小程序</li>
              <li>补丁自动捕获 Code，页面自动检测到新账号</li>
            </ol>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">🌐 远程模式（VPS/服务器）</h3>
            <p class="text-sm text-foreground-muted">如果你使用的是远程服务器，需要通过一键脚本在本地电脑上安装补丁。</p>
            <ol class="mt-2 list-decimal pl-5 text-sm text-foreground-muted space-y-1">
              <li>进入 "PC监听" 页面</li>
              <li>点击"下载一键配置脚本"</li>
              <li>
                <strong>Windows:</strong> 右键 → 「用 PowerShell 运行」
              </li>
              <li>
                <strong>macOS/Linux:</strong> 终端执行 <code class="rounded bg-gray-100 px-1 dark:bg-gray-700">chmod +x qq-farm-patch.sh && ./qq-farm-patch.sh</code>
              </li>
              <li>脚本会自动检测/安装 Node.js，下载补丁并注入</li>
              <li>注入成功后，打开 QQ 经典农场</li>
              <li>回到面板页面点击"开始监听"</li>
            </ol>
            <div class="mt-3 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
              ⚠️ 确保服务器防火墙已放行 9988 端口：<code class="rounded bg-gray-100 px-1 dark:bg-gray-700">ufw allow 9988</code>
            </div>
          </div>
        </div>

        <div class="mt-4">
          <BaseButton variant="primary" size="sm" @click="router.push('/pc-capture')">前往 PC监听 页面 →</BaseButton>
        </div>
      </div>
    </div>

    <!-- ===== 账户管理 ===== -->
    <div v-if="activeSection === 'manage'" class="space-y-4">
      <div class="card p-5">
        <h2 class="text-lg font-semibold text-foreground mb-3">⚙️ 账户管理</h2>

        <div class="space-y-4">
          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">添加账户</h3>
            <p class="text-sm text-foreground-muted">点击侧边栏的「➕」按钮或在「账号」页面点击"添加账户"，选择适合的方式添加。</p>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">启动 / 停止账户</h3>
            <p class="text-sm text-foreground-muted">在「账号」页面，点击账户卡片上的开关按钮即可启动或停止该账户的自动挂机。</p>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">自动化设置</h3>
            <p class="text-sm text-foreground-muted">在「设置」页面，可以为每个账户配置自动化行为：</p>
            <ul class="mt-2 list-disc pl-5 text-sm text-foreground-muted space-y-1">
              <li><strong>自动种地:</strong> 按策略自动种植作物</li>
              <li><strong>自动收获:</strong> 成熟后自动收获并出售</li>
              <li><strong>自动偷取:</strong> 好友成熟时自动偷取</li>
              <li><strong>自动除草/浇水:</strong> 自动帮助好友</li>
              <li><strong>蹲守偷菜:</strong> 在成熟前数秒等待偷取</li>
            </ul>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">好友管理</h3>
            <p class="text-sm text-foreground-muted">在「好友」页面可以查看和管理好友列表，支持通过 GID 或 Hex 添加好友。</p>
          </div>

          <div class="rounded-lg border border-border-subtle p-4">
            <h3 class="font-medium text-foreground mb-2">配额与续费</h3>
            <p class="text-sm text-foreground-muted">每个账户都有可添加的配额限制。配额用完需要续费或联系管理员增加配额。</p>
            <ul class="mt-2 list-disc pl-5 text-sm text-foreground-muted space-y-1">
              <li>在侧边栏点击「续费」按钮</li>
              <li>输入卡密即可续费天数或增加配额</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 常见问题 ===== -->
    <div v-if="activeSection === 'faq'" class="space-y-4">
      <div class="card p-5">
        <h2 class="text-lg font-semibold text-foreground mb-3">❓ 常见问题</h2>

        <div class="space-y-3">
          <details class="rounded-lg border border-border-subtle">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-elevated/50">为什么我无法添加更多账户？</summary>
            <div class="px-4 pb-3 text-sm text-foreground-muted">
              每个用户有配额限制（默认可添加 3 个账号）。如果已达上限，需要联系管理员增加配额，或使用配额卡密续费。
            </div>
          </details>

          <details class="rounded-lg border border-border-subtle">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-elevated/50">账户显示过期怎么办？</summary>
            <div class="px-4 pb-3 text-sm text-foreground-muted">
              在侧边栏点击「续费」，输入时间卡密即可延期。过期后账户将自动停止运行，续费后重新启动即可。
            </div>
          </details>

          <details class="rounded-lg border border-border-subtle">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-elevated/50">手机代理抓不到 Code</summary>
            <div class="px-4 pb-3 text-sm text-foreground-muted space-y-1">
              <p>请检查以下几点：</p>
              <ul class="list-disc pl-5">
                <li>手机和服务器是否在同一网络（或服务器是否有公网IP）</li>
                <li>代理地址和端口是否正确（默认端口 8899）</li>
                <li>是否正确安装了 mitmproxy 的 CA 证书</li>
                <li>防火墙是否放行了 8899 端口</li>
              </ul>
            </div>
          </details>

          <details class="rounded-lg border border-border-subtle">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-elevated/50">PC 补丁不工作</summary>
            <div class="px-4 pb-3 text-sm text-foreground-muted space-y-1">
              <p>可能的原因：</p>
              <ul class="list-disc pl-5">
                <li>Node.js 未安装或版本过低</li>
                <li>一键脚本没有以管理员权限运行</li>
                <li>QQ 经典农场的 game.js 缓存文件路径不匹配</li>
                <li>第一次运行脚本时 QQ 农场还没有缓存，需要先打开一次再重新运行</li>
                <li>服务器 9988 端口被防火墙阻挡</li>
              </ul>
            </div>
          </details>

          <details class="rounded-lg border border-border-subtle">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-elevated/50">连接超时 / 无法连接服务器</summary>
            <div class="px-4 pb-3 text-sm text-foreground-muted space-y-1">
              <p>请检查：</p>
              <ul class="list-disc pl-5">
                <li>服务器是否正常运行（systemctl status qq-farm-bot）</li>
                <li>防火墙是否放行了 3000 端口</li>
                <li>网络是否稳定</li>
              </ul>
            </div>
          </details>

          <details class="rounded-lg border border-border-subtle">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-elevated/50">为什么账户被踢下线？</summary>
            <div class="px-4 pb-3 text-sm text-foreground-muted space-y-1">
              <p>可能的原因：</p>
              <ul class="list-disc pl-5">
                <li>QQ 农场服务端更新了协议版本（已自动处理版本过低问题）</li>
                <li>登录 Code 已过期，需要重新抓取</li>
                <li>账户在别处登录被踢</li>
              </ul>
            </div>
          </details>

          <details class="rounded-lg border border-border-subtle">
            <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-foreground hover:bg-elevated/50">如何修改密码？</summary>
            <div class="px-4 pb-3 text-sm text-foreground-muted">
              在设置页面可以修改当前登录账户的密码。如果忘记密码，请联系管理员重置。
            </div>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>
