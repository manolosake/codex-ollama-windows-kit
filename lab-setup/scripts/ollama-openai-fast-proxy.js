#!/usr/bin/env node
"use strict";

const http = require("http");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith("--")) {
    continue;
  }
  const value = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[++i]
    : "true";
  args.set(key.slice(2), value);
}

const port = Number(args.get("port") || process.env.OLLAMA_FAST_PROXY_PORT || 11435);
const target = new URL(args.get("target") || process.env.OLLAMA_FAST_PROXY_TARGET || "http://127.0.0.1:11434");
const fastModel = args.get("fast-model") || args.get("model") || process.env.OLLAMA_FAST_PROXY_MODEL || "fredrezones55/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive:latest";
const thinkModel = args.has("think-model") ? args.get("think-model") : (process.env.OLLAMA_FAST_PROXY_THINK_MODEL || "");
const defaultModel = fastModel;
const version = "25";
const legacyFastAliases = [
  "qwen36-35b-fast:latest",
  "qwen36-35b-smartfast:latest",
];
const legacyThinkAliases = [
  "qwen36-35b-think:latest",
];

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function modelKey(model) {
  const text = String(model || "").toLowerCase();
  return text.endsWith(":latest") ? text.slice(0, -7) : text;
}

function resolveModel(requestedModel) {
  const requested = requestedModel || defaultModel;
  const key = modelKey(requested);
  const hasThinkModel = Boolean(thinkModel);
  if (hasThinkModel && key === modelKey(thinkModel)) {
    return { model: thinkModel, think: true, auxiliary: false };
  }
  if (legacyThinkAliases.some((alias) => key === modelKey(alias))) {
    return { model: fastModel, think: true, auxiliary: false };
  }
  if (key === modelKey(fastModel)) {
    return { model: fastModel, think: false, auxiliary: false };
  }
  if (legacyFastAliases.some((alias) => key === modelKey(alias))) {
    return { model: fastModel, think: false, auxiliary: false };
  }
  return { model: fastModel, think: false, auxiliary: true };
}

function listedModels() {
  const models = [{ id: fastModel, think: false }];
  if (thinkModel && modelKey(thinkModel) !== modelKey(fastModel)) {
    models.push({ id: thinkModel, think: true });
  }
  return models;
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function sendError(res, status, message) {
  sendJson(res, status, {
    error: {
      message,
      type: "ollama_fast_proxy_error",
      code: status,
    },
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return { text: content, images: [] };
  }
  if (!Array.isArray(content)) {
    return { text: content == null ? "" : String(content), images: [] };
  }

  const textParts = [];
  const images = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    if ((part.type === "text" || part.type === "input_text") && typeof part.text === "string") {
      textParts.push(part.text);
    }
    if (part.type === "image_url" && part.image_url?.url) {
      const url = String(part.image_url.url);
      const match = url.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (match) {
        images.push(match[1]);
      } else {
        textParts.push(`[image_url: ${url}]`);
      }
    }
    if ((part.type === "input_image" || part.type === "image") && part.image_url) {
      const url = String(part.image_url);
      const match = url.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (match) {
        images.push(match[1]);
      } else {
        textParts.push(`[image_url: ${url}]`);
      }
    }
  }
  return { text: textParts.join("\n"), images };
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const role = message.role === "developer" ? "system" : (message.role || "user");
    const { text, images } = normalizeContent(message.content);
    const out = { role, content: text };
    if (images.length > 0) {
      out.images = images;
    }
    if (message.tool_call_id) {
      out.tool_call_id = message.tool_call_id;
    }
    if (message.tool_calls) {
      out.tool_calls = message.tool_calls;
    }
    return out;
  });
}

function responseInputToMessages(body) {
  const messages = [];
  if (body.instructions) {
    messages.push({ role: "system", content: String(body.instructions) });
  }
  if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
    return messages;
  }
  for (const item of Array.isArray(body.input) ? body.input : []) {
    if (item?.type === "message") {
      const role = item.role === "developer" ? "system" : (item.role || "user");
      const { text, images } = normalizeContent(item.content);
      messages.push(images.length > 0 ? { role, content: text, images } : { role, content: text });
    } else if (item?.type === "function_call") {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: item.call_id || item.id,
          function: {
            name: ollamaToolName(item.name),
            arguments: ollamaToolArguments(item.name, item.arguments),
          },
        }],
      });
    } else if (item?.type === "function_call_output") {
      messages.push({
        role: "tool",
        content: String(item.output || ""),
        tool_call_id: item.call_id,
      });
    }
  }
  return messages;
}

