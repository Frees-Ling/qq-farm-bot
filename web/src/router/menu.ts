export interface MenuItem {
  path: string
  name: string
  label: string
  icon: string
  component: () => Promise<any>
  adminOnly?: boolean
  hidden?: boolean   // 不在侧边栏显示但保留路由
}

export const menuRoutes: MenuItem[] = [
  {
    path: '',
    name: 'dashboard',
    label: '概览',
    icon: 'i-carbon-chart-pie',
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: 'personal',
    name: 'personal',
    label: '个人',
    icon: 'i-carbon-user',
    component: () => import('@/views/Personal.vue'),
  },
  {
    path: 'friends',
    name: 'friends',
    label: '好友',
    icon: 'i-carbon-user-multiple',
    component: () => import('@/views/Friends.vue'),
  },
  {
    path: 'analytics',
    name: 'analytics',
    label: '分析',
    icon: 'i-carbon-analytics',
    component: () => import('@/views/Analytics.vue'),
  },
  {
    path: 'accounts',
    name: 'accounts',
    label: '账号',
    icon: 'i-carbon-user-settings',
    component: () => import('@/views/Accounts.vue'),
  },
  {
    path: 'settings',
    name: 'Settings',
    label: '设置',
    icon: 'i-carbon-settings',
    component: () => import('@/views/Settings.vue'),
  },
  {
    path: 'wechat',
    name: 'wechatAccounts',
    label: '微信扫码',
    icon: 'i-carbon-qr-code',
    component: () => import('@/views/WechatAccounts.vue'),
    hidden: true,
  },
  {
    path: 'capture',
    name: 'captureAdd',
    label: '抓包添加',
    icon: 'i-carbon-network-4',
    component: () => import('@/views/CaptureAddAccount.vue'),
    hidden: true,
  },
  {
    path: 'proxy-tutorial',
    name: 'proxyTutorial',
    label: '抓包教程',
    icon: 'i-carbon-education',
    component: () => import('@/views/ProxyTutorial.vue'),
    hidden: true,
  },
  {
    path: 'pc-capture',
    name: 'pcCapture',
    label: 'PC监听',
    icon: 'i-carbon-audio-spectrum',
    component: () => import('@/views/PcCapture.vue'),
    hidden: true,
  },
  {
    path: 'logs',
    name: 'systemLogs',
    label: '系统日志',
    icon: 'i-carbon-document',
    component: () => import('@/views/SystemLogs.vue'),
    adminOnly: true,
  },
  {
    path: 'admin',
    name: 'admin',
    label: '后台',
    icon: 'i-carbon-settings-adjust',
    component: () => import('@/views/AdminSettings.vue'),
    adminOnly: true,
  },
]
