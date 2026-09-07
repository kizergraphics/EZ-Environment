# Local desktop build

Run `npm run desktop:dev` for the local editing build with Vite hot reload. Run `npm run desktop:pack` to build the library, application, and a Windows x64 portable executable in `release/`. Nothing is published. The original library `main`, `module`, and export paths remain intact; Electron's entry is supplied only to the packaged application through `extraMetadata`.

Launch `EZ-Environment-1.1.0-Portable.exe` directly from a writable folder. No installer, Node.js, browser installation, server, or Internet connection is needed. The portable launcher unpacks its bundled Chromium runtime to the Windows temporary directory. Settings and browser storage stay beside the executable in `EZ Environment Data`; carry that folder along with the executable to keep settings when moving it. Exported files are saved to the locations chosen in the normal Save dialog. Closing the application shuts down its runtime.

The desktop renderer loads `ez-environment://app/` from bundled resources. It has no Node.js APIs, preload bridge, or IPC filesystem access. The sandbox, context isolation, and web security are enabled. Remote requests, additional windows, external navigation, webviews, and permission requests are denied. A content security policy allows bundled code/assets and local blob workers, including WebAssembly for Draco. There are no update checks or telemetry. The development command makes a single exception for its exact `127.0.0.1` Vite origin.

`npm run test:desktop` verifies path confinement and request policy. After building the current app, `npm run test:desktop:smoke` launches real Electron, checks renderer isolation, local loading, blocked remote/file fetches, and local storage across restart. Pass `release/win-unpacked/EZ Environment.exe` as a positional argument to test the packaged runtime. Reports and screenshots are written under `artifacts/desktop/`; test profiles use uniquely named temporary folders.

The portable binary is unsigned. This local build uses no certificate, signing service, publisher, or installation registration. Windows may display its normal unknown-publisher prompt when the executable is moved to another machine.