function parseJsonObject(value) {
  if (value && typeof value === "object") {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function ollamaToolName(name) {
  return name === "exec_command" || name === "shell" ? "shell_command" : name;
}

function codexToolName(name, shellTarget = "exec_command") {
  return name === "shell_command" ? shellTarget : name;
}

function ollamaToolArguments(name, args) {
  const parsed = parseJsonObject(args);
  if (name !== "exec_command" && name !== "shell") {
    return parsed;
  }
  const out = { ...parsed };
  if (out.command == null && out.cmd != null) {
    out.command = out.cmd;
  }
  delete out.cmd;
  return out;
}

function codexToolArguments(name, args, shellArgumentName = "cmd") {
  const parsed = parseJsonObject(args);
  if (name !== "shell_command") {
    return parsed;
  }
  const out = { ...parsed };
  const value = out.command ?? out.cmd;
  if (shellArgumentName === "command") {
    out.command = value;
    delete out.cmd;
  } else {
    out.cmd = value;
    delete out.command;
  }
  return out;
}

function messageChars(messages) {
  return messages.reduce((sum, message) => sum + String(message.content || "").length, 0);
}

function removeTaggedBlock(text, tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
  return text.replace(pattern, "");
}

function cleanLatestUserContent(content) {
  let text = String(content || "");
  text = removeTaggedBlock(text, "environment_context");
  text = removeTaggedBlock(text, "INSTRUCTIONS");
  text = removeTaggedBlock(text, "system");
  text = text.replace(/^# AGENTS\.md instructions[\s\S]*?(?=\r?\n\r?\n|$)/gim, "");
  text = text.replace(/^\s*<[^>\n]+>\s*$/gim, "");
  text = text.replace(/^\s*(cwd|shell|timezone|current_date)\s*[:=].*$/gim, "");

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("{\"timestamp\""))
    .filter((line) => !line.startsWith("Context automatically compacted"))
    .filter((line) => !line.startsWith("Ran "))
    .filter((line) => !line.startsWith("Worked for "))
    .filter((line) => !line.startsWith("Reconnecting..."))
    .filter((line) => !line.startsWith("stream disconnected before completion"));

  const cleaned = (lines.length > 0 ? lines.join("\n") : text.trim()).trim();
  if (cleaned.length <= 2000) {
    return cleaned || "hola";
  }
  return cleaned.slice(-2000).replace(/^[^\n]*\n/, "").trim() || cleaned.slice(-2000);
}

function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return cleanLatestUserContent(messages[index].content);
    }
  }
  return cleanLatestUserContent(messages[messages.length - 1]?.content || "");
}

function shouldExposeTools(messages) {
  const text = latestUserText(messages).toLowerCase();
  const toolOutputs = messages.filter((message) => message.role === "tool").length;
  const toolBudget = toolBudgetFor(text);
  if (toolOutputs >= toolBudget) {
    return false;
  }
  if (messages.some((message) => message.role === "tool" || message.tool_calls)) {
    return true;
  }
  if (!text.trim()) {
    return false;
  }
  return /\b(revisa|checa|verifica|inspecciona|analiza|diagnostica|monitorea|observa|busca|encuentra|lee|lista|muestra|abre|crea|haz|genera|edita|modifica|corrige|arregla|instala|actualiza|borra|elimina|ejecuta|corre|prueba|test|compila|inicia|deten|reinicia|conecta|descarga|clona|configura|prepara|mueve|copia|renombra|comando|terminal|powershell|cmd|archivo|carpeta|directorio|proyecto|repo|log|proceso|servicio|puerto|ollama|codex|kali|hyper-v|vm|gpu|windows|sistema|computadora|configuracion|configuración|dir|pwd|ls|npm|node|python|git)\b/i.test(text);
}

function isHardwareSpecsRequest(text) {
  return /\b(specs?|especificaciones|hardware|configuracion|configuración|esta compu|computadora|pc|laptop|cpu|ram|gpu|disco|storage|almacenamiento)\b/i.test(text);
}

function toolBudgetFor(text) {
  if (isHardwareSpecsRequest(text)) {
    return 1;
  }
  if (/\b(a fondo|profundo|debug|depura|corrige|arregla|hasta que|tests?|pruebas?|instala|implementa|refactoriza)\b/i.test(text)) {
    return 6;
  }
  return 3;
}

