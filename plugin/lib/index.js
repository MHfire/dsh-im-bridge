import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { createHash } from "node:crypto";
/** PNG signature (first 8 bytes). */
const PNG_MAGIC = Buffer.from([
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10
]);
/** `![alt](url)` or `[text](url)`, capturing the destination. */
const MARKDOWN_LINK = /!?\[(?:[^\]]*?)\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
/**
* Pull destination URLs from Markdown images and links, in order.
* @param text - assistant reply body.
* @returns raw destinations (angle brackets already stripped).
*/
function extractMarkdownUrls(text) {
	const urls = [];
	for (const match of text.matchAll(MARKDOWN_LINK)) {
		const raw = match[1];
		if (raw === void 0) continue;
		const dest = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
		if (dest !== "") urls.push(dest);
	}
	return urls;
}
/**
* Chat id for `sendMediaMessage`: group `chatid`, otherwise the sender userid.
* @param frame - inbound WeCom frame.
* @param sender - userid used for 1:1 chats.
*/
function resolveChatId(frame, sender) {
	const chattype = frame.body?.chattype;
	const chatid = frame.body?.chatid;
	if ((chattype === "group" || chattype === 2 || chattype === "2") && chatid) return chatid;
	if (!(chattype === "single" || chattype === 1 || chattype === "1") && chatid) return chatid;
	return sender;
}
function stripQueryHash(url) {
	const noHash = url.split("#")[0] ?? url;
	return noHash.split("?")[0] ?? noHash;
}
function isRemote(url) {
	return /^(?:https?:|data:|mailto:|file:)/i.test(url);
}
function isPngPath(url) {
	return /\.png$/i.test(url);
}
function containedIn(root, target) {
	const rel = relative(root, target);
	if (rel === "") return false;
	if (isAbsolute(rel)) return false;
	if (rel === ".." || rel.startsWith(`..${sep}`)) return false;
	return true;
}
function tryRealpath(path) {
	try {
		return realpathSync(path);
	} catch {
		return;
	}
}
/**
* Resolve Markdown destinations to workspace PNG files.
* @param text - untruncated assistant reply.
* @param workspace - Agent cwd / plugin `workspace`.
* @param options - optional size/count caps.
*/
function collectReplyPngs(text, workspace, options) {
	const maxBytes = options?.maxBytes ?? 10485760;
	const maxCount = options?.maxCount ?? 10;
	const images = [];
	const skipped = [];
	const seen = /* @__PURE__ */ new Set();
	const root = tryRealpath(workspace);
	if (root === void 0) {
		skipped.push(`工作区不可读: ${workspace}`);
		return {
			images,
			skipped
		};
	}
	for (const raw of extractMarkdownUrls(text)) {
		const url = stripQueryHash(raw.trim());
		if (url === "" || isRemote(url)) continue;
		if (!isPngPath(url)) continue;
		if (images.length >= maxCount) {
			skipped.push(`超过 ${maxCount} 张上限，忽略后续图片`);
			break;
		}
		const real = tryRealpath(resolve(root, url));
		if (real === void 0) {
			skipped.push(`文件不存在: ${url}`);
			continue;
		}
		if (!containedIn(root, real)) {
			skipped.push(`越出工作区: ${url}`);
			continue;
		}
		if (seen.has(real)) continue;
		let size;
		try {
			size = statSync(real).size;
		} catch {
			skipped.push(`无法读取: ${url}`);
			continue;
		}
		if (size > maxBytes) {
			skipped.push(`超过 ${maxBytes} 字节: ${url}`);
			continue;
		}
		let buffer;
		try {
			buffer = readFileSync(real);
		} catch {
			skipped.push(`无法读取: ${url}`);
			continue;
		}
		if (buffer.subarray(0, PNG_MAGIC.length).compare(PNG_MAGIC) !== 0) {
			skipped.push(`不是 PNG: ${url}`);
			continue;
		}
		seen.add(real);
		images.push({
			absPath: real,
			filename: basename(real),
			buffer
		});
	}
	return {
		images,
		skipped
	};
}
function mediaIdOf(result) {
	const id = result.media_id ?? result.mediaId;
	return id !== void 0 && id !== "" ? id : void 0;
}
/**
* Upload each PNG then push it as a WeCom image message.
* Failures are logged and do not abort the remaining files.
* @param ws - WeCom client.
* @param chatid - 1:1 userid or group chatid.
* @param images - files from {@link collectReplyPngs}.
* @returns counts of sent vs failed filenames.
*/
async function sendCollectedPngs(ws, chatid, images) {
	const failed = [];
	let sent = 0;
	for (const image of images) try {
		const mediaId = mediaIdOf(await ws.uploadMedia(image.buffer, {
			type: "image",
			filename: image.filename
		}));
		if (mediaId === void 0) {
			failed.push(image.filename);
			console.error(`[im-bridge] 上传成功但无 media_id: ${image.filename}`);
			continue;
		}
		await ws.sendMediaMessage(chatid, "image", mediaId);
		sent++;
		console.log(`[im-bridge] 已发送图片 ${image.filename} (${image.buffer.length}B)`);
	} catch (error) {
		failed.push(image.filename);
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[im-bridge] 发送图片失败 ${image.filename}: ${message}`);
	}
	return {
		sent,
		failed
	};
}
//#endregion
//#region src/session-key.ts
/**
* Route WeCom inbound frames onto one DSH session per chat window:
* 1:1 by userid, groups by chatid.
*/
/** Single-chat frame with no userid — caller must refuse, not merge. */
var WecomSessionReject = class extends Error {
	/** Short WeCom reply when the frame cannot be routed. */
	reply;
	/**
	* @param reply - text sent back on the inbound frame.
	*/
	constructor(reply) {
		super(reply);
		this.name = "WecomSessionReject";
		this.reply = reply;
	}
};
/**
* Sender userid from official `from.userid`, then `body.userid`.
* Does not read `sender` (not on the SDK message type).
*/
function senderUserid(frame) {
	const from = frame.body?.from?.userid?.trim();
	if (from) return from;
	const body = frame.body?.userid?.trim();
	if (body) return body;
	return "";
}
function isGroupChat(chattype, chatid) {
	if (chattype === "group" || chattype === 2 || chattype === "2") return true;
	if (chatid !== "" && chattype !== "single" && chattype !== 1 && chattype !== "1") return true;
	return false;
}
/** GUI channel prefix by window kind (no userid / chatid). */
const WECOM_TITLE_PREFIX = {
	single: "企微·私聊",
	group: "企微·群"
};
/** Leading `企微·` / previously used `企业微信·` channel labels. */
const CHANNEL_PREFIX = /^(?:企业微信|企微)·(?:私聊|群)\s*/u;
/**
* Sidebar title: channel kind plus first-prompt text, never an id.
* @param kind - {@link WecomSessionRef.kind}.
* @param raw - automatic or previously prefixed title.
*/
function wecomDisplayTitle(kind, raw) {
	const prefix = WECOM_TITLE_PREFIX[kind];
	const stripped = raw.replace(CHANNEL_PREFIX, "").trim();
	return stripped === "" ? prefix : `${prefix} ${stripped}`;
}
/** One leading `@nickname` and its separator; JS `\s` covers WeCom's U+00A0 and U+2005. */
const LEADING_MENTION = /^@[^\s@]+(?:\s+|$)/u;
/**
* Drop the `@bot` mentions WeCom prepends to a group message, so the model
* input and the generated title both start at the actual request. Mentions
* later in the text stay; a message that is nothing but mentions is returned
* unchanged rather than emptied.
* @param text - trimmed inbound message text.
*/
function stripBotMention(text) {
	let rest = text;
	for (let match = LEADING_MENTION.exec(rest); match !== null; match = LEADING_MENTION.exec(rest)) rest = rest.slice(match[0].length);
	const stripped = rest.trim();
	return stripped === "" ? text : stripped;
}
/** Previously pinned `企微·私聊/群 <id>` titles from the id-based rename. */
function isLegacyPinnedWecomTitle(title) {
	return /^(?:企微·(?:私聊|群))\s+[A-Za-z0-9][A-Za-z0-9_-]*$/.test(title.trim());
}
function singleRef(sender) {
	return {
		key: `single:${sender}`,
		kind: "single",
		sender
	};
}
/**
* Stable DSH session id for one epoch of a WeCom window (survives process
* restart). Epoch 1 carries no suffix, so ids minted before archiving support
* keep resolving to the same session.
* @param key - {@link WecomSessionRef.key}.
* @param epoch - 1-based session generation for this window.
*/
function wecomSessionId(key, epoch = 1) {
	const hex = createHash("sha256").update(key).digest("hex").slice(0, 16);
	return epoch <= 1 ? `wecom-${hex}` : `wecom-${hex}-${epoch}`;
}
/**
* Bind a WeCom window to its first non-archived epoch. Archiving a session in
* the GUI hides it everywhere with no way back, so its epoch is skipped and
* the window continues in the next one; the chosen id adopts a live Agent,
* resumes a persisted session, or starts a new one.
* @param key - {@link WecomSessionRef.key}.
* @param state - live / persisted / archived knowledge per candidate id.
*/
function planWecomBind(key, state) {
	const limit = state.archived.size + 1;
	for (let epoch = 1; epoch <= limit; epoch += 1) {
		const sessionId = wecomSessionId(key, epoch);
		if (state.archived.has(sessionId)) continue;
		if (state.live(sessionId)) return {
			sessionId,
			bind: "adopt",
			epoch
		};
		if (state.stored.has(sessionId)) return {
			sessionId,
			bind: "resume",
			epoch
		};
		return {
			sessionId,
			bind: "create",
			epoch
		};
	}
	throw new Error(`im-bridge: no free session epoch for ${key} within ${String(limit)} candidates`);
}
/**
* Map one inbound frame to a chat-window session.
* Group without `chatid` falls back to 1:1 when userid is present.
* 1:1 without userid throws {@link WecomSessionReject}.
*/
function resolveWecomSession(frame) {
	const sender = senderUserid(frame);
	const chattype = frame.body?.chattype;
	const chatid = frame.body?.chatid?.trim() ?? "";
	if (isGroupChat(chattype, chatid)) {
		if (chatid === "") {
			if (sender === "") throw new WecomSessionReject("无法识别会话，已忽略");
			console.error(`[im-bridge] 群消息缺少 chatid, 退回单聊 key from=${sender}`);
			return singleRef(sender);
		}
		return {
			key: `group:${chatid}`,
			kind: "group",
			sender,
			chatid
		};
	}
	if (sender === "") throw new WecomSessionReject("无法识别发送者，已忽略");
	return singleRef(sender);
}
//#endregion
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
* export). Messages create in-process Agents so per-chat-window sessions stay on
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
/** Placeholder Map value so later messages on the same key share one queue. */
function emptyChatState() {
	return {
		queue: Promise.resolve(),
		lastActivity: "",
		activityClearAt: 0,
		lastToolByCallId: /* @__PURE__ */ new Map(),
		modelStreamPhase: "idle",
		streamStatusTick: 0
	};
}
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
/**
* Payload of the log's last `session/title` event — the title in force now.
* @param session - live session whose log to fold.
* @returns the payload, or undefined when the session has no title event.
*/
function latestTitleData(session) {
	const events = session.events;
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const event = events[i];
		if (event.type === "session/title") return event.data;
	}
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
* Resolve the model for a new WeCom chat session. Both provider and model must be
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
		const chats = /* @__PURE__ */ new Map();
		/**
		* Add the channel prefix to a title the Host generated. `session/event`
		* runs inside the append publication window, which refuses a reentrant
		* append, so the prefixed title goes out in a microtask and re-reads the
		* log first: an already prefixed tail (including the one this appends)
		* stops the chain.
		*/
		function prefixWecomTitle(session, st) {
			const kind = st.kind;
			if (kind === void 0) return;
			queueMicrotask(() => {
				const data = latestTitleData(session);
				if (data === void 0) return;
				if (data.source?.kind === "user") return;
				const raw = typeof data.title === "string" ? data.title : "";
				const next = wecomDisplayTitle(kind, raw);
				if (next === raw) return;
				const messageSeqs = Array.isArray(data.messageSeqs) ? data.messageSeqs.filter((seq) => typeof seq === "number") : [];
				if (messageSeqs.length === 0) return;
				try {
					session.append("session/title", {
						title: next,
						messageSeqs,
						source: data.source ?? { kind: "fallback" }
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`[im-bridge] 加标题前缀失败: ${message}`);
				}
			});
		}
		/**
		* Sessions the GUI archived. Archiving is the workspace registry's global
		* set, not session state, and it has no inverse: an archived session is
		* invisible in every list, so this plugin must stop writing to it.
		*/
		function archivedSessions() {
			const registry = ctx.get("workspaceRegistry");
			if (registry === void 0) return /* @__PURE__ */ new Set();
			try {
				return new Set(registry.archivedSessionIds);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[im-bridge] 读归档会话失败: ${message}`);
				return /* @__PURE__ */ new Set();
			}
		}
		async function unpinLegacyWecomTitle(agent) {
			const titles = ctx.get("sessionTitle");
			if (titles === void 0) return;
			try {
				const snapshot = titles.get(agent.session);
				if (snapshot?.source?.kind !== "user") return;
				if (!isLegacyPinnedWecomTitle(snapshot.title)) return;
				await titles.refresh(agent.session);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[im-bridge] 解开旧标题失败: ${message}`);
			}
		}
		async function ensureAgent(ref) {
			let st = chats.get(ref.key);
			if (st === void 0) {
				st = emptyChatState();
				chats.set(ref.key, st);
			}
			st.kind = ref.kind;
			if (st.agent !== void 0) {
				if (st.sessionId === void 0 || !archivedSessions().has(st.sessionId)) return st;
				console.log(`[im-bridge] 会话 ${st.sessionId} 已归档，改开新会话`);
				st.agent = void 0;
				st.sessionId = void 0;
			}
			const persistence = ctx.get("sessionPersistence");
			const headers = persistence === void 0 ? [] : await persistence.list();
			const plan = planWecomBind(ref.key, {
				live: (id) => agents.get(SessionId(id)) !== void 0,
				stored: new Set(headers.map((header) => header.id)),
				archived: archivedSessions()
			});
			const sessionId = SessionId(plan.sessionId);
			const stored = headers.find((header) => header.id === sessionId);
			const attach = (agent, how) => {
				st.agent = agent;
				st.sessionId = sessionId;
				st.kind = ref.kind;
				unpinLegacyWecomTitle(agent);
				const cwd = agent.session.header?.cwd ?? stored?.cwd;
				if (cwd !== void 0 && cwd !== cfg().workspace) console.warn(`[im-bridge] 会话 ${sessionId} 仍使用存档目录 ${cwd}，当前 workspace=${cfg().workspace}`);
				const epoch = plan.epoch > 1 ? ` 第${String(plan.epoch)}段` : "";
				console.log(`[im-bridge] 为 ${ref.key} ${how}会话 ${sessionId}${epoch} userid=${ref.sender} chattype=${ref.kind} chatid=${ref.chatid ?? ""}`);
			};
			const live = agents.get(sessionId);
			if (plan.bind === "adopt" && live !== void 0) {
				attach(live, "adopt");
				return st;
			}
			const selection = resolveSelection(cfg(), defaultModel);
			const presets = ctx.get("agentPresets");
			const presetId = plan.bind === "resume" && stored?.agentPreset ? stored.agentPreset : cfg().agentPreset;
			let resolvedId = presetId;
			if (presets !== void 0) resolvedId = (await presets.resolve(presetId)).id;
			const setup = async (agentCtx) => {
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
			};
			const agentOptions = {
				provider: selection.provider,
				model: selection.model
			};
			try {
				if (plan.bind === "resume") {
					const { agent } = await agents.resume({
						resumeSessionId: sessionId,
						agentOptions,
						setup
					});
					attach(agent, "resume");
					return st;
				}
				const { agent } = await agents.create({
					sessionId,
					meta: {
						cwd: cfg().workspace,
						agentPreset: resolvedId
					},
					agentOptions,
					setup
				});
				attach(agent, "create");
				return st;
			} catch (error) {
				const raced = agents.get(sessionId);
				if (raced !== void 0) {
					attach(raced, "adopt");
					return st;
				}
				throw error;
			}
		}
		ctx.on("session/event", (session, event) => {
			const thinking = cfg().thinking;
			const prefix = thinking?.activityPrefix ?? DEFAULT_THINKING.activityPrefix;
			const flashMs = Number.isFinite(thinking?.intervalMs) && thinking.intervalMs > 0 ? thinking.intervalMs : DEFAULT_THINKING.intervalMs;
			for (const st of chats.values()) {
				if (st.sessionId !== session.id) continue;
				if (event.type === "session/title") {
					prefixWecomTitle(session, st);
					continue;
				}
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
		async function handle(frame, ref, content) {
			const st = await ensureAgent(ref);
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
				if (st.agent === void 0) throw new Error("im-bridge: chat agent missing");
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
				const body = outcome.text || "(agent 无输出)";
				const collected = collectReplyPngs(body, cfg().workspace);
				for (const reason of collected.skipped) console.warn(`[im-bridge] 跳过图片: ${reason}`);
				let reply = truncate(body, (cfg().maxReplyBytes || 2e4) - 200) + footerOf(ms);
				if (collected.skipped.length > 0) reply = truncate(`${reply}\n⚠️ ${collected.skipped.length} 张图片未发送（过大、越权或不存在）`, cfg().maxReplyBytes || 2e4);
				console.log(`[im-bridge] ${ref.key} 完成 (${Buffer.byteLength(reply, "utf8")}B, ${fmtDuration(ms)})`);
				await sendFinal(ws, frame, streamId, reply);
				if (collected.images.length > 0) await sendCollectedPngs(ws, resolveChatId(frame, ref.sender), collected.images);
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
			const inbound = (frame.body?.text?.content || "").trim();
			if (!inbound) return;
			const content = stripBotMention(inbound);
			let ref;
			try {
				ref = resolveWecomSession(frame);
			} catch (error) {
				if (error instanceof WecomSessionReject) {
					console.error(`[im-bridge] ${error.reply}`);
					ws.replyStream(frame, generateReqId("stream"), error.reply, true).catch(() => {});
					return;
				}
				throw error;
			}
			if (cfg().allowFrom.length > 0 && !cfg().allowFrom.includes(ref.sender)) {
				ws.replyStream(frame, generateReqId("stream"), cfg().deniedMessage, true).catch(() => {});
				return;
			}
			console.log(`[im-bridge] 收到 key=${ref.key} userid=${ref.sender} chattype=${String(frame.body?.chattype ?? "")} chatid=${ref.chatid ?? ""}: ${content.slice(0, 100)}`);
			const st = chats.get(ref.key) ?? emptyChatState();
			st.kind = ref.kind;
			chats.set(ref.key, st);
			st.queue = st.queue.then(() => handle(frame, ref, content)).catch((error) => {
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
