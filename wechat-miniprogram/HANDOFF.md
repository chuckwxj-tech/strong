# X健身计数 — Agent Handoff

最后更新：2026-07-14（Asia/Shanghai）

## 1. 项目目的

这是一个面向力量训练的微信小程序。核心问题是：用户在力量训练时难以同时控制组间休息、记录每组动作/重量/次数，并结合连续心率判断身体恢复情况。

产品目标：

1. 训练时尽量只保留单手可操作的大按钮和少量关键数据。
2. 点击“完成本组”后自动保存本组数据并进入独立的休息状态。
3. 休息状态实时显示倒计时、当前心率、组后峰值和恢复 BPM。
4. 保存设备发送的全部原始心率数据，后续可与佳明力量训练 FIT 文件合并分析。
5. 每天保存训练记录，未来支持微信云开发跨设备同步。

## 2. 项目位置与身份

- 仓库内项目目录：`wechat-miniprogram/`
- 小程序代码目录：`wechat-miniprogram/miniprogram/`
- 小程序名称：`X健身计数`
- AppID：`wx537b6dfb74fe0269`
- 技术形态：原生微信小程序，JavaScript + WXML + WXSS
- 微信开发者工具：Stable v2.01.2510290
- Git 仓库：`git@github.com:chuckwxj-tech/strong.git`
- 为保留仓库中已有的网页版，微信小程序独立放在 `wechat-miniprogram/` 子目录。

安全说明：不要在客户端代码、文档或 Git 中写入 AppSecret；如曾暴露，必须立即在微信公众平台重置。本文件没有保存该密钥。

## 3. 当前完成度

### 已实现

- 项目 AppID 和项目名称已改为正确的小程序信息。
- 深色力量训练视觉风格，荧光绿主操作色。
- 两个全屏视觉状态，技术上仍在同一个页面内切换，避免蓝牙连接因页面跳转中断：
  - `training`：训练界面。
  - `rest`：休息/恢复界面。
- 训练界面支持编辑：
  - 动作名称。
  - 重量（kg）。
  - 次数。
  - 组间休息秒数。
- 点击“完成本组”后：
  - 校验动作、重量、次数。
  - 保存本组记录。
  - 震动反馈。
  - 切换为休息界面。
  - 自动开始倒计时。
- 休息界面支持：
  - 大号倒计时。
  - 暂停/继续。
  - `-15 秒`、`+15 秒`。
  - 当前心率。
  - 本组峰值。
  - 当前恢复 BPM。
  - 60 秒恢复值。
  - “开始下一组”返回训练界面。
- 今日统计：
  - 今日组数。
  - 训练容量（重量 × 次数累计）。
  - 今日心率采样数量。
- 本地删除单组记录，删除前有确认弹窗。
- 仅扫描标准 `0x180D` 心率服务，并精确订阅 `0x2A37` 心率测量特征。
- 保存全部收到的原始心率通知，不只保存平均值或每组快照。
- 原始心率统计：平均、最高、最低。
- 当天训练记录和设置本地持久化。
- 倒计时使用绝对结束时间反算，切后台再回来不会因 `setInterval` 暂停而漂移。
- 页面显示期间调用 `wx.setKeepScreenOn({ keepScreenOn: true })`，降低训练中自动熄屏导致 BLE 停止的风险。
- BLE 特征通知、设备发现和连接状态监听器使用固定函数引用，并在停止扫描/卸载时注销。
- 意外断连后会立即清空过期实时心率并提示重新连接；主动断开不会触发重连循环。
- “完成本组”有页面状态和实例锁双重防连点。
- 已连接时点击心率按钮会先确认，不再直接断开。
- 数字输入在输入过程中保持字符串，失焦后才规范化，允许正常输入 `60.` 或临时清空。
- 心率数据改为每 300 条一个分块并异步写入；不再反复全量序列化整天数组。
- 心率 count/sum/min/max 使用 O(1) 增量统计，界面更新最多约每秒一次。
- 异步写入失败的心率分块会保留在内存重试队列，下次刷新存储时再次写入并提示用户。
- 本地存储超过 80% 时会询问是否清理 30 天前的原始心率；未确认不会删除，训练组记录永不随之清理。
- 删除单组记录只重算该动作的上次表现；长按步进器在松手时才保存一次配置。

### 尚未实现

- 微信云开发数据库同步；当前所有训练和心率数据仅保存在手机本地。
- 真机 iPhone + 佳明心率带/佳明手表的完整 BLE 验收。
- Garmin Connect 自动授权同步。
- 佳明原始 `.fit` 文件导入、解析和合并。
- 心率曲线图和每组时间轴可视化。
- 数据导出、备份和恢复。
- 多个训练计划、动作库、模板和历史日期页面。
- 小程序隐私保护指引、审核材料、正式上传和发布。