const hardwareSpecsCommand = `powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $memType=@{20='DDR';21='DDR2';22='DDR2 FB-DIMM';24='DDR3';26='DDR4';30='LPDDR4';34='DDR5';35='LPDDR5'}; $o=[ordered]@{ Computer=(Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,TotalPhysicalMemory,HypervisorPresent); CPU=(Get-CimInstance Win32_Processor | Select-Object Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,SecondLevelAddressTranslationExtensions,VirtualizationFirmwareEnabled,VMMonitorModeExtensions); RAM=(Get-CimInstance Win32_PhysicalMemory | Select-Object Manufacturer,PartNumber,Capacity,Speed,ConfiguredClockSpeed,SMBIOSMemoryType,@{Name='MemoryTypeName';Expression={$memType[[int]$_.SMBIOSMemoryType]}}); Disks=(Get-CimInstance Win32_DiskDrive | Select-Object Model,InterfaceType,MediaType,Size,SerialNumber); GPU=(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution); OS=(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture); BIOS=(Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,SerialNumber); Battery=(Get-CimInstance Win32_Battery | Select-Object Name,BatteryStatus,EstimatedChargeRemaining) }; $o | ConvertTo-Json -Depth 5 -Compress"`;

function safetyResponseFor(text) {
  const normalized = String(text || "").toLowerCase();
  const asksForSteps = /(pasos|detalle|detall|instrucciones|como|cómo|crear|fabricar|hacer|construir|montar|diseñar)/i.test(normalized);
  const catastrophic = /(bomba\s+nuclear|arma\s+nuclear|uranio[-\s]?235|plutonio[-\s]?239|material\s+fisible|explosivo\s+nuclear|arma\s+biologica|arma\s+biológica|arma\s+quimica|arma\s+química)/i.test(normalized);
  if (asksForSteps && catastrophic) {
    return "No puedo ayudar con instrucciones para fabricar armas nucleares, químicas o biológicas. Sí puedo ayudarte con seguridad, historia, tratados, física nuclear a nivel educativo o prevención de riesgos.";
  }
  return "";
}

function identityResponseFor(text) {
  const normalized = String(text || "").toLowerCase();
  const asksIdentity = /(quien eres|quién eres|que eres|qué eres|llm|modelo|motor|respalda|corriendo|ejecutando|eres llama|eres qwen|eres codex)/i.test(normalized);
  if (!asksIdentity) {
    return "";
  }
  return [
    "Soy Codex ejecutandose en el perfil local de Ollama.",
    `El modelo local configurado y anunciado por el proxy es: ${fastModel}`,
    "Si pregunto internamente y contesto otro nombre, eso seria una alucinacion del modelo, no la configuracion real.",
  ].join("\n");
}

function staticResponseFor(text) {
  return safetyResponseFor(text) || identityResponseFor(text);
}

