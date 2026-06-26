const { fork } = require('node:child_process')
const path = require('node:path')
const process = require('node:process');
const { Worker } = require('node:worker_threads')
const store = require('../models/store')
const { sendPushooMessage } = require('../services/push')
const { MiniProgramLoginSession } = require('../services/qrlogin')
const { createDataProvider } = require('./data-provider')
const { createReloginReminderService } = require('./relogin-reminder')
const { createRuntimeState } = require('./runtime-state')
const { createWorkerManager } = require('./worker-manager')
const { CONFIG } = require('../config/config')

const OPERATION_KEYS = ['harvest', 'water', 'weed', 'bug', 'fertilize', 'plant', 'steal', 'helpWater', 'helpWeed', 'helpBug', 'taskClaim', 'sell', 'upgrade']

function createRuntimeEngine(options = {}) {
  const processRef = options.processRef || process
  const mainEntryPath = options.mainEntryPath || path.join(__dirname, '../../client.js')
  const workerScriptPath = options.workerScriptPath || path.join(__dirname, '../core/worker.js')
  const runtimeMode = String(options.runtimeMode || processRef.env.FARM_RUNTIME_MODE || 'thread').toLowerCase()
  const onStatusSync = typeof options.onStatusSync === 'function' ? options.onStatusSync : null
  const onLog = typeof options.onLog === 'function' ? options.onLog : null
  const onAccountLog = typeof options.onAccountLog === 'function' ? options.onAccountLog : null
  const startAdminServer = typeof options.startAdminServer === 'function' ? options.startAdminServer : null

  const workerControls = { startWorker: null, restartWorker: null }
  const runtimeState = createRuntimeState({
    store,
    operationKeys: OPERATION_KEYS,
  })
  const {
    workers,
    globalLogs: GLOBAL_LOGS,
    accountLogs: ACCOUNT_LOGS,
    runtimeEvents,
    nextConfigRevision,
    buildConfigSnapshotForAccount,
    log,
    addAccountLog,
    normalizeStatusForPanel,
    buildDefaultStatus,
    filterLogs,
  } = runtimeState

  // ====== 持久化登录 (PLM) ======
  let plm = null;
  async function ensurePlm() {
    if (plm) return plm;
    const { PersistentLoginManager } = require('../services/persistent-login');
    const { LoginStore } = require('../services/login-store');
    const { SessionValidator } = require('../services/session-validator');
    const { getDataFile } = require('../config/runtime-paths');

    if (!CONFIG.persistentLogin.enabled) return null;

    const store_ = new LoginStore({
      filePath: getDataFile('session-store.json'),
      cryptoPassword: CONFIG.persistentLogin.cryptoPassword,
      autoBackup: CONFIG.persistentLogin.autoBackup,
      maxBackups: CONFIG.persistentLogin.maxBackups,
    });

    plm = new PersistentLoginManager({
      store: store_,
      validator: new SessionValidator(),
      autoValidateOnLoad: CONFIG.persistentLogin.autoValidateOnLoad,
      enableBackup: CONFIG.persistentLogin.autoBackup,
    });

    await plm.init();
    log('系统', `持久化登录管理器已初始化`);
    return plm;
  }

  const reloginReminder = createReloginReminderService({
    store,
    miniProgramLoginSession: MiniProgramLoginSession,
    sendPushooMessage,
    log,
    addAccountLog,
    getAccounts: store.getAccounts,
    addOrUpdateAccount: store.addOrUpdateAccount,
    resolveWorkerControls: () => workerControls,
    getPlm: () => plm,                                // ← 注入 PLM
  })

  const {
    triggerOfflineReminder,
  } = reloginReminder

  const { startWorker, stopWorker, restartWorker, callWorkerApi } = createWorkerManager({
    fork,
    WorkerThread: Worker,
    runtimeMode,
    processRef,
    mainEntryPath,
    workerScriptPath,
    workers,
    globalLogs: GLOBAL_LOGS,
    log,
    addAccountLog,
    normalizeStatusForPanel,
    buildConfigSnapshotForAccount,
    triggerOfflineReminder,
    addOrUpdateAccount: store.addOrUpdateAccount,
    getRuntimeConfig: store.getRuntimeConfig,
    getPlm: () => plm,                               // ← 注入 PLM 获取函数
    onStatusSync: (accountId, status, accountName) => {
      runtimeEvents.emit('status', { accountId, status, accountName })
      if (onStatusSync) onStatusSync(accountId, status, accountName)
    },
    onWorkerLog: (entry, accountId, accountName) => {
      runtimeEvents.emit('worker_log', { entry, accountId, accountName })
      if (onLog) onLog(entry, accountId, accountName)
    },
  })
  workerControls.startWorker = startWorker
  workerControls.restartWorker = restartWorker

  const dataProvider = createDataProvider({
    workers,
    globalLogs: GLOBAL_LOGS,
    accountLogs: ACCOUNT_LOGS,
    store,
    getAccounts: store.getAccounts,
    callWorkerApi,
    buildDefaultStatus,
    normalizeStatusForPanel,
    filterLogs,
    addAccountLog,
    nextConfigRevision,
    broadcastConfigToWorkers,
    startWorker,
    stopWorker,
    restartWorker,
  })

  runtimeEvents.on('log', (entry) => {
    if (onLog) onLog(entry, entry && entry.accountId ? entry.accountId : '', entry && entry.accountName ? entry.accountName : '')
  })
  runtimeEvents.on('account_log', (entry) => {
    if (onAccountLog) onAccountLog(entry)
  })

  function broadcastConfigToWorkers(targetAccountId = '') {
    const targetId = String(targetAccountId || '').trim()
    for (const [accId, worker] of Object.entries(workers)) {
      if (targetId && String(accId) !== targetId) continue
      const snapshot = buildConfigSnapshotForAccount(accId)
      try {
        worker.process.send({ type: 'config_sync', config: snapshot })
      }
      catch {
        // ignore IPC failures for exited workers
      }
    }
  }

  async function startAllAccounts() {
    const accounts = (store.getAccounts().accounts || [])
    if (accounts.length > 0) {
      log('系统', `发现 ${accounts.length} 个账号，正在启动...`)

      // 集成 PLM: 导入现有账号到加密存储
      try {
        const plmInstance = await ensurePlm();
        if (plmInstance) {
          const imported = await plmInstance.importFromAccounts(accounts);
          if (imported > 0) log('系统', `PLM: 已导入 ${imported} 个账号到加密存储`);
        }
      } catch (err) {
        log('系统', `PLM 初始化跳过: ${err.message}`);
      }

      accounts.forEach(acc => startWorker(acc))
    }
    else {
      log('系统', '未发现账号，请访问管理面板添加账号')
    }
  }

  async function start(options = {}) {
    const shouldStartAdminServer = options.startAdminServer !== false
    const shouldAutoStartAccounts = options.autoStartAccounts !== false

    // 初始化设备指纹（持久化，重启不变）
    try {
      const { getDeviceFingerprint, setDeviceFingerprint, getDeviceId, setDeviceId } = store;
      const { generateDeviceFingerprint, generateDeviceId } = require('../utils/device-fingerprint');
      if (!getDeviceFingerprint()) {
        setDeviceFingerprint(generateDeviceFingerprint());
        log('系统', `设备指纹已初始化`);
      }
      if (!getDeviceId()) {
        setDeviceId(generateDeviceId());
        log('系统', `设备 ID 已初始化: ${getDeviceId()}`);
      }
    } catch (err) {
      log('系统', `设备指纹初始化跳过: ${err.message}`);
    }

    // 初始化 PLM
    if (CONFIG.persistentLogin.enabled) {
      try {
        await ensurePlm();
      } catch (err) {
        log('系统', `PLM 初始化失败: ${err.message}`);
      }
    }

    if (shouldStartAdminServer && startAdminServer) {
      // 将 PLM 注入 dataProvider，供 admin API 路由使用
      dataProvider.getPlm = () => plm;
      startAdminServer(dataProvider)
    }

    if (shouldAutoStartAccounts) {
      await startAllAccounts()
    }
  }

  function stopAllAccounts() {
    for (const accountId of Object.keys(workers)) {
      stopWorker(accountId)
    }
  }

  return {
    store,
    runtimeEvents,
    workers,
    dataProvider,
    start,
    startAllAccounts,
    stopAllAccounts,
    broadcastConfigToWorkers,
    startWorker,
    stopWorker,
    restartWorker,
    callWorkerApi,
    log,
    addAccountLog,
    // 持久化登录
    getPlm: () => plm,
    ensurePlm,
  }
}

module.exports = {
  createRuntimeEngine,
}
