#!/usr/bin/env node
/**
 * wecom-bridge — 企业微信智能机器人(WebSocket 直连) <-> DeepSeek Harness headless agent 桥接
 *
 * 架构:
 *   企业微信用户 --WebSocket(wss://openws.work.weixin.qq.com)--> 本服务 --spawn--> dsh --profile headless "<消息>"
 *   用户 <--replyStream(流式 Markdown)---------------------- 本服务 <--stdout-------- dsh
 *
 * 前置:
 *   1. 企业微信管理后台 -> 应用管理 -> 智能机器人 -> 创建机器人, 记录 BotID / Secret
 *   2. 填写 config.json (botId / secret)
 *   3. npm install && node bridge.js
 *
 * 说明:
 *   - WebSocket 长连接模式: 无需公网 URL / 加解密 / IP 白名单, 内网可直连
 *   - 每条消息启动一个独立的 headless agent(无状态), 工作目录 = config.workspace
 *   - 同一会话(sender)的消息串行处理, 避免并发混乱
 *   - agent 运行中先回一条流式"处理中"占位, 完成后回最终结果(Markdown)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AiBot = require('@wecom/aibot-node-sdk');

const CONFIG_PATH = process.env.WECOM_BRIDGE_CONFIG || path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const DSH_CLI = config.dshCli;
const WORKSPACE = config.workspace || process.cwd();
// 工作区内的 headless 配置覆盖层: 通过 --patch 叠加在 headless profile 之后
const HEADLESS_PATCH = path.resolve(WORKSPACE, config.patch || 'headless.patch.yml');
const AGENT_TIMEOUT_MS = (config.agentTimeoutSec || 480) * 1000; // 上限 8 分钟: WeCom 流式消息 10 分钟过期
const MAX_REPLY = 20000; // replyStream 上限 20480 字节, 留余量

// ---------------- agent 调用 ----------------
/** 终止整个进程树(dsh 及其派生的 python/ssh/pwsh 子进程)。 */
function killTree(pid) {
  try {
    process.kill(pid);
  } catch {}
  try {
    require('child_process').execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {}
}

function runAgent(prompt) {
  return new Promise((resolve, reject) => {
    const args = [DSH_CLI, '--profile', 'headless', '--patch', HEADLESS_PATCH, prompt];
    const child = spawn(process.execPath, args, {
      cwd: WORKSPACE,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn, val) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(val);
      }
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish(reject, new Error(`agent 超时(${config.agentTimeoutSec}s), 已终止进程树`));
    }, AGENT_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, out.trim());
      else finish(reject, new Error(err.trim() || `agent 退出码 ${code}`));
    });
  });
}

/** 最终回复: 原流失败(如 WeCom 10 分钟过期)时用新流重试一次。 */
async function sendFinal(ws, frame, streamId, content) {
  try {
    await ws.replyStream(frame, streamId, content, true);
  } catch (e) {
    console.error(`[bridge] 原流最终回复失败(${e.message}), 尝试新流...`);
    await ws.replyStream(frame, AiBot.generateReqId('stream'), content, true);
  }
}

function truncate(text, max) {
  if (Buffer.byteLength(text, 'utf8') <= max) return text;
  let t = text;
  while (Buffer.byteLength(t, 'utf8') > max) t = t.slice(0, -100);
  return t + '\n\n...(内容过长已截断)';
}