function compactFastMessages(messages, resolved, options = {}) {
  if (resolved.think) {
    return messages;
  }
  const hasToolHistory = messages.some((message) => message.role === "tool" || message.tool_calls);
  if (!options.allowTools && hasToolHistory) {
    const recent = messages
      .filter((message) => ["user", "assistant", "tool"].includes(message.role))
      .slice(-10)
      .map((message) => ({
        ...message,
        content: String(message.content || "").slice(-5000),
      }));
    return [
      {
        role: "system",
        content: [
          "/no_think",
          "You are Codex running locally through Ollama.",
          `The actual local model is ${fastModel}.`,
          "You already have tool output in this conversation.",
          "No more tools are available for this step.",
          "Use only the available tool outputs and answer the user directly in their language.",
          "Do not ask to run more commands. Do not invent missing hardware details; say unknown when data is absent.",
          "For hardware answers, do not infer RAM type from speed; mention DDR/LPDDR only when MemoryTypeName is present.",
          "Do not add gaming/productivity/value judgments unless the user asks for recommendations.",
          "Do not think out loud.",
        ].join("\n"),
      },
      ...recent,
      {
        role: "user",
        content: "/no_think\nUse the tool output already shown above and provide the final answer now.",
      },
    ];
  }
  if (options.allowTools) {
    const toolNames = Array.isArray(options.toolNames) ? options.toolNames : [];
    const preferredShellTool = toolNames.includes("exec_command")
      ? "exec_command"
      : (toolNames.includes("shell_command") ? "shell_command" : "");
    const recent = messages
      .filter((message) => ["user", "assistant", "tool"].includes(message.role))
      .slice(-10)
      .map((message) => ({
        ...message,
        content: String(message.content || "").slice(-5000),
      }));
    return [
      {
        role: "system",
        content: [
          "/no_think",
          "You are Codex running locally through Ollama.",
          `The actual local model is ${fastModel}.`,
          `Available tool names: ${toolNames.join(", ") || "none"}.`,
          "Use exact tool names from the available list.",
          "Use the provided tools when the user asks you to inspect files, run commands, modify the workspace, install software, diagnose the machine, or verify facts from the local environment.",
          "Do not use tools for greetings, thanks, short conversation, or questions you can answer without seeing the workspace.",
          "When the next step requires a tool, emit exactly one tool call instead of explaining that you will use a tool.",
          preferredShellTool
            ? `For shell work, call ${preferredShellTool} with JSON arguments such as command, workdir, timeout_ms, and yield_time_ms.`
            : "For shell work, choose the available terminal/shell execution tool.",
          preferredShellTool
            ? `For PC specs or hardware configuration requests, call ${preferredShellTool} exactly once using this exact command argument: ${hardwareSpecsCommand}`
            : `For PC specs or hardware configuration requests, call the shell tool exactly once using this exact command argument: ${hardwareSpecsCommand}`,
          "For hardware answers, report only fields found in tool output; do not infer RAM size, RAM type, GPU VRAM, or storage facts when missing.",
          "Do not add gaming/productivity/value judgments to hardware answers unless the user asks for recommendations.",
          "After tool output is returned, answer the user directly in their language.",
          "Do not think out loud.",
        ].join("\n"),
      },
      ...recent,
    ];
  }
  const userText = latestUserText(messages);
  return [
    {
      role: "system",
      content: [
        "/no_think",
        "You are Codex running locally through Ollama.",
        `The actual local model is ${fastModel}.`,
        "Answer the latest user request directly in the user's language.",
        "Return final text only. Do not think out loud.",
        "If the request needs tools but no tool schema is available, explain that tools are not available for this turn.",
        "Do not provide operational instructions for weapons, explosives, or CBRN harm.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `/no_think\n${userText}\n\nAnswer now with final text only.`,
    },
  ];
}

function convertResponsesTools(tools) {
  const converted = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool || tool.type !== "function") {
      continue;
    }
    const source = tool.function && typeof tool.function === "object" ? tool.function : tool;
    const name = source.name;
    if (!name) {
      continue;
    }
    const convertedName = ollamaToolName(name);
    const parameters = convertedName === "shell_command" && (name === "exec_command" || name === "shell")
      ? {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to run" },
            workdir: { type: "string", description: "Working directory" },
            timeout_ms: { type: "number", description: "Maximum time in milliseconds" },
            yield_time_ms: { type: "number", description: "Time before yielding output" },
            max_output_tokens: { type: "number", description: "Maximum output tokens to return" },
          },
          required: ["command"],
        }
      : (source.parameters || { type: "object", properties: {} });
    converted.push({
      type: "function",
      function: {
        name: convertedName,
        description: source.description || "",
        parameters,
      },
    });
  }
  const shellTool = converted.find((tool) => tool.function?.name === "shell_command");
  return shellTool ? [shellTool] : converted;
}

function responseToolNames(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) => tool?.type === "function")
    .map((tool) => {
      const source = tool.function && typeof tool.function === "object" ? tool.function : tool;
      return source.name;
    })
    .filter(Boolean);
}

function shellArgumentNameFor(tools, shellTarget) {
  const tool = (Array.isArray(tools) ? tools : []).find((candidate) => {
    if (!candidate || candidate.type !== "function") {
      return false;
    }
    const source = candidate.function && typeof candidate.function === "object" ? candidate.function : candidate;
    return source.name === shellTarget;
  });
  const source = tool?.function && typeof tool.function === "object" ? tool.function : tool;
  const properties = source?.parameters?.properties || {};
  if (Object.prototype.hasOwnProperty.call(properties, "command")) {
    return "command";
  }
  if (Object.prototype.hasOwnProperty.call(properties, "cmd")) {
    return "cmd";
  }
  return shellTarget === "shell_command" ? "command" : "cmd";
}