## 4. 核心源码

完整源码已经存在于项目目录，下面这些文件是交接时必须阅读和修改的权威版本：

| 文件 | 作用 |
|---|---|
| `project.config.json` | AppID、项目名、编译设置 |
| `project.private.config.json` | 开发者工具本地覆盖配置；项目名也在这里 |
| `miniprogram/app.js` | 小程序启动和云能力初始化 |
| `miniprogram/app.json` | 页面注册、导航栏配置 |
| `miniprogram/app.wxss` | 全局背景、按钮重置、基础字体 |
| `miniprogram/pages/index/index.js` | 全部业务状态、计时、存储、BLE、心率恢复计算 |
| `miniprogram/pages/index/index.wxml` | 训练界面、休息界面、蓝牙设备选择弹层 |
| `miniprogram/pages/index/index.wxss` | 当前完整视觉样式和对齐规则 |
| `miniprogram/pages/index/index.json` | 首页导航栏样式 |

`pages/example`、`components/cloudTipModal`、`cloudfunctions/quickstartFunctions` 等仍是微信云开发模板遗留代码，当前主流程没有使用。不要在没有确认云方案前将模板云函数当成正式后端。

## 5. 页面状态与主流程

页面状态字段：

```js
data: {
  mode: "training", // training | rest
  exerciseName: "杠铃卧推",
  weight: 60,
  reps: 8,
  restSeconds: 90,
  timerRemaining: 90,
  timerRunning: false,
  sets: [],
  heartRate: "--",
  restPeak: "--",
  heartRecovery: "--",
  heartAt60: "--",
}
```

主流程：

```text
训练界面
  -> 用户点击“完成本组”
  -> completeSet()
  -> 本地保存组记录
  -> mode = "rest"
  -> startRest()
  -> 倒计时 + 实时心率恢复分析
  -> 用户点击“开始下一组”
  -> startNextSet()
  -> 保存本次休息摘要
  -> mode = "training"
```

关键状态切换代码位于 `miniprogram/pages/index/index.js`：

```js
completeSet() {
  // 校验动作/重量/次数，创建 set 后：
  this.restStartedAt = Date.now();
  const heartAtFinish = Number(this.data.heartRate) || 0;
  this.setData({
    mode: "rest",
    sets,
    totalVolume: this.calculateVolume(sets),
    restPeak: heartAtFinish || "--",
    heartRecovery: heartAtFinish ? 0 : "--",
    heartAt60: "--",
  });
  this.startRest(Number(this.data.restSeconds) || 90);
}

startNextSet() {
  this.saveRestSummary();
  this.clearTimer();
  this.setData({
    mode: "training",
    timerRunning: false,
  });
}
```

上面是便于交接理解的摘录；实现时以实际源文件为准。

## 6. 本地数据结构

### 用户配置

存储键：`workout_config`

```json
{
  "exerciseName": "杠铃卧推",
  "weight": 60,
  "reps": 8,
  "restSeconds": 90
}
```

### 每日训练记录

存储键：`workout_YYYY-MM-DD`

```json
[
  {
    "id": 1784019600000,
    "exerciseName": "杠铃卧推",
    "weight": 60,
    "reps": 8,
    "time": "09:00",
    "heartAtFinish": 145,
    "heartPeak": 152,
    "heartRecovery60": 24,
    "restActualSeconds": 88
  }
]
```

说明：`heartPeak`、`heartRecovery60` 和 `restActualSeconds` 在用户点击“开始下一组”时由 `saveRestSummary()` 写回最近一组。

### 每日完整心率原始数据

分块存储键：

- `heart_rate_YYYY-MM-DD_0`
- `heart_rate_YYYY-MM-DD_1`
- 依次递增，每块最多 300 条。
- 元数据：`heart_rate_YYYY-MM-DD_meta`。

为减少体积，每条使用二元数组：

```json
[
  [1784019600123, 126],
  [1784019601128, 127],
  [1784019602130, 129]
]
```

含义：`[Unix 毫秒时间戳, BPM]`。

每一条 BLE 心率通知都会先写入当前分块。每累计 10 条会异步保存当前分块和元数据；分块达到 300 条后自动轮换。`onHide`、`onUnload` 和主动断开设备时会刷新剩余数据。

元数据示例：

```json
{
  "chunkIndex": 1,
  "count": 305,
  "sum": 37210,
  "min": 82,
  "max": 168
}
```

旧版本的单键 `heart_rate_YYYY-MM-DD` 数组会在首次加载时迁移到分块格式。旧键暂时保留，避免迁移中断造成数据丢失；当本地存储超过 80% 时，用户可以确认清理 30 天前的旧格式与分块心率键，训练组不会被删除。

## 7. BLE 心率实现

使用标准 Bluetooth Low Energy Heart Rate Service：

