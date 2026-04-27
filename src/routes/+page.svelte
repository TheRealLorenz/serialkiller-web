<script lang="ts">
  import { getUsbName } from "../lib/usbIds";

  const INITIAL_BUFFER_SIZE = 4096;

  type Status = {
    message: string;
    state: "ok" | "loading" | "error";
  };

  type LineEnding = "cr" | "lf" | "crlf";

  let connected = $state(false);
  let port = $state<SerialPort | null>(null);
  const portInfo = $derived.by(async () => {
    const info = port.getInfo();
    if (!info.usbVendorId || !info.usbProductId) {
      return "Unknown device";
    }

    const usbName =
      (await getUsbName(info.usbVendorId, info.usbProductId)) ??
      "Unknown device";

    return usbName;
  });

  let baudRate = $state(115200);
  let lineEnding = $state<LineEnding>("crlf");
  let hexOutput = $state(false);
  let status = $state<Status>({ message: "Select a port", state: "loading" });

  let outputBuffer = $state<Uint8Array>(new Uint8Array(INITIAL_BUFFER_SIZE));
  let bufferLen = 0;
  let output = $derived.by(() => {
    const slice = outputBuffer.subarray(0, bufferLen);

    if (hexOutput) {
      return toXXD(slice);
    }

    const text = new TextDecoder().decode(slice);

    switch (lineEnding) {
      case "cr":
        return text.replace(/\r/g, "\n");
      case "lf":
        return text;
      case "crlf":
        return text.replace(/\r\n/g, "\n");
    }
  });
  let input = $state("");

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let abortController: AbortController | null = null;

  const bauds = [9600, 115200, 230400, 460800, 921600];

  function toXXD(bytes: Uint8Array): string {
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.subarray(i, i + 16);

      // offset
      const offset = i.toString(16).padStart(8, "0");

      // hex: groups of 2 bytes, extra space in the middle
      const hex = Array.from({ length: 16 }, (_, j) => {
        if (j >= chunk.length) return "  ";
        const byte = chunk[j].toString(16).padStart(2, "0");
        return byte;
      })
        .reduce<string[]>((acc, h, j) => {
          if (j % 2 === 0) acc.push(h);
          else acc[acc.length - 1] += h;
          return acc;
        }, [])
        .map((group, j) => (j === 4 ? " " + group : group))
        .join(" ");

      // ascii: printable chars or dot
      const ascii = Array.from(chunk)
        .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
        .join("");

      lines.push(`${offset}: ${hex.padEnd(39)}  ${ascii}`);
    }
    return lines.join("\n");
  }

  function outputAppendChunk(chunk: Uint8Array) {
    if (bufferLen + chunk.byteLength > outputBuffer.byteLength) {
      let newSize = outputBuffer.byteLength;
      while (newSize < bufferLen + chunk.byteLength) newSize *= 2;
      const newBuffer = new Uint8Array(newSize);
      newBuffer.set(outputBuffer);
      outputBuffer = newBuffer;
    }
    outputBuffer.set(chunk, bufferLen);
    bufferLen += chunk.byteLength;
  }

  async function requestPort() {
    if (!("serial" in navigator)) {
      setStatus("Web Serial API not supported. Use Chrome/Edge.", "error");
      return;
    }
    port = await navigator.serial.requestPort();

    setStatus(port ? "Port selected" : "No port selected", "loading");
  }

  async function toggleConnect() {
    if (connected) {
      await disconnect();
    } else {
      await connect();
    }
  }

  async function connect() {
    if (!port) {
      port = await navigator.serial.requestPort();
      if (!port) {
        setStatus("No port selected", "loading");
        return;
      }
    }

    if (port.readable) {
      setStatus("Port already open", "error");
      return;
    }

    try {
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none" });
      abortController = new AbortController();
      reader = port.readable.getReader();
      writer = port.writable.getWriter();
      connected = true;
      setStatus(`Connected at ${baudRate} baud`, "ok");
      readLoop();
    } catch (e: any) {
      port = null;
      setStatus(`Error: ${e.message}`, "error");
    }
  }

  async function disconnect() {
    abortController?.abort();
    abortController = null;

    if (reader) {
      try {
        reader.cancel();
      } catch {}
      reader.releaseLock();
      reader = null;
    }
    if (writer) {
      writer.releaseLock();
      writer = null;
    }
    if (port) {
      await port.close();
      port = null;
    }
    connected = false;
    setStatus("Disconnected", "error");
  }

  async function readLoop() {
    while (reader) {
      try {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          outputAppendChunk(value);
          // const text = hexOutput
          //   ? Array.from(value)
          //       .map((b) => b.toString(16).padStart(2, "0"))
          //       .join(" ")
          //   : new TextDecoder().decode(value);
          // append(text);
        }
      } catch {
        break;
      }
    }
  }

  async function send() {
    if (!writer || !input) return;
    let data = input;

    switch (lineEnding) {
      case "cr":
        data += "\r";
        break;
      case "lf":
        data += "\n";
        break;
      case "crlf":
        data += "\r\n";
        break;
    }
    await writer.write(new TextEncoder().encode(data));
    input = "";
  }

  function clear() {
    outputBuffer = new Uint8Array(INITIAL_BUFFER_SIZE);
    bufferLen = 0;
  }

  function setStatus(message: string, state: Status["state"]) {
    status = { message, state };
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") send();
  }

  $effect(() => {
    // if (output) {
    //   const el = document.getElementById("terminal");
    //   if (el) el.scrollTop = el.scrollHeight;
    // }
  });