function buildOptions(body, resolved, hasTools = false) {
  const options = {};
  const copies = [
    ["temperature", "temperature"],
    ["top_p", "top_p"],
    ["top_k", "top_k"],
    ["presence_penalty", "presence_penalty"],
    ["frequency_penalty", "frequency_penalty"],
    ["repeat_penalty", "repeat_penalty"],
    ["num_ctx", "num_ctx"],
  ];
  for (const [from, to] of copies) {
    if (body[from] != null) {
      options[to] = body[from];
    }
  }
  if (body.max_tokens != null) {
    options.num_predict = Number(body.max_tokens);
  }
  if (options.num_predict == null) {
    options.num_predict = resolved.think ? 2048 : 768;
  }
  if (Number.isFinite(options.num_predict)) {
    options.num_predict = Math.min(options.num_predict, resolved.think ? 2048 : 768);
  } else {
    options.num_predict = resolved.think ? 2048 : 768;
  }
  if (options.num_ctx == null) {
    options.num_ctx = resolved.think ? 8192 : 3072;
  } else if (Number.isFinite(Number(options.num_ctx))) {
    options.num_ctx = Math.min(Number(options.num_ctx), resolved.think ? 8192 : 3072);
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function buildOllamaBody(body, messages) {
  const resolved = resolveModel(body.model);
  const originalToolNames = responseToolNames(body.tools);
  const exposeTools = shouldExposeTools(messages);
  const convertedTools = exposeTools ? convertResponsesTools(body.tools) : [];
  const toolNames = convertedTools.map((tool) => tool.function?.name).filter(Boolean);
  const shellTarget = originalToolNames.includes("exec_command")
    ? "exec_command"
    : (originalToolNames.includes("shell") ? "shell" : (originalToolNames.includes("shell_command") ? "shell_command" : "exec_command"));
  const shellArgumentName = shellArgumentNameFor(body.tools, shellTarget);
  const compactedMessages = compactFastMessages(messages, resolved, { allowTools: convertedTools.length > 0, toolNames });
  const ollamaBody = {
    model: resolved.model,
    messages: compactedMessages,
    stream: Boolean(body.stream),
    think: resolved.think,
  };
  Object.defineProperty(ollamaBody, "_proxyAuxiliary", {
    value: resolved.auxiliary,
    enumerable: false,
  });
  Object.defineProperty(ollamaBody, "_proxyStaticResponse", {
    value: safetyResponseFor(latestUserText(compactedMessages)),
    enumerable: false,
  });
  const options = buildOptions(body, resolved, convertedTools.length > 0);
  if (options) {
    ollamaBody.options = options;
  }
  if (convertedTools.length > 0) {
    ollamaBody.tools = convertedTools;
  }
  Object.defineProperty(ollamaBody, "_proxyToolNames", {
    value: toolNames,
    enumerable: false,
  });
  Object.defineProperty(ollamaBody, "_proxyCodexShellTool", {
    value: shellTarget,
    enumerable: false,
  });
  Object.defineProperty(ollamaBody, "_proxyCodexShellArgument", {
    value: shellArgumentName,
    enumerable: false,
  });
  if (body.response_format?.type === "json_object") {
    ollamaBody.format = "json";
  }
  ollamaBody.keep_alive = "10m";
  return ollamaBody;
}

function postOllama(path, body, onResponse) {
  const json = JSON.stringify(body);
  const req = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    path,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(json),
    },
  }, onResponse);
  req.on("error", (error) => onResponse(null, error));
  req.end(json);
  return req;
}

function abortUpstreamOnClientClose(res, upstreamReq) {
  res.on("close", () => {
    if (!res.writableEnded) {
      upstreamReq.destroy(new Error("client disconnected"));
    }
  });
}

function writeSse(res, event, data) {
  if (event) {
    res.write(`event: ${event}\n`);
  }
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

function openAiChunk(id, model, delta, finishReason = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function parsedTextDelta(parsed) {
  const value = parsed.message?.content ?? parsed.response ?? parsed.content ?? parsed.delta ?? "";
  return typeof value === "string" ? value : "";
}

function streamStaticChatCompletion(res, model, text) {
  const id = `chatcmpl_${Date.now()}`;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  writeSse(res, null, openAiChunk(id, model, { role: "assistant" }));
  if (text) {
    writeSse(res, null, openAiChunk(id, model, { content: text }));
  }
  writeSse(res, null, openAiChunk(id, model, {}, "stop"));
  writeSse(res, null, "[DONE]");
  res.end();
}

function streamChatCompletion(res, body, ollamaBody) {
  const id = `chatcmpl_${Date.now()}`;
  const model = ollamaBody.model;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  writeSse(res, null, openAiChunk(id, model, { role: "assistant" }));

  const start = Date.now();
  log(`stream chat model=${model} think=${ollamaBody.think} chars=${messageChars(ollamaBody.messages)}`);
  const upstreamReq = postOllama("/api/chat", ollamaBody, (upstream, error) => {
    if (error || !upstream) {
      writeSse(res, null, { error: { message: error?.message || "Ollama connection failed" } });
      writeSse(res, null, "[DONE]");
      res.end();
      return;
    }
    let buffer = "";
    upstream.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        const parsed = JSON.parse(line);
        const content = parsedTextDelta(parsed);
        if (content) {
          writeSse(res, null, openAiChunk(id, model, { content }));
        }
        if (parsed.message?.tool_calls) {
          writeSse(res, null, openAiChunk(id, model, { tool_calls: parsed.message.tool_calls }));
        }
        if (parsed.done) {
          log(`done stream chat model=${model} seconds=${((Date.now() - start) / 1000).toFixed(2)}`);
          writeSse(res, null, openAiChunk(id, model, {}, parsed.done_reason || "stop"));
          writeSse(res, null, "[DONE]");
          res.end();
        }
      }
    });
    upstream.on("error", (streamError) => {
      writeSse(res, null, { error: { message: streamError.message } });
      writeSse(res, null, "[DONE]");
      res.end();
    });
  });
  abortUpstreamOnClientClose(res, upstreamReq);
}

