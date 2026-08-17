window.__ModuleLoader__.load({ id: '@mhfire/dsh-im-bridge', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/**
 * im-bridge 配置卡片(浏览器端)。
 * 以 tsdown 生成的工厂格式手写, 免构建: react / runtime-client 从模块表 require,
 * 其余逻辑全部内联。在 Settings → 插件配置(Plugins)页渲染 im-bridge 命名空间卡片。
 */
var React = require('react');
var createElement = React.createElement;
var useState = React.useState, useEffect = React.useEffect;
var runtimeClient = require('@deepseek-ai/dsh-client-runtime/client');
var createSnapshotStore = runtimeClient.createSnapshotStore;

var NS = 'im-bridge';

/** 卡片编辑的字段(命名空间内的可编辑项; botId/secret 属敏感项, 保留在 profile patch) */
var FIELDS = [
  { field: 'allowFrom', label: '允许的发送者 userid（逗号分隔，空 = 所有人）', kind: 'text' },
  { field: 'agentTimeoutSec', label: '单任务超时（秒）', kind: 'number' },
  { field: 'startHint', label: '开始处理时的占位提示', kind: 'text' },
  { field: 'deniedMessage', label: '非白名单拒绝文案', kind: 'text' },
  { field: 'welcomeMessage', label: '进入会话欢迎语', kind: 'text' },
];

function fmt(f, v) {
  if (f.field === 'allowFrom') return Array.isArray(v) ? v.join(',') : '';
  if (f.kind === 'number') return typeof v === 'number' ? String(v) : '';
  return typeof v === 'string' ? v : '';
}

/** 返回写入值; null = 清除; undefined = 非法(阻止保存) */
function parse(f, text) {
  if (f.field === 'allowFrom') {
    var t = text.trim();
    return t === '' ? [] : t.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  if (f.kind === 'number') {
    var t2 = text.trim();
    if (t2 === '') return null;
    var n = Number(t2);
    return Number.isFinite(n) ? n : undefined;
  }
  return text;
}

function WecomCard(props) {
  var state = props.useWecomCard ? props.useWecomCard(function (s) { return s; }) : { available: false, writable: false, value: {} };
  var value = state.value || {};
  var draftsState = useState({});
  var drafts = draftsState[0], setDrafts = draftsState[1];
  var savingState = useState(false);
  var saving = savingState[0], setSaving = savingState[1];

  useEffect(function () {
    var next = {};
    FIELDS.forEach(function (f) { next[f.field] = fmt(f, value[f.field]); });
    setDrafts(next);
  }, [state.value]);

  if (!state.available) {
    return createElement('p', { style: { color: '#888' } }, 'im-bridge 命名空间不可用');
  }

  var invalid = false;
  FIELDS.forEach(function (f) {
    var p = parse(f, drafts[f.field] === undefined ? '' : drafts[f.field]);
    if (p === undefined) invalid = true;
  });

  function onEdit(field, text) {
    setDrafts(function (d) {
      var n = {};
      Object.keys(d).forEach(function (k) { n[k] = d[k]; });
      n[field] = text;
      return n;
    });
  }

  function onSave() {
    if (invalid || saving) return;
    setSaving(true);
    var writes = [];
    FIELDS.forEach(function (f) {
      var p = parse(f, drafts[f.field] === undefined ? '' : drafts[f.field]);
      if (p === null) writes.push({ field: f.field, clear: true });
      else writes.push({ field: f.field, clear: false, value: p });
    });
    Promise.all(writes.map(function (w) {
      return w.clear ? props.scope.unset(w.field) : props.scope.set(w.field, w.value);
    })).then(function () { setSaving(false); }, function () { setSaving(false); });
  }

  return createElement('div', { style: { display: 'grid', gap: '10px' } },
    FIELDS.map(function (f) {
      return createElement('label', { key: f.field, style: { display: 'grid', gap: '2px', fontSize: '13px' } },
        createElement('span', {}, f.label),
        createElement('input', {
          type: f.kind === 'number' ? 'number' : 'text',
          value: drafts[f.field] === undefined ? '' : drafts[f.field],
          disabled: !state.writable,
          style: { width: '100%', boxSizing: 'border-box', padding: '4px 6px', fontSize: '13px' },
          onChange: function (e) { onEdit(f.field, e.target.value); },
        }),
      );
    }),
    createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px' } },
      createElement('button', {
        disabled: invalid || saving || !state.writable,
        onClick: onSave,
        style: { padding: '4px 14px', cursor: 'pointer' },
      }, saving ? '保存中…' : '保存'),
      createElement('span', { style: { fontSize: '12px', color: invalid ? '#c00' : '#888' } },
        invalid ? '存在无效输入' : (state.writable ? '' : '当前不可写')),
    ),
  );
}

function apply(ctx) {
  var scope = ctx.settingsScope.bind({ namespace: NS });

  function project() {
    var snap = scope.getSnapshot();
    return { available: snap.status === 'ready', writable: snap.writable, value: snap.value };
  }
  var store = createSnapshotStore(project());
  scope.subscribe(function () { store.set(project()); });

  ctx.effect(function () {
    return ctx.locale.register(NS, {
      zh: { title: '企业微信桥接' },
      en: { title: 'WeCom Bridge' },
    });
  }, 'im-bridge: locale dicts');

  var face = {
    hooks: { wecomCard: store },
    scope: scope,
  };

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'im-bridge',
      order: 30,
      locale: NS,
      inject: function () { return face; },
    }, WecomCard);
  });
}

exports.inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope'];
exports.apply = apply;
return module.exports; } });
