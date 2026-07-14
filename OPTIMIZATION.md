# 仓库优化建议

> 整理日期：2026-07-14
>
> 本仓库包含两个子项目：部署在 Cloudflare 上的 REST/SET 组间计时 Web 应用
> （vinext/Next.js + D1），以及 `wechat-miniprogram/` 下的微信小程序。
> 以下建议按子项目和优先级整理。

---

## 第一部分：Web 应用（REST / SET）

### 一、正确性问题（建议先修）

#### 1. API 存在会导致 500 的空指针

`app/api/workouts/route.ts:119` 写的是 `record?.exercise.trim()`。
如果请求体里有 `record` 但没有 `exercise` 字段，`.trim()` 会直接抛异常
返回 500，而不是预期的 400。应改成 `record?.exercise?.trim()`。

另外 `completedAt` 和 `heartRateBpm` 完全没校验，客户端可以塞任意类型进
INTEGER 列（SQLite 弱类型会照单全收）。

#### 2. 每个 API 请求都在跑建表 DDL

`initializeSchema` 在 GET/POST/DELETE 的每次调用里都执行 4 条
`CREATE TABLE/INDEX IF NOT EXISTS`。D1 按请求计费且有延迟，这是纯浪费。

- 首选：用已有的 `drizzle/0000_flawless_chimera.sql` 迁移一次性建表；
- 退一步：至少用模块级变量记住"已初始化"，每个 Worker 实例只跑一次。

#### 3. 同一份 schema 存在三个副本

路由里的手写 DDL、`db/schema.ts` 的 Drizzle 定义、`drizzle/0000_*.sql`
迁移文件，三处各自维护，改字段时很容易漂移。且 `db/index.ts` 已经封装好了
带类型的 Drizzle 客户端，但真正的 API 路由完全没用它，反而自己手写 SQL 和
一套 D1 类型垫片（`Statement`、`Database`）。

建议：路由改用 `getDb()` + Drizzle 查询，删掉手写 DDL 和类型垫片，
schema 只留 `db/schema.ts` 一个真实来源。

#### 4. 计时结束音效会耗尽 AudioContext

`app/page.tsx` 的 `playFinishCue` 每次休息结束都 `new AudioContext()`
且从不关闭。浏览器通常限制约 6 个 context，练到第七组之后提示音会静默失效。
应复用一个模块级 context，或播完后 `audio.close()`。

#### 5. 保存失败时乐观更新不回滚

`recordSet` 先把记录插进列表再发请求，失败时只改了状态文字，记录仍留在
界面上，刷新后就消失了；而 `deleteRecord` 是有回滚的，两者行为不一致。
建议失败时移除该条并保留输入，或加重试。

### 二、次要优化

- `DELETE` 路由用 `db.batch()` 包了单条语句，直接 `.run()` 即可。
- `layout.tsx` 的 `generateMetadata` 每次请求读 `host` 头，把所有页面变成
  动态渲染，只为拼 OG 图片 URL。部署域名固定的话用 `metadataBase` 静态化更好。
- Web Bluetooth 的类型是手写的（`HeartRateDevice` 等），装个
  `@types/web-bluetooth` 就能删掉这约 25 行。
- 心率设备断开后 `heartDeviceRef` 没清理，也没有重连逻辑，训练中掉线只能
  刷新页面重连。

### 三、仓库卫生

- **README 还是模板原文**：整个 README 讲的是 vinext-starter 脚手架，
  完全没提 REST/SET 应用本身，也没提 `wechat-miniprogram/` 子项目。
  建议重写成描述实际项目的文档。
- **`examples/d1/` 是脚手架残留**：它是唯一引用 `getDb()` 的地方
  （真实路由反而没用）。按第 3 点改造后可整个删掉；`app/chatgpt-auth.ts`
  若确定不做登录也可一并清理。
- **根目录 `npm test` 不跑小程序测试**：只测了渲染骨架，建议把
  `wechat-miniprogram/tests/` 也挂进测试脚本。

### 四、需要决策的一点：数据隔离

数据隔离目前完全靠 localStorage 里的随机 `deviceId` 当令牌——UUID 不可猜测，
作为个人工具够用，但换浏览器/清缓存数据就"丢"了，且任何拿到 deviceId 的人
可读写全部记录。仓库里现成的 ChatGPT 登录方案（README 里的 SIWC）如果这个站
部署在 OpenAI workspace 上，可以低成本换成按用户隔离。

---

## 第二部分：微信小程序（X健身计数）

> 现状：`index.js` 1845 行、`index.wxml` 383 行、`index.wxss` 1733 行，
> 外加 vm 驱动的逻辑测试。整体功能完整，计时用 `restEndAt` 时间戳而非累减、
> 心率存储有分块和异步写入队列，这些都做得不错。

### 一、健壮性问题（实际会影响使用）

#### 1. 蓝牙断连后 UI 不知情

全文没有注册 `wx.onBLEConnectionStateChange`。心率带出范围或没电后，界面仍
显示"已连接"，恢复分析会一直拿最后一次的过期心率算"恢复良好"，这是误导性
数据。建议注册断连监听：更新状态、清空 `heartRate`，有条件的话自动重连一次。
（Web 版反而处理了 `gattserverdisconnected`，两边不一致。）