function chatCompletionResponse(native, model) {
  const content = native.message?.content || "";
  const message = { role: "assistant", content };
  if (native.message?.tool_calls) {
    message.tool_calls = native.message.tool_calls;
  }
  const promptTokens = native.prompt_eval_count || 0;
  const completionTokens = native.eval_count || 0;
  return {
    id: `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: native.done_reason || "stop" }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

async function handleChatCompletions(req, res) {
  const body = JSON.parse(await readBody(req) || "{}");
  const messages = normalizeMessages(body.messages);
  const ollamaBody = buildOllamaBody(body, messages);
  if (ollamaBody._proxyStaticResponse) {
    if (body.stream) {
      streamStaticChatCompletion(res, ollamaBody.model, ollamaBody._proxyStaticResponse);
      return;
    }
    sendJson(res, 200, chatCompletionResponse({ message: { content: ollamaBody._proxyStaticResponse } }, ollamaBody.model));
    return;
  }
  if (body.stream) {
    streamChatCompletion(res, body, ollamaBody);
    return;
  }
  const start = Date.now();
  log(`chat model=${ollamaBody.model} think=${ollamaBody.think} chars=${messageChars(ollamaBody.messages)}`);
  const upstreamReq = postOllama("/api/chat", ollamaBody, (upstream, error) => {
    if (error || !upstream) {
      sendError(res, 502, error?.message || "Ollama connection failed");
      return;
    }
    let raw = "";
    upstream.on("data", (chunk) => { raw += chunk; });
    upstream.on("end", () => {
      if (upstream.statusCode && upstream.statusCode >= 400) {
        sendError(res, upstream.statusCode, raw);
        return;
      }
      log(`done chat model=${ollamaBody.model} seconds=${((Date.now() - start) / 1000).toFixed(2)}`);
      sendJson(res, 200, chatCompletionResponse(JSON.parse(raw), ollamaBody.model));
    });
  });
  abortUpstreamOnClientClose(res, upstreamReq);
}

function responsesPayload(native, model) {
  const text = native.message?.content || "";
  const output = [{
    id: `msg_${Date.now()}`,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  }];
  return responsesPayloadForOutput(output, model, native);
}

function responsesPayloadForOutput(output, model, native = {}) {
  const text = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .map((part) => part.text || "")
    .join("");
  return {
    id: `resp_${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output,
    output_text: text,
    usage: {
      input_tokens: native.prompt_eval_count || 0,
      output_tokens: native.eval_count || 0,
      total_tokens: (native.prompt_eval_count || 0) + (native.eval_count || 0),
    },
  };
}

function responseFunctionCallItems(toolCalls, shellTarget = "exec_command", shellArgumentName = "cmd") {
  return (Array.isArray(toolCalls) ? toolCalls : []).map((toolCall, index) => {
    const fn = toolCall.function || {};
    const name = fn.name || toolCall.name || "shell_command";
    const outgoingName = codexToolName(name, shellTarget);
    const rawArguments = fn.arguments == null ? {} : fn.arguments;
    const outgoingArguments = codexToolArguments(name, rawArguments, shellArgumentName);
    const argumentsText = JSON.stringify(outgoingArguments);
    return {
      id: `fc_${Date.now()}_${index}`,
      type: "function_call",
      status: "completed",
      name: outgoingName,
      arguments: argumentsText,
      call_id: toolCall.id || `call_${Date.now()}_${index}`,
    };
  });
}

function streamStaticResponses(res, model, text) {
  const id = `resp_${Date.now()}`;
  const msgId = `msg_${Date.now()}`;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  writeSse(res, "response.created", { type: "response.created", response: { id, object: "response", status: "in_progress", model } });
  writeSse(res, "response.in_progress", { type: "response.in_progress", response: { id, object: "response", status: "in_progress", model } });
  writeSse(res, "response.output_item.added", {
    type: "response.output_item.added",
    output_index: 0,
    item: { id: msgId, type: "message", status: "in_progress", role: "assistant", content: [] },
  });
  writeSse(res, "response.content_part.added", {
    type: "response.content_part.added",
    item_id: msgId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });
  if (text) {
    writeSse(res, "response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: msgId,
      output_index: 0,
      content_index: 0,
      delta: text,
    });
  }
  writeSse(res, "response.output_text.done", {
    type: "response.output_text.done",
    item_id: msgId,
    output_index: 0,
    content_index: 0,
    text,
  });
  writeSse(res, "response.content_part.done", {
    type: "response.content_part.done",
    item_id: msgId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text, annotations: [] },
  });
  writeSse(res, "response.output_item.done", {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      id: msgId,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    },
  });
  writeSse(res, "response.completed", { type: "response.completed", response: responsesPayload({ message: { content: text } }, model) });
  writeSse(res, null, "[DONE]");
  res.end();
}

