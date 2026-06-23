<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'

const router = useRouter()
const activePlatform = ref<'android' | 'ios'>('android')
const step = ref(0)

const windowsIp = ref('')
async function getLocalIp() {
  try {
    const res = await fetch('/api/ping')
    // Use window.location.hostname as fallback
    windowsIp.value = window.location.hostname
  } catch {
    windowsIp.value = window.location.hostname
  }
}
getLocalIp()

const proxyPort = '8899'

const androidSteps = [
  { title: '确保在同一网络', desc: '手机和电脑连接同一个WiFi网络' },
  { title: '设置WiFi代理', desc: `设置 → WLAN → 长按当前WiFi → 修改网络 → 显示高级选项 → 代理设为手动\n服务器: ${windowsIp.value || '你的电脑IP'}\n端口: ${proxyPort}` },
  { title: '下载安装CA证书', desc: '手机浏览器打开 http://mitm.it → 下载Android证书 → 设置 → 安全 → 安装证书' },
  { title: '打开QQ经典农场', desc: '打开手机QQ → 进入QQ经典农场小程序 → 等待几秒自动捕获Code' },
  { title: '自动创建账号', desc: '捕获成功后页面会自动刷新，账号自动创建完成 ✅' },
]

const iosSteps = [
  { title: '确保在同一网络', desc: '手机和电脑连接同一个WiFi网络' },
  { title: '设置WiFi代理', desc: `设置 → 无线局域网 → 点击当前WiFi右侧(i) → HTTP代理 → 配置代理 → 手动\n服务器: ${windowsIp.value || '你的电脑IP'}\n端口: ${proxyPort}` },
  { title: '下载安装CA证书', desc: 'Safari打开 http://mitm.it → 下载iOS证书 → 设置 → 已下载的描述文件 → 安装' },
  { title: '信任证书', desc: '设置 → 通用 → 关于本机 → 证书信任设置 → 开启mitmproxy开关' },
  { title: '打开QQ经典农场', desc: '打开手机QQ → 进入QQ经典农场小程序 → 等待几秒自动捕获Code' },
  { title: '自动创建账号', desc: '捕获成功后页面会自动刷新，账号自动创建完成 ✅' },
]

function getSteps() {
  return activePlatform.value === 'android' ? androidSteps : iosSteps
}

function nextStep() {
  if (step.value < getSteps().length - 1) step.value++
}

function prevStep() {
  if (step.value > 0) step.value--
}

