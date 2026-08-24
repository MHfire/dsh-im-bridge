import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region src/wecom.ts
/** Default stream-animation copy; Config / cordis patch may override. */
const DEFAULT_THINKING = {
	phases: [
		{
			atSec: 0,
			text: "🤔 正在理解你的需求…"
		},
		{
			atSec: 8,
			text: "📋 正在整理任务清单"
		},
		{
			atSec: 25,
			text: "🔍 正在查找相关资料"
		},
		{
			atSec: 55,
			text: "✍️ 正在处理文档/数据"
		},
		{
			atSec: 120,
			text: "🧠 正在思考最佳方案…"
		},
		{
			atSec: 240,
			text: "⏳ 任务较繁琐，请稍候…"
		},
		{
			atSec: 420,
			text: "☕ 快好了，正在收尾…"
		}
	],
	spin: [
		"🧠",
		"💭",
		"✨",
		"🔎",
		"⚡"
	],
	eggs: [
		"📎 顺手把要点整理好了，稍后一起给你",
		"📶 网络有点忙，让它慢慢跑",
		"🎯 结果快出来了，坚持一下",
		"🗂️ 资料较多，正在汇总中",
		"🌙 别盯着了，完成会自动通知你"
	],
	eggAfterSec: 240,
	intervalMs: 1500,
	activityPrefix: "🛠️ 正在执行 ",
	reasoningStatus: [
		"💭 模型思考中…",
		"🧠 深入分析中…",
		"✨ 梳理思路中…"
	],
	outputStatus: [
		"✍️ 正在输出回复…",
		"📝 组织文字中…",
		"💬 生成回答中…"
	],
	reasoningSpin: [
		"💭",
		"🧠",
		"🌀",
		"✨"
	],
	outputSpin: [
		"✍️",
		"📝",
		"💬",
		"⚡"
	],
	toolLabels: {
		pwsh: "PowerShell",
		bash: "Shell",
		read_file: "读文件",
		read: "读文件",
		write_file: "写文件",
		write: "写文件",
		edit_file: "编辑文件",
		str_replace: "编辑文件",
		glob: "查找文件",
		grep: "搜索内容",
		web_search: "网页搜索",
		web_fetch: "抓取网页",
		todo_write: "更新待办"
	}
};
/** Map a tool registration name to the WeCom-visible label. */
function labelTool(name, thinking) {
	return {
		...DEFAULT_THINKING.toolLabels,
		...thinking?.toolLabels && typeof thinking.toolLabels === "object" ? thinking.toolLabels : {}
	}[name] || name;
}
/** Pick one status line from a configured list, rotating by tick. */
function pickStatusLine(value, fallback, tick) {
	const list = Array.isArray(value) && value.length > 0 ? value : typeof value === "string" && value !== "" ? [value] : fallback;
	return list[Math.abs(tick) % list.length] ?? fallback[0] ?? "";
}
/** Infer the model stream phase from one `assistant/chunk` payload. */
function streamPhaseFromChunk(chunk) {
	if (!chunk || typeof chunk !== "object") return null;
	if (chunk.type === "reasoning-delta") return "reasoning";
	if (chunk.type === "text-delta") return "outputting";
	if (chunk.type === "block-start") {
		if (chunk.blockType === "reasoning") return "reasoning";
		if (chunk.blockType === "text") return "outputting";
	}
	return null;
}
/** Format milliseconds as a short Chinese duration. */
function fmtDuration(ms) {
	const s = Math.floor(ms / 1e3);
	if (s < 60) return `${s} 秒`;
	const m = Math.floor(s / 60);
	const r = s % 60;
	return r > 0 ? `${m} 分 ${r} 秒` : `${m} 分钟`;
}
/** Speed label from elapsed milliseconds. */
function speedOf(ms) {
	if (ms < 6e4) return "⚡ 神速";
	if (ms < 18e4) return "🚀 正常速度";
	return "🐢 耗时较长";
}
/** Footer appended to a completed WeCom reply. */
function footerOf(ms) {
	if (ms >= 18e4) return `\n\n---\n✅ 执行完成 · 🐢 耗时较长（${fmtDuration(ms)}）\n💡 如需提速，可让我把诊断步骤合并成更少的 SSH 批次`;
	return `\n\n---\n✅ 执行完成 · ${speedOf(ms)}（${fmtDuration(ms)}）`;
}
/** Truncate a string to at most `max` UTF-8 bytes. */
function truncate(text, max) {
	if (Buffer.byteLength(text, "utf8") <= max) return text;
	let t = text;
	while (Buffer.byteLength(t, "utf8") > max) t = t.slice(0, -100);
	return `${t}\n\n...(内容过长已截断)`;
}
/**
* Refresh one stream message until the caller stops it.
* @param activity - live tool/status text; empty falls back to timed phases.
* @param thinking - animation copy; defaults to {@link DEFAULT_THINKING}.
* @param getStreamPhase - model stream phase; selects the spinner pool.
* @returns disposer that cancels the interval.
*/
function startThinking(ws, frame, streamId, startedAt, timeoutSec, activity, thinking, getStreamPhase) {
	const t = {
		...DEFAULT_THINKING,
		...thinking
	};
	const phases = Array.isArray(t.phases) && t.phases.length > 0 ? t.phases : DEFAULT_THINKING.phases;
	const spin = Array.isArray(t.spin) && t.spin.length > 0 ? t.spin : DEFAULT_THINKING.spin;
	const reasoningSpin = Array.isArray(t.reasoningSpin) && t.reasoningSpin.length > 0 ? t.reasoningSpin : DEFAULT_THINKING.reasoningSpin;
	const outputSpin = Array.isArray(t.outputSpin) && t.outputSpin.length > 0 ? t.outputSpin : DEFAULT_THINKING.outputSpin;
	const eggs = Array.isArray(t.eggs) && t.eggs.length > 0 ? t.eggs : DEFAULT_THINKING.eggs;
	const eggAfterSec = Number.isFinite(t.eggAfterSec) ? t.eggAfterSec : DEFAULT_THINKING.eggAfterSec;
	const intervalMs = Number.isFinite(t.intervalMs) && t.intervalMs > 0 ? t.intervalMs : DEFAULT_THINKING.intervalMs;
	const total = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 600;
	let i = 0;
	const timer = setInterval(() => {
		const secs = Math.floor((Date.now() - startedAt) / 1e3);
		const live = activity ? activity() : "";
		let stage = phases[0]?.text ?? "";
		if (!live) {
			for (const phase of phases) if (secs >= phase.atSec) stage = phase.text;
		}
		const pct = Math.min(Math.floor(secs / total * 100), 99);
		const filled = "█".repeat(Math.floor(pct / 10));
		const bar = secs < 3 ? "" : `\n${filled}${"░".repeat(10 - filled.length)} ${String(pct).padStart(2)}%`;
		const remain = Math.max(total - secs, 0);
		const remainTxt = secs < 3 ? "" : ` · 预计还剩 ${Math.floor(remain / 60)}分${remain % 60}秒`;
		const egg = secs >= eggAfterSec && eggs.length > 0 ? `\n${eggs[Math.floor(secs / 60) % eggs.length]}` : "";
		const phase = getStreamPhase ? getStreamPhase() : "idle";
		const emojiPool = phase === "reasoning" ? reasoningSpin : phase === "outputting" ? outputSpin : spin;
		const emoji = emojiPool[i % emojiPool.length];
		i++;
		const status = live || stage;
		ws.replyStream(frame, streamId, `${emoji} ${status}   ⏱ ${secs} 秒${remainTxt}${bar}${egg}`, false).catch(() => {});
	}, intervalMs);
	return () => clearInterval(timer);
}
/** Finish the current stream; open a new stream if WeCom expired the first. */
async function sendFinal(ws, frame, streamId, content) {
	try {
		await ws.replyStream(frame, streamId, content, true);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[im-bridge] 原流最终回复失败(${message}), 尝试新流...`);
		const { generateReqId } = await import("@wecom/aibot-node-sdk");
		await ws.replyStream(frame, generateReqId("stream"), content, true);
	}
}
//#endregion
//#region src/index.ts
/**
* dsh-im-bridge — WeCom AI bot ⇄ DSH Agent host plugin.
*
* Function-plugin shape (`name` / `inject` / `Config` / `apply`, no default
* export). Messages create in-process Agents so per-sender sessions stay on
* the same Loader tree as the Web GUI. Settings register through
* `installSettingsSection`; live fields read `source()`, credentials still
* require a process restart to open the WebSocket.
*/
/** Package root (persona files live beside package.json). */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Built-in Chinese persona. */
const DEFAULT_PERSONA_ZH = join(PACKAGE_ROOT, "persona.default.md");
/** Built-in English persona. */
const DEFAULT_PERSONA_EN = join(PACKAGE_ROOT, "persona.default.en.md");
/** Host locale settings namespace (`dsh-client-locale`). */
const LOCALE_SETTINGS_NS = settingsNamespace("locale");
/** Settings namespace paired with the browser card. */
const IM_BRIDGE_NS = settingsNamespace("im-bridge");
/** Cordis diagnostic name. */
const name = "im-bridge";
/** Required host services. */
const inject = [
	"agents",
	"sessions",
	"agentDefaultModel"
];
const ThinkingPhase = z.object({
	atSec: z.number(),
	text: z.string()
});
const ThinkingSchema = z.object({
	phases: z.array(ThinkingPhase).default(DEFAULT_THINKING.phases),
	spin: z.array(String).default(DEFAULT_THINKING.spin),
	eggs: z.array(String).default(DEFAULT_THINKING.eggs),
	eggAfterSec: z.number().default(DEFAULT_THINKING.eggAfterSec),
	intervalMs: z.number().default(DEFAULT_THINKING.intervalMs),
	activityPrefix: z.string().default(DEFAULT_THINKING.activityPrefix),
	toolLabels: z.dict(String).default(DEFAULT_THINKING.toolLabels),
	reasoningStatus: z.array(String).default(DEFAULT_THINKING.reasoningStatus),
	outputStatus: z.array(String).default(DEFAULT_THINKING.outputStatus),
	reasoningSpin: z.array(String).default(DEFAULT_THINKING.reasoningSpin),
	outputSpin: z.array(String).default(DEFAULT_THINKING.outputSpin)
});
/** Schemastery schema for the composition entry and settings namespace. */
const Config = z.object({
	botId: z.string().default("").role("secret"),
	secret: z.string().default("").role("secret"),
	workspace: z.string().default(process.cwd()),
	allowFrom: z.array(String).default([]),
	startHint: z.string().default("🧠 正在思考..."),
	agentTimeoutSec: z.number().default(600),
	agentPreset: z.string().default("standard"),
	provider: z.string().default(""),
	model: z.string().default(""),
	reasoningEffort: z.string().default(""),
	persona: z.string().default(""),
	personaFile: z.string().default(""),
	maxReplyBytes: z.number().default(2e4),
	thinking: ThinkingSchema.default(DEFAULT_THINKING),
	deniedMessage: z.string().default("无权访问本服务"),
	welcomeMessage: z.string().default("👋 办公助手已就绪。直接发消息即可，例如查文件、整理文档、查资料或处理日常事务。")
});
/** Join assistant text from one turn starting at `firstSeq`. */
function summarize(events, firstSeq) {
	let started = false;
	let text = "";
	let reason;
	for (const event of events) {
		if (event.seq < firstSeq) continue;
		if (event.type === "turn/start") {
			started = true;
			continue;
		}
		if (!started) continue;
		if (event.type === "assistant/message") {
			const joined = (event.data.message?.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
			if (joined !== "") text = joined;
		}
		if (event.type === "turn/end") reason = event.data.reason;
	}
	return {
		text,
		reason
	};
}
/** Read Host `locale.preference`; missing or unknown falls back to `zh`. */
function readLocalePreference(settings) {
	if (settings === void 0) return "zh";
	try {
		const section = settings.get(LOCALE_SETTINGS_NS);
		return (section && typeof section === "object" && "preference" in section ? section.preference : void 0) === "en" ? "en" : "zh";
	} catch {
		return "zh";
	}
}
/** Strip leading `#` comment lines from a built-in persona file. */
function stripLeadingHashComments(text) {
	const lines = text.split(/\r?\n/);
	let i = 0;
	while (i < lines.length && /^\s*#/.test(lines[i] ?? "")) i++;
	while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
	return lines.slice(i).join("\n");
}
/** Resolve persona: personaFile → persona string → built-in locale file. */
function resolvePersona(config, settings) {
	if (config.personaFile) try {
		return readFileSync(config.personaFile, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[im-bridge] 读取 personaFile 失败: ${message}`);
	}
	if (config.persona !== "") return config.persona;
	const file = readLocalePreference(settings) === "en" ? DEFAULT_PERSONA_EN : DEFAULT_PERSONA_ZH;
	try {
		return stripLeadingHashComments(readFileSync(file, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[im-bridge] 读取默认人设失败: ${message}`);
		return "";
	}
}
/**
* Resolve the model for a new sender session. Both provider and model must be
* non-empty to override; otherwise fall back to agent-default-model.
*/
function resolveSelection(config, defaultModel) {
	const provider = config.provider.trim();
	const model = config.model.trim();
	if (provider !== "" && model !== "") {
		const effort = config.reasoningEffort.trim();
		return effort === "" ? {
			provider,
			model
		} : {
			provider,
			model,
			reasoningEffort: effort
		};
	}
	if (provider !== "" || model !== "") console.warn("[im-bridge] provider/model 需同时填写才覆盖企微模型, 已回退 agent-default-model。");
	return defaultModel.currentSelection();
}
/**
* Mount the WeCom bridge: settings namespace, then a deferred WebSocket after Loader settle.
* @param ctx - host plugin context.
* @param config - composition entry used as the settings `base` layer.
*/
function apply(ctx, config) {
	const agents = ctx.get("agents");
	const sessions = ctx.get("sessions");
	const defaultModel = ctx.get("agentDefaultModel");
	if (agents === void 0 || sessions === void 0 || defaultModel === void 0) throw new Error("im-bridge: 需要 agents/sessions/agentDefaultModel 服务");
	let source = () => config;
	let settings;
	installSettingsSection(ctx, IM_BRIDGE_NS, Config, config, {
		setSource: (current) => {
			source = current;
		},
		onChange: () => {}
	});
	ctx.inject(["settings"], (settingsCtx) => {
		settings = settingsCtx.settings;
		settingsCtx.effect(() => () => {
			settings = void 0;
		}, "im-bridge: settings reader");
	});
	const cfg = () => source();
	(async () => {
		await ctx.get("loader")?.await();
		const { botId, secret } = cfg();
		if (!botId || !secret) {
			console.warn("[im-bridge] 跳过启动: 缺少 botId/secret。请在 profile cordis.patch.yml 或 Settings → 插件配置中填写后重启。");
			return;
		}
		const senders = /* @__PURE__ */ new Map();
		async function ensureAgent(sender) {
			let st = senders.get(sender);
			if (st !== void 0 && st.agent !== void 0) return st;
			const sessionId = SessionId(`session-${randomUUID()}`);
			const selection = resolveSelection(cfg(), defaultModel);
			const presets = ctx.get("agentPresets");
			let resolvedId = cfg().agentPreset;
			if (presets !== void 0) resolvedId = (await presets.resolve(cfg().agentPreset)).id;
			const { agent } = await agents.create({
				sessionId,
				meta: {
					cwd: cfg().workspace,
					agentPreset: resolvedId
				},
				agentOptions: {
					provider: selection.provider,
					model: selection.model
				},
				setup: async (agentCtx) => {
					installModelSelection(agentCtx, {
						current: selection,
						assembled: void 0
					});
					if (presets !== void 0) await presets.mount(agentCtx, resolvedId);
					agentCtx.inject(["systemPrompt"], (promptCtx) => {
						promptCtx.systemPrompt.section({
							name: "deployment:persona",
							order: 0,
							text: () => resolvePersona(cfg(), settings)
						});
					});
				}
			});
			st = {
				agent,
				sessionId,
				queue: Promise.resolve(),
				lastActivity: "",
				activityClearAt: 0,
				lastToolByCallId: /* @__PURE__ */ new Map(),
				modelStreamPhase: "idle",
				streamStatusTick: 0
			};
			senders.set(sender, st);
			console.log(`[im-bridge] 为 ${sender} 创建会话 ${sessionId}`);
			return st;
		}
		ctx.on("session/event", (session, event) => {
			const thinking = cfg().thinking;
			const prefix = thinking?.activityPrefix ?? DEFAULT_THINKING.activityPrefix;
			const flashMs = Number.isFinite(thinking?.intervalMs) && thinking.intervalMs > 0 ? thinking.intervalMs : DEFAULT_THINKING.intervalMs;
			for (const st of senders.values()) {
				if (st.sessionId !== session.id) continue;
				if (event.type === "assistant/chunk") {
					const next = streamPhaseFromChunk(event.data.chunk);
					if (next !== null) st.modelStreamPhase = next;
					continue;
				}
				if (event.type === "tool/call") {
					const toolName = event.data.name ?? "";
					const callId = event.data.callId;
					if (callId !== void 0) st.lastToolByCallId.set(callId, toolName);
					st.activityClearAt = 0;
					st.lastActivity = `${prefix}${labelTool(toolName, thinking)}`;
					return;
				}
				if (event.type === "tool/result") {
					const data = event.data;
					const callId = data.message?.source?.callId;
					const rawName = callId !== void 0 && st.lastToolByCallId.get(callId) || [...st.lastToolByCallId.values()].at(-1) || "";
					if (callId !== void 0) st.lastToolByCallId.delete(callId);
					const label = labelTool(rawName || "工具", thinking);
					st.lastActivity = data.error !== void 0 ? `❌ ${label} 失败` : `✅ ${label} 完成`;
					st.activityClearAt = Date.now() + flashMs;
					st.modelStreamPhase = "idle";
				}
			}
		});
		const { default: AiBot, generateReqId } = await import("@wecom/aibot-node-sdk");
		async function handle(frame, sender, content) {
			const st = await ensureAgent(sender);
			const startedAt = Date.now();
			const streamId = generateReqId("stream");
			let stopThinking = null;
			st.lastActivity = "";
			st.activityClearAt = 0;
			st.lastToolByCallId.clear();
			st.modelStreamPhase = "idle";
			st.streamStatusTick = 0;
			try {
				await ws.replyStream(frame, streamId, cfg().startHint, false);
				stopThinking = startThinking(ws, frame, streamId, startedAt, cfg().agentTimeoutSec, () => {
					if (st.activityClearAt > 0 && Date.now() >= st.activityClearAt) {
						st.lastActivity = "";
						st.activityClearAt = 0;
					}
					if (st.lastActivity) return st.lastActivity;
					const thinking = cfg().thinking;
					const tick = st.streamStatusTick++;
					if (st.modelStreamPhase === "reasoning") return pickStatusLine(thinking?.reasoningStatus, DEFAULT_THINKING.reasoningStatus, tick);
					if (st.modelStreamPhase === "outputting") return pickStatusLine(thinking?.outputStatus, DEFAULT_THINKING.outputStatus, tick);
					return "";
				}, cfg().thinking, () => st.lastActivity ? "idle" : st.modelStreamPhase);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[im-bridge] 占位回复失败: ${message}`);
			}
			try {
				if (st.agent === void 0) throw new Error("im-bridge: sender agent missing");
				await st.agent.whenIdle();
				const firstSeq = st.agent.session.seq;
				st.agent.followup(createUserMessage({
					content: [{
						type: "text",
						text: content
					}],
					source: { kind: "user" }
				}));
				await st.agent.whenIdle();
				await sessions.flush(st.agent.session);
				const outcome = summarize(st.agent.session.events, firstSeq);
				if (stopThinking) stopThinking();
				const ms = Date.now() - startedAt;
				const reply = truncate(outcome.text || "(agent 无输出)", (cfg().maxReplyBytes || 2e4) - 200) + footerOf(ms);
				console.log(`[im-bridge] ${sender} 完成 (${Buffer.byteLength(reply, "utf8")}B, ${fmtDuration(ms)})`);
				await sendFinal(ws, frame, streamId, reply);
			} catch (error) {
				if (stopThinking) stopThinking();
				const ms = Date.now() - startedAt;
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[im-bridge] agent 失败: ${message}`);
				try {
					await sendFinal(ws, frame, streamId, `处理失败: ${truncate(message, 400)}\n\n---\n❌ 耗时 ${fmtDuration(ms)}`);
				} catch (retryError) {
					const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
					console.error(`[im-bridge] 错误回复也失败: ${retryMessage}`);
				}
			}
		}
		const ws = new AiBot.WSClient({
			botId,
			secret
		});
		ws.on("connected", (() => console.log("[im-bridge] WebSocket 已连接")));
		ws.on("authenticated", (() => console.log("[im-bridge] 认证成功, 等待消息...")));
		ws.on("disconnected", ((reason) => console.log(`[im-bridge] 断开: ${reason}`)));
		ws.on("reconnecting", ((n) => console.log(`[im-bridge] 第 ${n} 次重连...`)));
		ws.on("error", ((error) => console.error(`[im-bridge] 错误: ${error.message}`)));
		ws.on("message.text", ((frame) => {
			const content = (frame.body?.text?.content || "").trim();
			if (!content) return;
			const sender = frame.body?.sender?.userid || frame.body?.from?.userid || frame.body?.userid || "unknown";
			if (cfg().allowFrom.length > 0 && !cfg().allowFrom.includes(sender)) {
				ws.replyStream(frame, generateReqId("stream"), cfg().deniedMessage, true).catch(() => {});
				return;
			}
			console.log(`[im-bridge] 收到 from=${sender}: ${content.slice(0, 100)}`);
			const st = senders.get(sender) ?? {
				queue: Promise.resolve(),
				lastActivity: "",
				activityClearAt: 0,
				lastToolByCallId: /* @__PURE__ */ new Map(),
				modelStreamPhase: "idle",
				streamStatusTick: 0
			};
			senders.set(sender, st);
			st.queue = st.queue.then(() => handle(frame, sender, content)).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[im-bridge] 任务异常: ${message}`);
			});
		}));
		ws.on("event.enter_chat", ((frame) => {
			const sender = frame.body?.from?.userid || "unknown";
			console.log(`[im-bridge] 用户 ${sender} 进入会话`);
			ws.replyWelcome(frame, {
				msgtype: "text",
				text: { content: cfg().welcomeMessage }
			}).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[im-bridge] 欢迎语失败: ${message}`);
			});
		}));
		ws.connect();
		ctx.on("dispose", () => {
			try {
				ws.close?.();
			} catch {}
		});
	})();
}
//#endregion
export { Config, IM_BRIDGE_NS, apply, inject, name };
