<div align="center">
    <img src="renderer/logo.png"
        title="Saya" alt="Saya logo" width="120" />
    <h1>Saya</h1>
    <p>
        It's just a browser, no gimmick.
        <br>
        Fast, lightweight, and built to stay out of your way.
    </p>
</div>

## Why Saya?

Saya is a Chromium-based browser (built on Electron) with one goal: open pages
quickly, use little memory, and not get in your way. No account, no sidebar full
of widgets, no AI assistant, no shopping tools. Just tabs, an address bar, and
a good ad blocker.

## Features

### Fast and light

- **Tab sleeping**: idle tabs are put to sleep to free RAM and wake when you open them.
  Under low-memory pressure they sleep sooner. Sites like WhatsApp Web and Google Meet
  can be excluded, and tabs using your mic or camera are kept awake
- **Restores your session**: tabs and window size come back after a restart
- **Small, clean UI**: compact tab bar that adapts to how many tabs you have,
  drag to reorder, and the address bar widens while you type

### Privacy

- **Built-in ad blocker** with uBlock-style filtering: network rules, cosmetic filters,
  scriptlets, and popup blocking
  - Never blocks the page you're navigating to, and fails open instead of breaking sites
  - Built-in exemptions for login, captcha, and payment pages
  - Pause it per site, or right-click an element and choose _Block this element_
- **Secure DNS (DNS over HTTPS)** with Cloudflare, Google, and Quad9 by default;
  switch between secure, automatic, or off in Settings
- **Per-site permissions**: asked once, remembered, and easy to reset from the site info button
- Search suggestions can be turned off or kept local

### Everyday tools

- **Downloads manager**: toolbar button with live progress, a quick "Recent download history"
  panel, and a full page with search, pause/resume, retry, and show in folder (`Ctrl+J`)
- **Find in page** (`Ctrl+F`) with match counter
- **Audio indicator** on tabs that are playing sound; click it to mute
- **History and bookmarks** with their own pages
- **Multiple search engines** (Google, DuckDuckGo, Brave Search): switch with
  `Ctrl+E` or `Alt+1` to `Alt+9`
- **Settings page** (`saya://settings`) to clear caches, cookies, and site data,
  limit cache size, and choose your DNS mode
- **Works with the sites you use**, including Google sign-in

## Keyboard shortcuts

| Shortcut                | Action                          |
| ----------------------- | ------------------------------- |
| `Ctrl+T` / `Ctrl+W`     | New tab / close tab             |
| `Ctrl+Shift+T`          | Reopen closed tab               |
| `Ctrl+Tab`              | Next tab (`Shift` for previous) |
| `Ctrl+L`                | Focus the address bar           |
| `Ctrl+F`                | Find in page                    |
| `Ctrl+D`                | Bookmark this page              |
| `Ctrl+H`                | History                         |
| `Ctrl+Shift+O`          | Bookmarks                       |
| `Ctrl+J`                | Downloads                       |
| `Ctrl+E`                | Switch search engine            |
| `Alt+←` / `Alt+→`       | Back / forward                  |
| `F5` / `Ctrl+R`         | Reload                          |
| `Ctrl+` `+` / `-` / `0` | Zoom in / out / reset           |
| `F12`                   | Developer tools                 |

## Downloads

> [!NOTE]
> Saya is in early development, so unexpected issues may occur.
> Please report them if they haven't already been reported.

Get the latest build from the
[Releases page](../../releases/latest).

- **Windows x64**: download the archive, extract it, and run `Saya.exe`
- macOS and Linux: not available yet

## Configuration

Saya reads `config.json` from the project folder. You can change the default search engine,
ad blocker level and allowlist, DNS servers, history size, and tab sleep timing.
Changes made on the Settings page are saved to your user data folder and take priority
over `config.json`.

## Development

Requires [Node.js](https://nodejs.org/).

```bash
git clone <!-- TODO: your repo URL -->
cd saya
npm install
npm start
```

## Reporting issues

Found a bug or have a request? Open an [issue](../../issues). For bugs, please include your
Saya version (`saya://about`) and the site where it happened.

## Credits

Saya stands on the shoulders of great open source projects:

- [Electron](https://www.electronjs.org/) and [Chromium](https://www.chromium.org/), the foundation of the browser
- [uBlock Origin](https://github.com/gorhill/uBlock) scriptlets and filter lists, and the
  [Ghostery adblocker](https://github.com/ghostery/adblocker) engine <!-- TODO: confirm both against your Credits page -->

The full list of third-party packages and licenses is available at `saya://credits`.

## License

<!-- TODO: pick a license and add a LICENSE file, then fix this line -->

See [LICENSE](LICENSE).