```js
const HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
const HEART_RATE_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";
```

连接流程：

1. `wx.openBluetoothAdapter()`。
2. `wx.startBluetoothDevicesDiscovery({ services: ["180D"] })`，只扫描标准心率服务。
3. 用户选择设备后调用 `wx.createBLEConnection()`。
4. `wx.getBLEDeviceServices()` 找到 Heart Rate Service `0x180D`。
5. `wx.getBLEDeviceCharacteristics()` 精确找到支持 notify/indicate 的 Heart Rate Measurement `0x2A37`。
6. `wx.notifyBLECharacteristicValueChange()` 开启通知。
7. `wx.onBLECharacteristicValueChange()` 先校验设备 ID 和特征 ID，再解析心率并保存。
8. `wx.onBLEConnectionStateChange()` 发现意外断连后清空实时值并更新界面提示。

心率解析支持标准 Heart Rate Measurement 的 8 位/16 位格式：

```js
const bytes = new Uint8Array(result.value);
const is16Bit = (bytes[0] & 0x01) === 1;
const heartRate = is16Bit
  ? bytes[1] + (bytes[2] << 8)
  : bytes[1];
```

设备发现已按 `0x180D` 过滤，不会再列出普通耳机或其他无关 BLE 设备；不要额外按名称硬编码佳明设备。

## 8. 心率恢复算法

当前算法为产品初版规则，不是医疗判断：

1. 点击“完成本组”时记录当前心率。
2. 进入休息后的前 30 秒持续更新本组峰值，因为心率峰值可能滞后出现。
3. 当前恢复值：`本组峰值 - 当前心率`。
4. 第一个到达 60 秒及以后收到的样本用于生成“60 秒恢复值”。
5. 当前界面以恢复 `>= 20 BPM` 显示“恢复良好，可以开始下一组”。此阈值是暂定交互规则，不应描述为医疗标准，后续应允许用户自定义或改为相对个人基线。

阈值集中在 `RECOVERY_READY_BPM` 常量，并通过 `recoveryReadyThreshold` 传给 WXML，避免 JS/WXML 多处硬编码。

核心代码：

```js
getRecoveryUpdate(heartRate) {
  const elapsedSeconds = Math.floor((Date.now() - this.restStartedAt) / 1000);
  let peak = Number(this.data.restPeak) || Number(heartRate);
  if (elapsedSeconds <= 30) {
    peak = Math.max(peak, Number(heartRate));
  }
  const recovery = Math.max(0, peak - Number(heartRate));
  // 更新 restPeak、heartRecovery、heartAt60 和提示文案
}
```

## 9. 佳明数据合并规划

已确认可行，但尚未编码。

推荐第一阶段采用手动 FIT 导入：

1. 用户在佳明手表启动“力量训练”。
2. 训练结束同步到 Garmin Connect。
3. 从 Garmin Connect 网页导出该活动的原始 `.fit` 文件。
4. 小程序增加“导入佳明训练”入口。
5. 文件上传到云函数/后端，使用 Garmin 官方 FIT JavaScript SDK 解析。
6. 根据时间戳与小程序的 `workout_YYYY-MM-DD` 和 `heart_rate_YYYY-MM-DD` 对齐。

合并原则：

- 原始数据必须保留 `source`，例如 `mini_program_ble`、`garmin_fit_watch`、`garmin_fit_strap`。
- 同一秒的重复心率不能重复计入统计。
- 优先选择采样完整、缺口较少的心率源；不要默认两边数值相加或平均。
- 佳明 FIT 中能否得到动作名称、组数、重量、次数取决于手表型号和用户实际记录方式，解析器必须容忍缺失字段。
- 自动 Garmin Connect Activity API 同步放在第二阶段，因为需要 Garmin 开发者项目审批、用户授权和云端回调服务。

## 10. 已验证内容

- `index.js` 已通过 `node --check` 语法检查。
- `app.json` 和页面 JSON 已通过 JSON 解析检查。
- 微信开发者工具编译和代码分析成功。
- 已在开发者工具模拟器中分别检查训练界面与休息界面的实际排版。
- 数字卡片、计时按钮、主按钮和设备弹层使用 flex 水平/垂直居中。
- 使用模拟逻辑验证：
  - `training -> completeSet() -> rest`。
  - 计时器启动。
  - 心率从 145 降到 125 时恢复值为 20。
  - `startNextSet() -> training`。