/** 毫秒 → 人类可读时长(如 "9 分 47 秒") */
function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m} 分 ${r} 秒` : `${m} 分钟`;
}

/** 按耗时给个速度评价 */
function speedOf(ms) {
  if (ms < 60000) return '⚡ 神速';
  if (ms < 180000) return '🚀 正常速度';
  return '🐢 耗时较长';
}

/**
 * 思考动态效果 v3: 阶段化人格台词 + 旋转表情 + 进度条 + 已用时/剩余估算 + 长任务彩蛋。
 * 每 1.5s 更新一次同一条流式消息(共用 streamId), 直到 agent 完成。返回停止函数。
 */
function startThinking(ws, frame, streamId, startedAt, timeoutSec) {
  // 阶段状态(按已用时切换, 带点人格的台词)
  const PHASES = [
    [0, '🤔 让我看看这台设备…'],
    [8, '🔌 正在 SSH 连接目标板卡'],
    [25, '🛠️ 正在执行诊断命令'],
    [55, '📊 正在分析日志'],
    [120, '🧩 这日志有点意思，再挖挖…'],
    [240, '⏳ 任务比较大，请稍候…'],
    [420, '🔥 还在跑，别急，快好了…'],
  ];
  // 旋转表情(每次更新换一个)
  const SPIN = ['🧠', '💭', '✨', '🔎', '⚡'];
  // 长任务彩蛋(超过 240s 后每 60s 轮换一句)
  const EGGS = [
    '☕ 建议喝杯咖啡回来再看',
    '📶 网络/设备可能有点忙，让它慢慢跑',
    '🎯 结果快出来了，坚持一下',
    '🚀 这是个长活，值得等',
    '🌙 别盯着了，完成会自动通知你',
  ];
  const total = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 600;
  let i = 0;
  const timer = setInterval(() => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    let stage = PHASES[0][1];
    for (const [t, s] of PHASES) if (secs >= t) stage = s;
    const pct = Math.min(Math.floor((secs / total) * 100), 99);
    const filled = '█'.repeat(Math.floor(pct / 10));
    const bar = secs < 3 ? '' : `\n${filled}${'░'.repeat(10 - filled.length)} ${String(pct).padStart(2)}%`;
    const remain = Math.max(total - secs, 0);
    const remainTxt = secs < 3 ? '' : ` · 预计还剩 ${Math.floor(remain / 60)}分${remain % 60}秒`;
    const egg = secs >= 240 ? `\n${EGGS[Math.floor(secs / 60) % EGGS.length]}` : '';
    const emoji = SPIN[i % SPIN.length];
    i++;
    ws.replyStream(frame, streamId, `${emoji} ${stage}   ⏱ ${secs} 秒${remainTxt}${bar}${egg}`, false).catch(() => {});
  }, 1500);
  return () => clearInterval(timer);
}

// ---------------- 主流程 ----------------
function main() {
  // 服务级兜底: 未处理异常只记录, 不让进程退出(长驻服务)
  process.on('unhandledRejection', (e) => console.error('[bridge] 未处理 rejection:', e));
  process.on('uncaughtException', (e) => console.error('[bridge] 未捕获异常:', e));

  if (!config.botId || !config.secret) {
    console.error('[bridge] config.json 缺少 botId/secret。');
    console.error('[bridge] 请在 企业微信管理后台 -> 应用管理 -> 智能机器人 创建机器人并获取 BotID/Secret。');
    process.exit(1);
  }
  if (!fs.existsSync(DSH_CLI)) {
    console.error(`[bridge] dsh CLI 不存在: ${DSH_CLI}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'headless'))) {
    console.error('[bridge] headless profile 不存在，请先创建 $DSH_HOME/profiles/headless');
    process.exit(1);
  }
  if (!fs.existsSync(HEADLESS_PATCH)) {
    console.error(`[bridge] 工作区配置不存在: ${HEADLESS_PATCH}`);
    process.exit(1);
  }
  console.log(`[bridge] 使用工作区配置: ${HEADLESS_PATCH}`);

  const ws = new AiBot.WSClient({ botId: config.botId, secret: config.secret });
  const queues = new Map(); // sender -> Promise 链

  ws.on('connected', () => console.log('[bridge] WebSocket 已连接'));
  ws.on('authenticated', () => console.log('[bridge] 认证成功, 等待消息...'));
  ws.on('disconnected', (r) => console.log(`[bridge] 断开: ${r}`));
  ws.on('reconnecting', (n) => console.log(`[bridge] 第 ${n} 次重连...`));
  ws.on('error', (e) => console.error(`[bridge] 错误: ${e.message}`));

  ws.on('message.text', (frame) => {
    const content = (frame.body?.text?.content || '').trim();
    if (!content) return;
    const sender = frame.body?.sender?.userid || frame.body?.from?.userid || frame.body?.userid || 'unknown';
    const chatid = frame.body?.chatid || frame.body?.chat_id || sender;

    // allowFrom 白名单
    if (config.allowFrom.length > 0 && !config.allowFrom.includes(sender)) {
      console.log(`[bridge] 拒绝非白名单用户: ${sender}`);
      ws.replyStream(frame, AiBot.generateReqId('stream'), '无权访问本服务', true).catch(() => {});
      return;
    }

    console.log(`[bridge] 收到消息 from=${sender} chat=${chatid}: ${content.slice(0, 100)}`);
    const prev = queues.get(sender) || Promise.resolve();
    const task = prev.then(async () => {
      const startedAt = Date.now();
      const streamId = AiBot.generateReqId('stream'); // 同一消息所有流式更新共用
      let stopThinking = null;
      try {
        await ws.replyStream(frame, streamId, config.startHint || '🧠 正在思考...', false);
        stopThinking = startThinking(ws, frame, streamId, startedAt, config.agentTimeoutSec || 600);
      } catch (e) {
        console.error(`[bridge] 占位回复失败: ${e.message}`);
      }
      const elapsedMs = () => Date.now() - startedAt;
      try {
        const answer = await runAgent(content);
        if (stopThinking) stopThinking();
        const ms = elapsedMs();
        const footer = ms >= 180000
          ? `\n\n---\n✅ 执行完成 · 🐢 耗时较长（${fmtDuration(ms)}）\n💡 如需提速，可让我把诊断步骤合并成更少的 SSH 批次`
          : `\n\n---\n✅ 执行完成 · ${speedOf(ms)}（${fmtDuration(ms)}）`;
        console.log(`[bridge] agent 完成 (${Buffer.byteLength(answer, 'utf8')}B, 耗时 ${ms}ms)`);
        await sendFinal(ws, frame, streamId, truncate(answer || '(agent 无输出)', MAX_REPLY - 100) + footer);
      } catch (e) {
        if (stopThinking) stopThinking();
        const ms = elapsedMs();
        console.error(`[bridge] agent 失败: ${e.message}`);
        try {
          await sendFinal(ws, frame, streamId, `处理失败: ${truncate(e.message, 400)}\n\n---\n❌ 耗时 ${fmtDuration(ms)}`);
        } catch (e2) {
          console.error(`[bridge] 错误回复也失败: ${e2.message}`);
        }
      }
    }).catch((e) => console.error(`[bridge] 任务异常: ${e.message}`));
    queues.set(sender, task);
  });

  // 进入会话: 5 秒内回欢迎语(SDK replyWelcome)
  ws.on('event.enter_chat', (frame) => {
    const sender = frame.body?.from?.userid || 'unknown';
    console.log(`[bridge] 用户 ${sender} 进入会话`);
    ws.replyWelcome(frame, {
      msgtype: 'text',
      text: {
        content: '👋 工作区助手已就绪（工作区: PC_Aegnt）。直接发消息即可让我执行任务，例如：\n- "看看当前目录有什么文件"\n- "运行 ssh_tool 查一下 172.21.65.99 的系统信息"\n- "帮我下载 xxx 到工作区"',
      },
    }).catch((e) => console.error(`[bridge] 欢迎语发送失败: ${e.message}`));
  });

  // 其余消息类型先记录, v1 暂不处理
  ws.on('message', (frame) => {
    const type = frame.body?.msgtype;
    if (type !== 'text') console.log(`[bridge] 忽略 ${type} 消息`);
  });

  ws.connect();
}

main();
