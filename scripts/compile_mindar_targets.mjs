import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT_URL = process.env.MINDAR_COMPILE_URL ?? "https://localhost:5173/";
const OUTPUT_PATH = resolve("public/targets/targets.mind");
const TARGETS = [
  "/targets/source-images/amihan.png",
  "/targets/source-images/apoy.png",
  "/targets/source-images/solido.png",
  "/targets/source-images/ulan.png"
];
const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
];

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function main() {
  const chromePath = await findExecutable(CHROME_CANDIDATES);

  if (!chromePath) {
    throw new Error("Chrome or Edge was not found.");
  }

  await assertDevServerReady(ROOT_URL);

  const browser = await launchChrome(chromePath);

  try {
    const target = await createPage(browser.port, ROOT_URL);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    cdp.on("Runtime.consoleAPICalled", (params) => {
      const values = params.args?.map((arg) => arg.value ?? arg.description).join(" ") ?? "";
      console.log(`Chrome ${params.type}: ${values}`);
    });
    await cdp.send("Page.navigate", { url: ROOT_URL });
    await waitForPageLoad(cdp);

    const promiseResult = await cdp.send("Runtime.evaluate", {
      awaitPromise: false,
      returnByValue: false,
      expression: createCompilerExpression(TARGETS)
    });

    if (promiseResult.exceptionDetails) {
      throw new Error(promiseResult.exceptionDetails.text ?? "MindAR compilation failed.");
    }

    const result = await awaitCompilerWithProgress(cdp, promiseResult.result.objectId);

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "MindAR compilation failed.");
    }

    const value = result.result?.value;

    if (!value?.base64) {
      throw new Error("MindAR compiler returned no target database.");
    }

    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, Buffer.from(value.base64, "base64"));
    console.log(`Compiled ${TARGETS.length} image targets to ${OUTPUT_PATH}`);
    console.log(`Target order: ${TARGETS.join(", ")}`);

    cdp.close();
  } finally {
    browser.process.kill();
  }
}

async function findExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      const response = await import("node:fs/promises").then((fs) => fs.access(candidate));
      void response;
      return candidate;
    } catch {
      // Try the next browser path.
    }
  }

  return null;
}

async function assertDevServerReady(url) {
  const response = await fetch(url, {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Dev server did not respond with OK at ${url}`);
  }
}

async function launchChrome(chromePath) {
  const port = 9222 + Math.floor(Math.random() * 1000);
  const chromeProcess = spawn(
    chromePath,
    [
      "--headless=new",
      "--enable-webgl",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--disable-dev-shm-usage",
      "--ignore-certificate-errors",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);

      if (response.ok) {
        return { port, process: chromeProcess };
      }
    } catch {
      // Chrome is still starting.
    }

    await delay(250);
  }

  chromeProcess.kill();
  throw new Error("Chrome did not expose a debugging endpoint.");
}

async function createPage(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT"
  });

  if (!response.ok) {
    throw new Error("Could not create Chrome page.");
  }

  return response.json();
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let messageId = 0;
  const pending = new Map();

  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.method) {
      const listeners = eventListeners.get(message.method) ?? [];
      listeners.forEach((listener) => listener(message.params));
    }

    if (!message.id) {
      return;
    }

    const request = pending.get(message.id);

    if (!request) {
      return;
    }

    pending.delete(message.id);

    if (message.error) {
      request.reject(new Error(message.error.message));
      return;
    }

    request.resolve(message.result);
  });

  const eventListeners = new Map();

  return {
    send(method, params = {}) {
      messageId += 1;
      const id = messageId;
      socket.send(JSON.stringify({ id, method, params }));

      return new Promise((resolveSend, rejectSend) => {
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
      });
    },
    waitForEvent(method) {
      return new Promise((resolveEvent) => {
        const listener = (event) => {
          const message = JSON.parse(event.data);

          if (message.method === method) {
            socket.removeEventListener("message", listener);
            resolveEvent(message.params);
          }
        };

        socket.addEventListener("message", listener);
      });
    },
    on(method, listener) {
      const listeners = eventListeners.get(method) ?? [];
      listeners.push(listener);
      eventListeners.set(method, listeners);
    },
    close() {
      socket.close();
    }
  };
}

async function waitForPageLoad(cdp) {
  await cdp.waitForEvent("Page.loadEventFired");
}

async function awaitCompilerWithProgress(cdp, promiseObjectId) {
  const startedAt = Date.now();
  const pendingResult = cdp.send("Runtime.awaitPromise", {
    promiseObjectId,
    returnByValue: true
  });

  for (;;) {
    const result = await Promise.race([pendingResult, delay(5000).then(() => null)]);

    if (result) {
      return result;
    }

    const progressResult = await cdp.send("Runtime.evaluate", {
      returnByValue: true,
      expression:
        "({ progress: Math.round((globalThis.__mindarCompileProgress ?? 0) * 10) / 10, stage: globalThis.__mindarCompileStage ?? 'unknown' })"
    });
    const progress = progressResult.result?.value?.progress ?? 0;
    const stage = progressResult.result?.value?.stage ?? "unknown";
    console.log(`MindAR compile stage: ${stage}; progress: ${progress}%`);

    if (Date.now() - startedAt > COMPILE_TIMEOUT_MS) {
      throw new Error(`MindAR compilation timed out after ${COMPILE_TIMEOUT_MS / 1000}s.`);
    }
  }
}

function createCompilerExpression(targets) {
  return `(globalThis.__mindarCompilePromise = (() => {
    const targets = ${JSON.stringify(targets)};

    function loadImage(src) {
      return new Promise((resolveImage, rejectImage) => {
        const image = new Image();
        image.onload = () => resolveImage(image);
        image.onerror = () => rejectImage(new Error("Could not load " + src));
        image.src = src + "?compile-cache-bust=" + Date.now();
      });
    }

    function bytesToBase64(bytes) {
      let binary = "";
      const chunkSize = 0x8000;

      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }

      return btoa(binary);
    }

    return (async () => {
      globalThis.__mindarCompileStage = "importing compiler";
      const { Compiler } = await import("/src/vendor/mindar/mindar-image.prod.js");
      globalThis.__mindarCompileStage = "creating compiler";
      const compiler = new Compiler();
      globalThis.__mindarCompileStage = "loading images";
      const images = await Promise.all(targets.map(loadImage));
      globalThis.__mindarCompileStage = "compiling";
      await compiler.compileImageTargets(images, (progress) => {
        globalThis.__mindarCompileProgress = progress;
      });
      globalThis.__mindarCompileStage = "exporting";
      const data = compiler.exportData();

      globalThis.__mindarCompileStage = "done";
      return { base64: bytesToBase64(data), bytes: data.length };
    })();
  })())`;
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

const COMPILE_TIMEOUT_MS = 8 * 60 * 1000;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