function resetSteps() {
  step.value = 0
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-foreground">📱 手机代理抓包教程</h1>
        <p class="mt-1 text-sm text-foreground-muted">通过手机代理自动捕获QQ农场Code，无需任何额外工具</p>
      </div>
      <div class="flex gap-2">
        <BaseButton variant="outline" @click="router.push('/accounts')">返回账号列表</BaseButton>
      </div>
    </div>

    <!-- 原理说明 -->
    <div class="card p-5">
      <h2 class="text-lg font-semibold text-foreground mb-2">⚡ 工作原理</h2>
      <p class="text-sm text-foreground-muted leading-relaxed">
        你的电脑上已经运行了抓包代理（mitmdump），它会监听手机上QQ农场的网络通信。
        当你打开QQ经典农场小程序时，它会创建一个WebSocket连接到腾讯服务器，
        连接URL中包含了登录凭证（code）。代理会自动捕获这个code并提交到面板，
        账号自动创建完成。
      </p>
      <div class="mt-3 flex items-center gap-2 text-sm">
        <span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
        <span class="text-foreground-muted">抓包代理状态：</span>
        <span class="text-green-600 font-medium">运行中 (端口 {{ proxyPort }})</span>
      </div>
      <div class="mt-1 flex items-center gap-2 text-sm">
        <span class="inline-block h-2 w-2 rounded-full bg-blue-500"></span>
        <span class="text-foreground-muted">电脑IP地址：</span>
        <code class="text-sm font-mono bg-accent-m px-2 py-0.5 rounded">{{ windowsIp || '检测中...' }}</code>
      </div>
    </div>

    <!-- 平台切换 -->
    <div class="flex gap-3">
      <button
        class="flex-1 py-3 px-4 rounded-lg border text-center font-medium transition-all"
        :class="activePlatform === 'android' ? 'border-accent bg-accent-m text-accent' : 'border-border-subtle text-foreground-muted hover:border-border'"
        @click="activePlatform = 'android'; step = 0"
      >
        🤖 Android 设置
      </button>
      <button
        class="flex-1 py-3 px-4 rounded-lg border text-center font-medium transition-all"
        :class="activePlatform === 'ios' ? 'border-accent bg-accent-m text-accent' : 'border-border-subtle text-foreground-muted hover:border-border'"
        @click="activePlatform = 'ios'; step = 0"
      >
        🍎 iOS 设置
      </button>
    </div>

    <!-- 步骤进度 -->
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-foreground">
          {{ activePlatform === 'android' ? 'Android' : 'iOS' }} 设置步骤
        </h2>
        <span class="text-sm text-foreground-muted">{{ step + 1 }} / {{ getSteps().length }}</span>
      </div>

      <!-- 进度条 -->
      <div class="w-full bg-border-subtle rounded-full h-2 mb-6">
        <div
          class="bg-accent h-2 rounded-full transition-all duration-300"
          :style="{ width: ((step + 1) / getSteps().length * 100) + '%' }"
        />
      </div>

      <!-- 当前步骤 -->
      <div class="space-y-4">
        <div
          v-for="(s, i) in getSteps()"
          :key="i"
          class="rounded-lg border p-4 transition-all duration-200"
          :class="i === step ? 'border-accent bg-accent-m/30' : i < step ? 'border-green-500/30 bg-green-50/30' : 'border-border-subtle opacity-50'"
        >
          <div class="flex items-start gap-3">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
              :class="i < step ? 'bg-green-500 text-white' : i === step ? 'bg-accent text-white' : 'bg-border-subtle text-foreground-muted'"
            >
              {{ i < step ? '✓' : i + 1 }}
            </div>
            <div class="min-w-0">
              <h3 class="font-medium text-foreground">{{ s.title }}</h3>
              <p class="mt-1 text-sm text-foreground-muted whitespace-pre-line">{{ s.desc }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex justify-between mt-6">
        <BaseButton variant="outline" :disabled="step === 0" @click="prevStep">
          上一步
        </BaseButton>
        <BaseButton
          v-if="step < getSteps().length - 1"
          variant="primary"
          @click="nextStep"
        >
          下一步
        </BaseButton>
        <BaseButton
          v-else
          variant="primary"
          @click="router.push('/accounts')"
        >
          完成，前往账号列表
        </BaseButton>
      </div>
    </div>

    <!-- 常见问题 -->
    <div class="card p-5">
      <h2 class="text-lg font-semibold text-foreground mb-3">❓ 常见问题</h2>
      <div class="space-y-3">
        <details class="group">
          <summary class="cursor-pointer text-sm font-medium text-foreground hover:text-accent">手机连不上代理怎么办？</summary>
          <p class="mt-2 text-sm text-foreground-muted">确保手机和电脑连接的是同一个WiFi网络。检查电脑防火墙是否允许8899端口的入站连接。也可以尝试关闭电脑的防火墙后再试。</p>
        </details>
        <details class="group">
          <summary class="cursor-pointer text-sm font-medium text-foreground hover:text-accent">安装证书后还是不行？</summary>
          <p class="mt-2 text-sm text-foreground-muted">Android 7.0+ 默认不信任用户证书，需要使用Magisk模块或adb命令将证书移入系统证书目录。也可以选择使用虚拟机内安装旧版Android。</p>
        </details>
        <details class="group">
          <summary class="cursor-pointer text-sm font-medium text-foreground hover:text-accent">捕获成功后怎么确认？</summary>
          <p class="mt-2 text-sm text-foreground-muted">回到账号列表页，如果看到新创建的账号就是成功了。或者看本地的终端日志，会显示"phone proxy capture loaded"和"forwarded"等关键字。</p>
        </details>
        <details class="group">
          <summary class="cursor-pointer text-sm font-medium text-foreground hover:text-accent">用完后怎么恢复手机网络？</summary>
          <p class="mt-2 text-sm text-foreground-muted">进入手机WiFi设置 → 关闭代理（设为"无"或"关闭"），即可恢复正常上网。</p>
        </details>
      </div>
    </div>
  </div>
</template>
