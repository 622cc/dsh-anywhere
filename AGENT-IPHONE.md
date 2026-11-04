# Build DSH Anywhere for your iPhone

For a person, or the AI agent helping them, who wants DSH Anywhere on an iPhone today. You build it on your Mac and sign
it with your own Apple account. A free account has the limits at the end. The build has not been run on a real iPhone
yet, so please [open an issue](https://github.com/jt-wang/dsh-anywhere/issues) if a step fails.

## 1. Have ready

- A Mac with Xcode (checked on Xcode 27), and an iPhone on iOS 17 or later connected by cable.
- Your Apple account in Xcode: Xcode › Settings › Accounts.
- [Go](https://go.dev/dl/), [Rust](https://rustup.rs) and xcodegen (`brew install go xcodegen`).
- The companion in DeepSeek Harness on the Mac: follow [AGENT-INSTALL.md](AGENT-INSTALL.md).

## 2. Get the source

```sh
git clone -b dsh-anywhere https://github.com/jt-wang/nsh
(cd nsh && cargo build --release -p nsh-cli && cargo xtask ios-embed --no-catalyst --no-dev)
git clone https://github.com/jt-wang/dsh-anywhere
cd dsh-anywhere/nsh-app
export NSH_SOURCE="$PWD/../../nsh"
```

## 3. Set your team and app id

```sh
cp ios/signing.env.example ios/signing.env
```

Fill in both lines of `ios/signing.env`, which Git ignores:

- `DSH_TEAM`: your Apple team ID. With a paid account it is under Membership on developer.apple.com. With any account,
  once Xcode has created your Apple Development certificate (Xcode › Settings › Accounts › Manage Certificates),
  this prints it as `OU`:
  `security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject`
- `DSH_BUNDLE_PREFIX`: the start of the app id, one no other developer has registered, such as `com.yourname`.

## 4. Build and install

```sh
DEVICE=1 ios/build.sh
xcrun devicectl list devices
xcrun devicectl device install app --device <identifier from the list> ios/build/DSH.app
```

On the iPhone, turn on Settings › Privacy & Security › Developer Mode, and when iOS says the developer is untrusted,
trust it under Settings › General › VPN & Device Management.

## 5. Pair

On the Mac: DSH › Settings › Mobile › **Pair a phone**. On the iPhone: open DSH and scan the code. The phone reaches the
Mac through Tailcat, with no open port and no VPN.

No Mac nearby yet? **Try it with sample data** on the pairing screen shows the app on made-up chats.

## Free account limits

Apple's [free membership](https://developer.apple.com/support/compare-memberships/) signs apps for 7 days and for up to
3 devices. Run step 4 again each week.