function streamResponses(res, body, ollamaBody) {
  const id = `resp_${Date.now()}`;
  const msgId = `msg_${Date.now()}`;
  const model = ollamaBody.model;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  writeSse(res, "response.created", { type: "response.created", response: { id, object: "response", status: "in_progress", model } });
  writeSse(res, "response.in_progress", { type: "response.in_progress", response: { id, object: "response", status: "in_progress", model } });

  let fullText = "";
  let completed = false;
  let messageStarted = false;
  let thinkingChars = 0;
  let toolCallCount = 0;
  let toolCalls = [];
  const start = Date.now();
  log(`stream responses model=${model} think=${ollamaBody.think} tools=${(ollamaBody._proxyToolNames || []).join(",") || "-"} chars=${messageChars(ollamaBody.messages)}`);
  const heartbeat = setInterval(() => {
    if (completed || res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    writeSse(res, "response.in_progress", { type: "response.in_progress", response: { id, object: "response", status: "in_progress", model } });
  }, 10000);
  if (typeof heartbeat.unref === "function") {
    heartbeat.unref();
  }
  const stopHeartbeat = () => clearInterval(heartbeat);
  const ensureMessageStarted = () => {
    if (messageStarted) {
      return;
    }
    messageStarted = true;
    writeSse(res, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: msgId, type: "message", status: "in_progress", role: "assistant", content: [] },
    });
    writeSse(res, "response.content_part.added", {
      type: "response.content_part.added",
      item_id: msgId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
  };
  const finishToolCalls = (parsed = {}) => {
    if (completed || res.writableEnded) {
      return;
    }
    completed = true;
    stopHeartbeat();
    const items = responseFunctionCallItems(toolCalls, ollamaBody._proxyCodexShellTool, ollamaBody._proxyCodexShellArgument);
    log(`done stream responses model=${model} seconds=${((Date.now() - start) / 1000).toFixed(2)} chars=${fullText.length} thinking_chars=${thinkingChars} tool_calls=${items.length}`);
    items.forEach((item, index) => {
      const outputIndex = messageStarted ? index + 1 : index;
      writeSse(res, "response.output_item.added", {
        type: "response.output_item.added",
        output_index: outputIndex,
        item: { ...item, status: "in_progress", arguments: "" },
      });
      if (item.arguments) {
        writeSse(res, "response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: item.id,
          output_index: outputIndex,
          delta: item.arguments,
        });
      }
      writeSse(res, "response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: item.id,
        output_index: outputIndex,
        arguments: item.arguments,
      });
      writeSse(res, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: outputIndex,
        item,
      });
    });
    writeSse(res, "response.completed", {
      type: "response.completed",
      response: responsesPayloadForOutput(items, model, parsed),
    });
    writeSse(res, null, "[DONE]");
    res.end();
  };
  const finish = (parsed = {}) => {
    if (completed || res.writableEnded) {
      return;
    }
    if (toolCalls.length > 0 && !fullText.trim()) {
      finishToolCalls(parsed);
      return;
    }
    completed = true;
    stopHeartbeat();
    if (!fullText.trim()) {
      fullText = "El modelo local no produjo texto final. Reintenta con una pregunta mas directa o usa el perfil Think.";
    }
    log(`done stream responses model=${model} seconds=${((Date.now() - start) / 1000).toFixed(2)} chars=${fullText.length} thinking_chars=${thinkingChars} tool_calls=${toolCallCount}`);
    ensureMessageStarted();
    writeSse(res, "response.output_text.done", {
      type: "response.output_text.done",
      item_id: msgId,
      output_index: 0,
      content_index: 0,
      text: fullText,
    });
    writeSse(res, "response.content_part.done", {
      type: "response.content_part.done",
      item_id: msgId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: fullText, annotations: [] },
    });
    writeSse(res, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        id: msgId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: fullText, annotations: [] }],
      },
    });
    writeSse(res, "response.completed", { type: "response.completed", response: responsesPayload({ ...parsed, message: { content: fullText } }, model) });
    writeSse(res, null, "[DONE]");
    res.end();
  };
  const upstreamReq = postOllama("/api/chat", { ...ollamaBody, stream: false }, (upstream, error) => {
    if (error || !upstream) {
      stopHeartbeat();
      writeSse(res, "error", { type: "error", error: { message: error?.message || "Ollama connection failed" } });
      res.end();
      return;
    }
    let raw = "";
    upstream.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    upstream.on("end", () => {
      if (completed) {
        return;
      }
      if (upstream.statusCode && upstream.statusCode >= 400) {
        stopHeartbeat();
        writeSse(res, "error", { type: "error", error: { message: raw || `Ollama HTTP ${upstream.statusCode}` } });
        res.end();
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(raw || "{}");
      } catch (parseError) {
        stopHeartbeat();
        writeSse(res, "error", { type: "error", error: { message: parseError.message } });
        res.end();
        return;
      }
      const thought = parsed.message?.thinking || parsed.thinking || "";
      if (typeof thought === "string" && thought) {
        thinkingChars += thought.length;
      }
      if (parsed.message?.tool_calls) {
        const incomingToolCalls = Array.isArray(parsed.message.tool_calls)
          ? parsed.message.tool_calls
          : [parsed.message.tool_calls];
        toolCalls = incomingToolCalls;
        toolCallCount += incomingToolCalls.length;
      }
      const text = parsedTextDelta(parsed);
      if (text) {
        ensureMessageStarted();
        fullText += text;
        writeSse(res, "response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: msgId,
          output_index: 0,
          content_index: 0,
          delta: text,
        });
      }
      finish(parsed);
    });
    upstream.on("error", (streamError) => {
      if (!completed && !res.writableEnded) {
        stopHeartbeat();
        writeSse(res, "error", { type: "error", error: { message: streamError.message } });
        res.end();
      }
    });
  });
  abortUpstreamOnClientClose(res, upstreamReq);
}

