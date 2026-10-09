# hermes-taskbar-badge

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![platform](https://img.shields.io/badge/platform-Windows-0078D6)

A Hermes Desktop plugin that puts a badge on the Hermes taskbar button when a turn finishes.

![the Hermes taskbar button idle, then badged after a turn finishes](docs/demo.png)

## Install

The app loads desktop plugins by directory name, and the name has to equal the plugin id, which is `taskbar-badge`. Clone into that name:

```bash
cd ~/.hermes/desktop-plugins
git clone https://github.com/BrokeSkill/hermes-taskbar-badge.git taskbar-badge
```

When the desktop app runs on Windows and talks to a backend elsewhere, it loads plugins from the client machine. Put the folder there instead:

```
%LOCALAPPDATA%\hermes\desktop-plugins\taskbar-badge\
```

The app hot-reloads desktop plugins on save, so there is no restart.

## Usage

No configuration. A finished turn raises the badge; opening a session or returning to the window clears it.

## How it works

It calls `navigator.setAppBadge(1)` on the `message.complete` gateway event, and `navigator.clearAppBadge()` when `host.state.focusedStoredSessionId` changes or the window regains focus. Electron maps the Chromium Badging API onto the Windows taskbar overlay badge, so Electron draws the badge itself. No helper process, no PowerShell, no second file.

It is one indicator, not one per session. Opening any session clears it, even while another session still holds an unread turn. Per-session precision would need the unread set, which the plugin SDK does not export.

## Requirements

- Windows. The Badging API renders there; tested against Electron 40.10.2.
- Hermes Desktop with the `message.complete` event and `host.state.focusedStoredSessionId` in the plugin SDK.

## Contributing

The plugin is a single file, `plugin.js`. Issues and pull requests are welcome.

## License

MIT. See [LICENSE](LICENSE).