- 使用模拟心率验证 5 条通知全部进入原始数组并成功落盘。
- 增补自动化回归测试：
  - 后台暂停后按 `restEndAt - Date.now()` 反算倒计时。
  - 连续调用两次 `completeSet()` 只生成一组。
  - 输入 `60.` 时输入阶段不强转，失焦后规范化为 `60`。
  - 305 条心率正确写入 300 + 5 两个分块，元数据计数为 305。
  - 已连接状态点击心率按钮先显示确认，确认后才断开。
  - 页面卸载后 BLE 特征监听器已注销。
  - BLE 断连监听在卸载时注销，意外断连会清空旧心率和待显示队列，主动断开不会触发重连循环。
  - 扫描限定 `0x180D`，即使其他 notify 特征排在前面也只订阅 `0x2A37`。
  - 来自其他设备或其他特征的通知不会进入心率记录。
  - 心率空间清理必须经用户确认，且不会删除训练组。
  - 删除训练组不再全量重建所有动作历史，长按步进器只在松手时保存一次。
  - 心率分块写入失败后会保留快照，并在下一次刷新时重试。
  - 页面显示/卸载时保持亮屏状态正确开启和关闭。

开发者工具模拟器当前可能留有一条本地测试训练记录（杠铃卧推 60 kg × 8）。它只存在于模拟器本地存储，不会自动出现在 iPhone。

## 11. 已知限制与风险

1. **尚未真机验证 BLE**：电脑模拟器不能代表 iPhone 蓝牙行为。
2. **iOS 后台限制**：微信进入后台、手机锁屏或小程序被系统挂起后，BLE 通知可能停止；小程序只能保存实际收到的数据。
3. **数据仅本地保存**：卸载微信、清理小程序数据或更换手机可能丢失数据。
4. **本地容量**：连续原始心率仍会增长；超过 80% 时可确认清理 30 天前的原始心率，但长期完整保存仍需要云同步或导出。
5. **设备兼容性**：佳明手表能否同时向小程序广播心率取决于型号和广播设置；心率带是否支持同时连接也取决于型号。
6. **连接恢复不足**：已有连接状态监听和意外断开提示，但尚未自动重连。
7. **统计阈值暂定**：20 BPM 恢复提示不是医疗标准。
8. **模板遗留**：云开发 QuickStart 示例文件尚未清理；不要误部署为生产服务。
9. **隐私合规未完成**：蓝牙、运动数据和心率属于敏感场景，上线前必须完成小程序隐私保护指引、用途说明和用户授权流程。

## 12. 下一位 Agent 的建议顺序

### P0：真机验证

1. 在微信开发者工具点击“预览”。
2. 用用户的 iPhone 微信扫码。
3. 确认系统已允许微信使用蓝牙。
4. 让佳明心率带保持佩戴和唤醒。
5. 验证发现、连接、实时 BPM、完整采样和主动断开。
6. 测试佳明手表的“广播心率”模式是否能被发现。

### P1：稳定 BLE

- 已完成连接状态监听和意外断开提示。
- 增加有限次数自动重连。
- 对 BLE 错误码显示可理解的中文说明。

### P2：云数据

- 创建微信云开发环境。
- 设计 `daily_workouts`、`sets`、`heart_rate_samples` 或按日文档结构。
- 心率原始数据批量上传，不要每秒发一次云请求。
- 本地先写、后台批量同步，并提供同步状态与重试。
- 云端去重使用用户、设备来源和时间戳组合键。

### P3：佳明 FIT 导入

- 增加文件导入入口。
- 云函数使用官方 `@garmin/fitsdk` 解码。
- 首先用用户真实力量训练 FIT 文件摸清该型号实际包含的消息和字段。
- 建立时间轴对齐、来源标记和去重规则。
- 显示导入预览，用户确认后再合并。

### P4：发布与代码托管

- 清理未使用模板页面与云函数。
- 小程序项目已纳入 Git。
- 目标仓库已有网页版本；微信小程序以 `wechat-miniprogram/` 子目录合并，未覆盖网页代码。
- 已提交并推送到 `git@github.com:chuckwxj-tech/strong.git`。
- 完成隐私保护指引、体验版测试、代码上传和微信审核。

## 13. 开发与运行

1. 打开微信开发者工具。
2. 导入仓库中的 `wechat-miniprogram/` 目录。
3. 确认 AppID 为 `wx537b6dfb74fe0269`。
4. 点击“编译”查看模拟器。
5. 蓝牙必须使用“预览”或“真机调试”在 iPhone 上测试。

当前基础功能不需要配置“服务器域名”和“业务域名”。未来若使用自有后端或 FIT 上传接口，再根据实际服务配置合法域名；使用微信云开发时优先走云开发能力。

## 14. 交接完成标准

下一位 Agent 开工前应先：

1. 阅读本文件。
2. 阅读 `miniprogram/pages/index/index.js`、`.wxml`、`.wxss` 的完整实际内容。
3. 在修改前确认 AppSecret 已重置，并确保代码库中不存在密钥。
4. 检查工作区是否有用户未提交的改动，不要覆盖。
5. 优先完成 iPhone 真机 BLE 验证，再扩展云端和 Garmin FIT。
