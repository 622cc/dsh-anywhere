# Install DSH Anywhere on a Mac

For an AI agent installing DSH Anywhere for a person. DSH Anywhere lets their phone use the DeepSeek Harness (DSH)
agents on this Mac. The companion runs inside DSH Desktop; the phone reaches it through Tailcat, with no open port
and no VPN. Installing is one command: nothing to clone or build.

## 1. Check

1. Apple-silicon Mac: `uname -m` prints `arm64`.
2. DSH Desktop is installed (`/Applications/DeepSeek Harness.app`) and has been opened once:
   `~/.dsh/profiles/desktop/package.json` exists (`$DSH_HOME/profiles/desktop/…` if `DSH_HOME` is set).
3. `dsh --version` prints `0.2.0-rc.2` or a 0.2.1 version (`0.2.1`, `0.2.1-alpha.N`, `-beta.N`, `-rc.N`). If `dsh` is
   not found, use the app's own launcher in its place:
   `"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"`.
4. Earlier install from source: if `~/.dsh/profiles/desktop/cordis.patch.yml` contains
   `# DSH-MOBILE-COMPANION-BEGIN`, tell the person and, with their consent, delete the lines from `BEGIN` to `END`
   inclusive. Paired phones are kept: both installs use the same private folder.
5. Tell the person the phone needs Android 9 or later. For an iPhone, install the companion here, then follow
   [AGENT-IPHONE.md](AGENT-IPHONE.md).

## 2. Install

```sh
dsh plugin --profile desktop add https://github.com/jt-wang/dsh-anywhere/releases/latest/download/dsh-anywhere-darwin-arm64.tgz
```

It ends with `+ dsh-anywhere <version>` and exit code 0. DSH checks the package's supported DSH versions while
installing and refuses it on an unsupported DSH.

## 3. Verify

- `~/.dsh/profiles/desktop/package.json` lists `dsh-anywhere` under `dsh.profile.bundles`.
- DSH Desktop loads the new bundle by itself; if nothing happens within a minute, ask the person to quit and reopen
  DSH. The first start creates `~/Library/Application Support/DSHMobile/host/host.json` (owner-only).
- `~/Library/Application Support/DSHMobile/host/companion.log` ends with `running <version>`. A `failed <version>
  <code>` line names the problem: `unsupported_dsh_version` (DSH version not supported), `companion_conflict` (the
  block from step 1.4 is still there), `tailcat_helper_missing` (damaged package: install again), `unavailable` (could not start; check whether another
  program holds port 19445).

## 4. Pair the phone

The person installs the DSH Anywhere app on the phone, then in DSH Desktop opens **Settings → Mobile → Pair a phone**
and scans the QR code with the app within two minutes. The QR code is a one-use secret: do not copy it anywhere.

## 5. Update

Run the install command from step 2 again. It takes the latest release, and DSH keeps running the old version until
the person is ready: ask them to quit and reopen DSH Desktop, then check that `companion.log` ends with
`running <new version>`. Paired phones stay paired.

## 6. Remove

```sh
dsh plugin --profile desktop remove dsh-anywhere
```

The private configuration and paired phones stay in `~/Library/Application Support/DSHMobile/`; delete that folder
only if the person wants this Mac to forget its phones.