#### 2. 订阅的可能不是心率特征值

`connectDevice`（index.js 约 1815 行）找的是"第一个支持 notify/indicate 的
特征值"，而不是标准的心率测量特征值 `0x2A37`。多数心率带只暴露一个，碰巧能
工作；但遇到同服务下有多个可通知特征值的设备就会订阅错。同理
`bleValueHandler`（index.js 约 164 行）不校验 `result.deviceId` 和
`characteristicId`，任何 BLE 通知都会被当心率解析。按 UUID 精确匹配即可修复。

#### 3. 扫描没有按服务过滤

`startBluetoothDevicesDiscovery`（index.js 约 1773 行）没传
`services: ["180D"]`，会扫出健身房里所有 BLE 设备（耳机、体脂秤、别人的
手表），列表噪音大且更耗电。心率广播设备（含佳明）都会广播 180D 服务，
加上过滤后设备列表基本只剩心率设备。

#### 4. 心率数据只增不删，迟早撑爆 10MB 存储配额

每天的心率按 300 条一块无限累积（1Hz 采样练两小时 ≈ 7200 条/天），
`workout_日期` 键也永久保留，没有任何清理逻辑。小程序本地存储上限 10MB，
几个月后 `setStorageSync` 会开始集体失败——而代码里存储失败的兜底是
"静默放弃"，届时表现为各种数据莫名丢失。

建议：启动时清理 N 天前的 `heart_rate_*` 键（训练记录可以留，体积小），
或对历史心率降采样。

### 二、性能问题

#### 5. `rebuildLastPerformanceIndex` 是 O(全部历史) 的同步操作

`removeSet`（index.js 约 1716 行）每删一条记录就同步读取*有史以来所有*
`workout_*` 键并重建整个索引。几个月历史后删除一条记录会明显卡顿。
删除只影响一个动作，增量更新那一个 key 就够了；`saveExerciseOptions`
里的全量重建也同理。

#### 6. 长按步进器每 120ms 写一次磁盘

`adjustMetricValue` 的 setData 回调里调 `saveConfig()`，而 stepper 以
120ms 间隔连发（index.js 约 1334 行）。`setStorageSync` 是同步 IO，
长按调重量时每秒写 8 次配置。配置保存挪到 `stopStepper` / `onFieldBlur`
时做一次即可。

#### 7. Canvas 用的是已废弃的旧接口

`wx.createCanvasContext`（index.js 约 1607 行）自基础库 2.9 起废弃，
且每秒重绘时还要重新 `createSelectorQuery`。迁移到 Canvas 2D
（`type="2d"`），缓存 node 和 context，绘制走同层渲染，性能和清晰度
（可处理 DPR）都更好。

#### 8. 动作管理器里维护了两份列表

`draftExercises` 和 `filteredDraftExercises` 同时放在 data 里，每次筛选/
编辑都 setData 两个数组。用 WXS 在视图层过滤，或只 setData 变化的下标
（如 `draftExercises[3].favorite`），能明显减小 setData 载荷。

### 三、结构与可维护性

#### 9. 拆掉 1845 行的单文件 Page

现在一个文件里混着六个互相独立的领域：BLE 连接、心率分块存储、休息倒计时、
农夫行走秒表、动作库 CRUD、训练模板。建议拆成：

- `utils/format.js` — `pad` / `todayKey` / `formatClock` / `formatStopwatch`
  等纯函数
- `services/heart-storage.js` — 分块存储、meta、写入队列
  （这块逻辑最精巧也最怕被改坏，最值得独立）
- `services/ble-heart-rate.js` — 扫描 / 连接 / 解析
- `services/exercise-library.js` — normalize、迁移、持久化
- 三个弹窗（动作管理、模板管理、设备列表）拆成自定义组件，WXML/WXSS
  一起带走（1733 行的 WXSS 大部分属于弹窗）

直接收益是测试：现在 `tests/index.logic.test.cjs` 要用 `vm` 执行整个文件、
mock 全套 `wx` API 才能测一个纯函数，拆分后直接 `require` 模块即可，
测试会薄很多。

#### 10. 顺手清理的小问题

- `updateRecoveryMetrics`（index.js 约 1642 行）没有任何调用方，是死代码；
- `getSetMeasureType(set)` 定义只收一个参数，但多处按 `(set, library)`
  调用，第二个参数是幻觉参数，读代码时很误导；
- `saveExerciseOptions` 一个函数约 95 行干了迁移 + 持久化 + 模板重映射 +
  状态更新四件事，值得拆。

#### 11. 把小程序测试挂进根目录 `npm test`

现在根目录的 test 脚本只跑 web 的渲染测试，`wechat-miniprogram/tests/`
要手动跑，CI 里等于不存在。加一行 `node --test wechat-miniprogram/tests/`
即可。

### 建议的动手顺序

1. 小程序第 1–3 项（BLE 断连监听、按 UUID 订阅 2A37、扫描过滤 180D）：
   用户可感知的健壮性问题，改动小收益大，先做；
2. 小程序第 4、5 项：决定这个 app 能不能"长期用"；
3. Web 应用第一部分 1–5 项：都是小改动，可一次性修完；
4. 小程序第 9 项拆分工作量最大，可在改前三项时顺势把 BLE 部分先抽出来。
