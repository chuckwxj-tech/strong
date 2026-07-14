# Strong

这个仓库包含两个力量训练记录工具：根目录下的 **REST / SET Web 应用**，以及
`wechat-miniprogram/` 下的 **X健身计数微信小程序**。两者目前是独立项目，数据
不会互相同步。

## 项目一览

### REST / SET Web 应用

基于 vinext、Next.js 和 Cloudflare D1 的组间休息计时与训练记录应用。

主要功能：

- 自定义动作、重量、次数和组间休息时间；
- 完成本组后保存记录并开始倒计时；
- 查看指定日期的组数、训练容量和训练记录；
- 记住动作最近一次使用的重量与次数；
- 在支持 Web Bluetooth 的浏览器中连接标准心率设备，并在完成一组时保存当时的
  心率值。

代码主要位于 `app/`，训练记录接口位于 `app/api/workouts/route.ts`，D1 表结构
位于 `db/schema.ts` 和 `drizzle/`。

### X健身计数微信小程序

位于 `wechat-miniprogram/`，针对手机训练场景提供更完整的记录能力。

主要功能：

- 记录按次数或按时间完成的动作，并按天查看历史；
- 完成本组后进入独立休息界面，切换后台后仍按真实时间恢复倒计时；
- 农夫行走支持左右手分别开始、结束和重测；
- 通过 BLE 连接标准心率设备，按时间戳分块保存设备发送的完整心率样本；
- 管理动作库、常用动作和训练模板。

## 运行 Web 应用

环境要求：Node.js `>=22.13.0`。

```powershell
npm install
npm run dev
```

开发服务器地址以终端输出为准。本地开发会按 `.openai/hosting.json` 和
`vite.config.ts` 提供名为 `DB` 的本地 D1 绑定。

其他常用命令：

```powershell
npm run build
npm run lint
npm run db:generate
```

## 运行微信小程序

1. 打开微信开发者工具。
2. 选择“导入项目”，目录指向仓库中的 `wechat-miniprogram/`。
3. 点击“编译”查看界面。
4. BLE 心率连接需要使用“预览”或“真机调试”在手机上验证。

## 测试

在仓库根目录执行：

```powershell
npm test
```

该命令会依次构建 Web 应用，并运行 Web 测试与小程序逻辑测试。只检查小程序
时可以执行：

```powershell
node --check .\wechat-miniprogram\miniprogram\pages\index\index.js
node --test .\wechat-miniprogram\tests\index.logic.test.cjs
```

## 数据保存现状

### Web 应用

- 训练组和动作预设保存在 Cloudflare D1；每组只保存完成时的一次心率值，不保存
  完整心率流。
- 浏览器在 `localStorage` 中生成随机 `deviceId`，服务端以该 ID 区分数据。
- 当前没有账号登录或跨设备同步。更换浏览器、清理站点数据或丢失 `deviceId` 后，
  原记录仍可能存在于 D1，但客户端无法自动找回；拿到该 ID 的人也可能访问对应
  数据。

### 微信小程序

- 训练日期、动作、重量、次数、计时时长、模板和完整心率样本均保存在当前设备的
  微信小程序本地存储中。
- 当前没有微信账号云同步，也没有和 Web 应用合并数据。清理缓存、删除小程序或
  更换手机可能导致记录丢失。
- AppSecret 不应写入客户端代码或提交到 Git；需要服务端能力时应放在受保护的
  服务端或云函数环境中。