</script>

<div class="flex flex-col h-dvh bg-slate-900 text-slate-100 font-mono">
  <!-- Header -->
  <header
    class="flex flex-wrap items-center gap-3 px-4 py-3 bg-slate-800 border-b border-slate-700 shadow-lg"
  >
    <div class="flex items-center gap-2">
      <button
        class="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md {connected
          ? 'bg-red-500 hover:bg-red-600 active:bg-red-700'
          : 'bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700'}"
        onclick={toggleConnect}
        disabled={!port && !connected}
      >
        {connected ? "Disconnect" : "Connect"}
      </button>

      {#if port}
        {#await portInfo then info}
          <select
            onclick={requestPort}
            value={"placeholder"}
            class="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm border-0 cursor-pointer focus:ring-2 focus:ring-emerald-500"
          >
            <option value="placeholder">{info}</option>
          </select>
        {/await}
      {:else}
        <button
          class="px-3 py-2 bg-slate-700 hover:bg-slate-600 active:bg-slate-500 rounded-lg text-sm transition-colors shadow-md"
          onclick={requestPort}
        >
          Select Port
        </button>
      {/if}
    </div>

    <div class="h-6 w-px bg-slate-600"></div>

    <div class="flex items-center gap-2">
      <span class="text-xs text-slate-400 uppercase tracking-wider">Baud</span>
      <select
        bind:value={baudRate}
        disabled={connected}
        class="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm border-0 cursor-pointer focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {#each bauds as b}
          <option value={b}>{b}</option>
        {/each}
      </select>
    </div>

    <div class="flex items-center gap-2">
      <span class="text-xs text-slate-400 uppercase tracking-wider">Line</span>
      <select
        bind:value={lineEnding}
        class="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm border-0 cursor-pointer focus:ring-2 focus:ring-emerald-500"
      >
        <option value="cr">CR</option>
        <option value="lf">LF</option>
        <option value="crlf">CRLF</option>
      </select>
    </div>

    <label class="flex items-center gap-2 text-sm cursor-pointer ml-2">
      <input
        type="checkbox"
        bind:checked={hexOutput}
        class="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
      />
      <span class="text-slate-300">Hex</span>
    </label>

    <button
      class="px-3 py-2 bg-slate-700 hover:bg-slate-600 active:bg-slate-500 rounded-lg text-sm ml-auto transition-colors shadow-md"
      onclick={clear}
    >
      Clear
    </button>
  </header>

  <!-- Status Bar -->
  <div
    class="px-4 py-2 bg-slate-800/50 border-b border-slate-700/50 flex items-center gap-2"
  >
    <div
      class="w-2 h-2 rounded-full {status.state === 'ok'
        ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
        : status.state === 'loading'
          ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
          : 'bg-red-400 shadow-[0_0_8px_rgba(251,36,130,0.8)]'}"
    ></div>
    <span
      class="text-sm {status.state === 'ok'
        ? 'text-emerald-400'
        : status.state === 'loading'
          ? 'text-amber-400'
          : 'text-red-400'}">{status.message}</span
    >
  </div>

  <!-- Terminal -->
  <div
    id="terminal"
    class="flex-1 overflow-auto p-4 bg-slate-950 text-emerald-400 whitespace-pre-wrap break-all text-sm leading-relaxed font-light"
  >
    {#if !output}
      <span class="text-slate-600">Waiting for data...</span>
    {:else}
      {output}
    {/if}
  </div>

  <!-- Input -->
  <div
    class="flex gap-3 p-4 bg-slate-800 border-t border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.3)]"
  >
    <input
      type="text"
      bind:value={input}
      onkeydown={handleKeydown}
      placeholder="Type message to send..."
      disabled={!connected}
      class="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 focus:bg-slate-600 rounded-xl text-sm border-0 outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    />
    <button
      class="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 rounded-xl text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl active:shadow-md"
      onclick={send}
      disabled={!connected || !input}
    >
      Send
    </button>
  </div>
</div>
