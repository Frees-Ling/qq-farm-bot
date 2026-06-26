# 自动恢复工作流

> 设计: 程序启动时的自动恢复流程

---

## 1. 自动恢复总流程

```mermaid
graph TB
    Start["程序启动"] --> LoadSessions["加载所有已保存的会话"]
    LoadSessions --> HasSession{"有保存的会话?"}

    HasSession -->|"是"| LoadNext["加载下一个会话"]
    HasSession -->|"否"| Noop["等待用户手动添加账号"]

    LoadNext --> Validate["验证会话有效性<br/>fetchProfileByCode()"]

    Validate --> Valid{"验证通过?"}

    Valid -->|"是"| StartWorker["使用该 code 启动 Worker"]
    StartWorker --> HasMore{"还有更多会话?"}

    HasMore -->|"是"| LoadNext
    HasMore -->|"否"| AllDone["所有账号启动完成"]

    Valid -->|"否"| CheckRefresh{"可自动刷新?"}

    CheckRefresh -->|"是"| Refresh["尝试刷新"]
    Refresh --> RefreshOK{"刷新成功?"}
    RefreshOK -->|"是"| StartWorker
    RefreshOK -->|"否"| Notify["标记为需要手动处理"]

    CheckRefresh -->|"否"| Notify

    Notify --> HasMore
    Noop --> AllDone
```

---

## 2. 启动恢复详细流程

```mermaid
sequenceDiagram
    participant App as 应用启动
    participant PLM as PersistentLoginManager
    participant Store as 会话存储
    participant WS as WebSocket
    participant Notify as 通知系统

    App->>PLM: 初始化
    PLM->>Store: 读取所有已保存会话

    loop 每个会话
        PLM->>PLM: decrypt() 解密 code
        PLM->>WS: fetchProfileByCode(code)

        alt 验证成功
            WS-->>PLM: LoginReply { gid, level }
            PLM->>PLM: 启动 Worker
            PLM->>Store: 更新 lastUsedAt

        else code 已过期
            WS-->>PLM: 400 错误
            PLM->>PLM: 检查是否有刷新策略

            alt 可自动刷新
                PLM->>PLM: 尝试自动恢复
                alt 恢复成功
                    PLM->>PLM: 更新存储
                    PLM->>PLM: 启动 Worker
                else 恢复失败
                    PLM-->>Notify: 发送"需要重新扫码"通知
                    PLM->>Store: 标记为待处理
                end
            else 不可刷新
                PLM-->>Notify: 发送"请重新添加账号"通知
                PLM->>Store: 标记为待处理
            end

        else 网络错误
            WS-->>PLM: 连接超时/网络不可达
            PLM->>PLM: 标记为延迟重试
            PLM->>PLM: 稍后重试 (指数退避)
        end
    end

    App->>App: 所有账号处理完成
    App->>App: 进入运行状态
```

---

## 3. 运行中自动恢复

```mermaid
stateDiagram-v2
    [*] --> Running: Worker 正常运行

    Running --> HeartbeatLost: 心跳超时
    HeartbeatLost --> AutoReconnect: 5秒后自动重连

    AutoReconnect --> Running: 重连成功 (原 code)
    AutoReconnect --> CodeFailed: 400 错误

    CodeFailed --> AttemptRefresh: 尝试刷新
    AttemptRefresh --> NotifyUser: 刷新失败 / 不可刷新
    AttemptRefresh --> Running: 刷新成功 (新 code)

    NotifyUser --> WaitingScan: 推送二维码
    WaitingScan --> CodeRefreshed: 用户扫码
    CodeRefreshed --> Running: 更新 code + 重启 Worker

    Running --> Kicked: 被踢下线
    Kicked --> NotifyUser

    Running --> VersionTooLow: 版本过低
    VersionTooLow --> VersionBump: 自动递增
    VersionBump --> AutoReconnect
```

---

## 4. 自动恢复决策树

```mermaid
graph TD
    A["会话失效"] --> B{"什么原因?"}

    B -->|"心跳超时"| C1["自动重连"]
    B -->|"WebSocket 400"| C2["code 过期"]
    B -->|"Kickout"| C3["被踢下线"]

    C1 --> D1["重连成功?"]
    D1 -->|"是"| E1["继续运行"]
    D1 -->|"否"| C2

    C2 --> D2["有有效备用 code?"]
    D2 -->|"是"| E2["使用备用 code 重连"]
    D2 -->|"否"| D3["可以自动刷新?"]

    D3 -->|"是"| E3["尝试刷新"]
    D3 -->|"否"| F1["推送通知给管理员"]

    E2 --> G1["重连成功?"]
    G1 -->|"是"| E1
    G1 -->|"否"| F1

    E3 --> G2["刷新成功?"]
    G2 -->|"是"| H["更新存储 + 重启Worker"]
    G2 -->|"否"| F1

    C3 --> F1
```

---

## 5. 错误处理矩阵

| 故障场景 | 自动检测 | 自动恢复 | 恢复方式 | 人工介入 |
|---------|---------|---------|---------|---------|
| 网络断开 | ✅ 心跳超时 | ✅ | 5秒后重连 | ❌ 不需要 |
| 临时中断 | ✅ WebSocket 关闭 | ✅ | 自动重连 | ❌ 不需要 |
| Code 过期 | ✅ 400 错误 | ❌ | 无刷新机制 | ✅ 需重新扫码 |
| 版本过低 | ✅ Kickout 检测 | ✅ | 自动递增版本(最多5次) | ❌ 不需要 |
| 被踢下线 | ✅ Kickout | ❌ | 停止 Worker | ✅ 需重新添加 |
| 服务器重启 | ✅ 连接断开 | ⚠️ | 重连(若 code 有效) | ⚠️ 可能需重新扫码 |
| IP 变更 | ❌ 服务器端检测 | ❌ | 未知 | ⚠️ 待测试 |

---

## 6. 自动恢复配置选项

```typescript
interface AutoRecoveryConfig {
  // 自动重连
  autoReconnect: boolean;          // 是否自动重连 (默认: true)
  reconnectDelay: number;          // 重连延迟 (默认: 5000ms)
  maxReconnectAttempts: number;    // 最大重连次数 (默认: -1, 无限)

  // 版本过低自动修复
  autoBumpVersion: boolean;        // 是否自动递增版本 (默认: true)
  maxVersionBumps: number;         // 最大版本递增次数 (默认: 5)

  // Code 刷新
  enableAutoRefresh: boolean;      // 是否启用自动刷新 (默认: false)
  refreshStrategy: RefreshStrategy; // 刷新策略

  // 通知
  notifyOnFailure: boolean;        // 失败时推送通知 (默认: true)
  notifyChannels: string[];        // 通知渠道

  // 存储
  backupEnabled: boolean;          // 是否启用自动备份 (默认: true)
  backupInterval: number;          // 备份间隔 (默认: 3600000ms = 1小时)
  maxBackups: number;              // 最大备份保留数 (默认: 10)
}
```
