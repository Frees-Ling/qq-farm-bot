# QQ Farm Login Routes

This note records the currently known QQ Classic Farm login routes and why the
project uses phone-runtime code capture as the executable path.

## Route Matrix

| Route | Result | Notes |
| --- | --- | --- |
| `q.qq.com/ide` QR login | Not reliable | The QR can be scanned and may return a ticket, but `q.qq.com/ide/login` currently returns `-3000` for Farm code exchange. |
| QQ Connect OAuth / web QQ cookies | Not sufficient | These prove web QQ identity only. They do not produce the Farm `gate-obt` login code. |
| QQ bot APPID / secret | Not applicable | Bot credentials belong to bot/open-platform APIs, not QQ Classic Farm mini-app runtime login. |
| Account/password protocol emulation | Not executable here | Mobile QQ login has device fingerprinting, signatures, encryption, and risk checks. Reimplementing it is brittle and high-risk. |
| Server Linux QQ mini-app patch | Possible with desktop runtime | Works only when a real Linux QQ mini-app cache exists on the server. It is not suitable for headless Ubuntu users who cannot run QQ desktop. |
| Phone proxy / Android runtime capture | Executable | A real mobile QQ opens QQ Classic Farm. The Farm runtime creates `wss://gate-obt.nqf.qq.com/prod/ws?...code=...`; the server captures that code and creates the account. |

## Current Executable Route

1. User opens the panel and starts QQ scan login.
2. The panel creates the QQ QR and starts one-shot phone proxy capture.
3. User scans and confirms with mobile QQ.
4. User immediately opens QQ Classic Farm once on the phone.
5. The phone runtime connects to `gate-obt.nqf.qq.com/prod/ws`.
6. The mitmproxy addon captures the `code` query parameter.
7. `/api/code-capture` creates or updates the account.
8. The capture session exits.

## Diagnostic Meaning

`-3000` means the old web/IDE ticket-to-Farm-code exchange failed. It does not
prove the phone proxy capture route failed.

The phone proxy logs should be read in this order:

1. `phone proxy capture loaded` means mitmproxy and the addon started.
2. `phone proxy client connected` means a phone reached the server proxy.
3. `phone proxy CONNECT target host=gate-obt.nqf.qq.com` means the phone tried
   to reach Farm gate through the proxy.
4. `phone proxy decrypted host=gate-obt.nqf.qq.com path=/prod/ws` means the phone
   trusts the mitmproxy certificate and the request was decrypted.
5. `forwarded username=... response={"ok":true,...}` means the Farm code was
   forwarded to the panel and the account was created or updated.

If step 2 is missing, the phone is not using the proxy.
If step 3 is missing, QQ Farm was not opened through that proxy.
If step 4 is missing but step 3 exists, the phone or QQ runtime is not trusting
the mitmproxy certificate.
