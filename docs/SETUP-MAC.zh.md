# DSH Anywhere：在 Mac 上安装（Apple 芯片）

英文完整版见同目录的 `SETUP-MAC.md`。

不会做的事：不重启 DSH，不开防火墙端口，不改系统信任；插件只监听 `127.0.0.1`，不需要 sudo。

## 一条命令安装

装好 DSH Desktop 并打开过一次之后，运行：

```sh
dsh plugin --profile desktop add https://github.com/jt-wang/dsh-anywhere/releases/latest/download/dsh-anywhere-darwin-arm64.tgz
```

PATH 里没有 `dsh` 时，用 App 自带的
`"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"`。安装时 DSH 会检查版本：支持
`0.2.0-rc.2` 和 0.2.1 的所有正式版与预发布版。

DSH 会加载这个插件。插件第一次启动时，在 `~/Library/Application Support/DSHMobile/host/` 生成私有的 Tailcat 配置；
那里的 `companion.log` 最后一行是 `running <版本号>` 就说明在运行了。然后在 DSH 里打开 **Settings → Mobile → Pair a phone**。
卸载：`dsh plugin --profile desktop remove dsh-anywhere`。

让 AI agent 来装：把 [AGENT-INSTALL.md](../AGENT-INSTALL.md) 交给它，里面有每一步的检查。

## 更新

再运行一次安装命令，然后退出并重新打开 DSH Desktop。重新打开之前，运行的还是旧版本。已配对的手机不用重新配对。

## 配对手机

[下载 Android App](https://github.com/jt-wang/dsh-anywhere/releases/latest/download/dsh-anywhere.apk) 并安装。在 DSH 里打开 **设置 → Mobile → Pair a phone**，用 App 扫码。在同一页可以撤销手机。

## 从源码构建

只有想改代码才需要，见英文版的 [Build and install from source](SETUP-MAC.md#build-and-install-from-source)。