async function handleResponses(req, res) {
  const body = JSON.parse(await readBody(req) || "{}");
  const messages = responseInputToMessages(body);
  const ollamaBody = buildOllamaBody(body, messages);
  if (ollamaBody._proxyStaticResponse) {
    log(`static responses model=${ollamaBody.model} stream=${Boolean(body.stream)} chars=${messageChars(ollamaBody.messages)}`);
    if (body.stream) {
      streamStaticResponses(res, ollamaBody.model, ollamaBody._proxyStaticResponse);
      return;
    }
    sendJson(res, 200, responsesPayload({ message: { content: ollamaBody._proxyStaticResponse } }, ollamaBody.model));
    return;
  }
  if (ollamaBody._proxyAuxiliary) {
    log(`aux responses requested_model=${body.model || ""} stream=${Boolean(body.stream)} chars=${messageChars(ollamaBody.messages)}`);
    if (body.stream) {
      streamStaticResponses(res, ollamaBody.model, "OK");
      return;
    }
    sendJson(res, 200, responsesPayload({ message: { content: "OK" } }, ollamaBody.model));
    return;
  }
  if (body.stream) {
    streamResponses(res, body, ollamaBody);
    return;
  }
  const start = Date.now();
  log(`responses model=${ollamaBody.model} think=${ollamaBody.think} tools=${(ollamaBody._proxyToolNames || []).join(",") || "-"} chars=${messageChars(ollamaBody.messages)}`);
  const upstreamReq = postOllama("/api/chat", ollamaBody, (upstream, error) => {
    if (error || !upstream) {
      sendError(res, 502, error?.message || "Ollama connection failed");
      return;
    }
    let raw = "";
    upstream.on("data", (chunk) => { raw += chunk; });
    upstream.on("end", () => {
      if (upstream.statusCode && upstream.statusCode >= 400) {
        sendError(res, upstream.statusCode, raw);
        return;
      }
      log(`done responses model=${ollamaBody.model} seconds=${((Date.now() - start) / 1000).toFixed(2)}`);
      const parsed = JSON.parse(raw);
      if (parsed.message?.tool_calls) {
        sendJson(res, 200, responsesPayloadForOutput(responseFunctionCallItems(parsed.message.tool_calls, ollamaBody._proxyCodexShellTool, ollamaBody._proxyCodexShellArgument), ollamaBody.model, parsed));
        return;
      }
      sendJson(res, 200, responsesPayload(parsed, ollamaBody.model));
    });
  });
  abortUpstreamOnClientClose(res, upstreamReq);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        proxy: "ollama-openai-fast-proxy",
        version,
        target: target.href,
        default_model: defaultModel,
        models: listedModels(),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      sendJson(res, 200, {
        object: "list",
        data: listedModels().map((model) => ({
          id: model.id,
          object: "model",
          created: 0,
          owned_by: "ollama",
        })),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      await handleChatCompletions(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/responses") {
      await handleResponses(req, res);
      return;
    }
    sendError(res, 404, `Unsupported endpoint: ${req.method} ${url.pathname}`);
  } catch (error) {
    sendError(res, 500, error.message || String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  log(`ollama-openai-fast-proxy listening on http://127.0.0.1:${port}`);
  log(`target=${target.href} fast=${fastModel} think=${thinkModel}`);
});
