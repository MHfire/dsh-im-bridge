window.__ModuleLoader__.load({
	id: "@mhfire/dsh-im-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region src/client/WecomCard.tsx
		/** WeCom settings card: own chrome, staged fields, save/discard. */
		const cardStyle = {
			listStyle: "none",
			margin: 0,
			padding: "12px 14px",
			border: "1px solid var(--dsw-border, #d0d0d0)",
			borderRadius: 8
		};
		const headerStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			width: "100%",
			background: "none",
			border: "none",
			padding: 0,
			cursor: "pointer",
			textAlign: "left"
		};
		const nameStyle = {
			fontSize: 14,
			fontWeight: 600
		};
		const descStyle = {
			fontSize: 12,
			color: "var(--dsw-muted, #888)",
			marginTop: 2
		};
		const bodyStyle = {
			display: "grid",
			gap: 10,
			marginTop: 12
		};
		const fieldStyle = {
			display: "grid",
			gap: 2,
			fontSize: 13
		};
		const inputStyle = {
			width: "100%",
			boxSizing: "border-box",
			padding: "4px 6px",
			fontSize: 13
		};
		const footerStyle = {
			display: "flex",
			gap: 8,
			alignItems: "center",
			marginTop: 4
		};
		const hintStyle = {
			fontSize: 12,
			color: "var(--dsw-muted, #888)"
		};
		function FieldRow(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				htmlFor: props.id,
				style: fieldStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [props.label, props.field.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: hintStyle,
							children: props.overriddenLabel
						}),
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: props.disabled,
							onClick: props.onReset,
							children: props.resetLabel
						})
					] }) : null] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: props.id,
						type: props.numeric === true ? "number" : "text",
						value: props.field.text,
						disabled: props.disabled,
						"aria-invalid": props.field.invalid || void 0,
						style: inputStyle,
						onChange: (event) => {
							props.onEdit(event.target.value);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							...hintStyle,
							color: props.field.invalid ? "#c00" : hintStyle.color
						},
						children: props.field.invalid ? props.invalidLabel : props.hint
					})
				]
			});
		}
		/**
		* Render the WeCom settings card.
		* @param props - locale copy, snapshot hook, and form actions.
		* @returns the card, or nothing when the namespace is unavailable.
		*/
		function WecomCard(props) {
			const { t } = props;
			const state = props.useWecomCard((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			if (!state.available) return null;
			const disabled = !state.writable;
			const blocked = !state.dirty || state.invalid || state.saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: headerStyle,
					"aria-expanded": open,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: nameStyle,
						children: t("title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: descStyle,
						children: t("description")
					})] }), state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: hintStyle,
						children: t("unsaved")
					}) : null]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: bodyStyle,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: hintStyle,
							role: "status",
							children: t("readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
							id: "im-bridge-allowFrom",
							label: t("allowFrom"),
							hint: t("allowFromHint"),
							disabled,
							field: state.allowFrom,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => {
								props.edit("allowFrom", text);
							},
							onReset: () => {
								props.resetField("allowFrom");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
							id: "im-bridge-agentTimeoutSec",
							label: t("agentTimeoutSec"),
							hint: t("agentTimeoutSecHint"),
							numeric: true,
							disabled,
							field: state.agentTimeoutSec,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => {
								props.edit("agentTimeoutSec", text);
							},
							onReset: () => {
								props.resetField("agentTimeoutSec");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
							id: "im-bridge-startHint",
							label: t("startHint"),
							hint: t("startHintHint"),
							disabled,
							field: state.startHint,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => {
								props.edit("startHint", text);
							},
							onReset: () => {
								props.resetField("startHint");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
							id: "im-bridge-deniedMessage",
							label: t("deniedMessage"),
							hint: t("deniedMessageHint"),
							disabled,
							field: state.deniedMessage,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => {
								props.edit("deniedMessage", text);
							},
							onReset: () => {
								props.resetField("deniedMessage");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
							id: "im-bridge-welcomeMessage",
							label: t("welcomeMessage"),
							hint: t("welcomeMessageHint"),
							disabled,
							field: state.welcomeMessage,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => {
								props.edit("welcomeMessage", text);
							},
							onReset: () => {
								props.resetField("welcomeMessage");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
							id: "im-bridge-provider",
							label: t("provider"),
							hint: t("providerHint"),
							disabled,
							field: state.provider,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => {
								props.edit("provider", text);
							},
							onReset: () => {
								props.resetField("provider");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FieldRow, {
							id: "im-bridge-model",
							label: t("model"),
							hint: t("modelHint"),
							disabled,
							field: state.model,
							overriddenLabel: t("overridden"),
							resetLabel: t("reset"),
							invalidLabel: t("invalidNumber"),
							onEdit: (text) => {
								props.edit("model", text);
							},
							onReset: () => {
								props.resetField("model");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: footerStyle,
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									role: "status",
									style: {
										color: "#c00",
										fontSize: 12
									},
									children: t("saveFailed")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: !state.dirty || state.saving,
									onClick: props.discard,
									children: t("discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: blocked,
									onClick: props.save,
									children: t(state.saving ? "saving" : "save")
								})
							]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/card-form.ts
		/**
		* Staged settings form owned by this plugin.
		* Mirrors the Host Plugins section model without importing its chrome.
		*/
		/** Whole-number field. Empty draft clears. */
		function numberField(field) {
			return {
				field,
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					const parsed = Number(trimmed);
					return Number.isFinite(parsed) ? {
						kind: "set",
						value: parsed
					} : void 0;
				}
			};
		}
		/** Free-text field. Empty draft clears. */
		function textField(field) {
			return {
				field,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === "" ? { kind: "clear" } : {
						kind: "set",
						value: trimmed
					};
				}
			};
		}
		/** Comma-separated string list. Empty draft stores []. */
		function csvField(field) {
			return {
				field,
				format: (value) => Array.isArray(value) ? value.join(",") : "",
				parse: (text) => {
					return {
						kind: "set",
						value: text.split(",").map((item) => item.trim()).filter(Boolean)
					};
				}
			};
		}
		/** Stages edits over one settings namespace and writes them on save. */
		var CardForm = class {
			scope;
			specs;
			staged = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			saving = false;
			failed = false;
			/**
			* @param scope - bound settings scope for this card's namespace.
			* @param specs - section fields this card edits.
			*/
			constructor(scope, specs) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				scope.subscribe(() => {
					this.publish();
				});
			}
			/** Publish a projection rebuilt whenever the scope or a draft changes. */
			bind(project) {
				const store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(project());
				this.listeners.add(() => {
					store.set(project());
				});
				return store;
			}
			/** Card-level state: what the Host serves and what a save would do. */
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: plan.length > 0,
					invalid: plan.some((item) => item.run === void 0),
					saving: this.saving,
					failed: this.failed
				};
			}
			/** One control's staged text, override badge, and validity. */
			field(field) {
				const staged = this.staged.get(field);
				const spec = this.spec(field);
				if (staged === void 0) return {
					text: spec.format(this.sectionValue(field)),
					overridden: this.stored(field),
					invalid: false
				};
				const write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
				return {
					text: staged.text,
					overridden: write?.kind === "set",
					invalid: write === void 0
				};
			}
			/** Edit, reset, save, and discard actions bound to this form. */
			actions() {
				return {
					edit: (field, text) => {
						this.stage(field, {
							text,
							clear: false
						});
					},
					resetField: (field) => {
						this.stage(field, {
							text: this.spec(field).format(this.baseValue(field)),
							clear: true
						});
					},
					save: () => {
						this.save();
					},
					discard: () => {
						if (this.staged.size === 0 && !this.failed) return;
						this.staged.clear();
						this.failed = false;
						this.publish();
					}
				};
			}
			/** Write every staged edit, then re-seed from what the Host accepted. */
			async save() {
				const plan = this.plan();
				const writes = plan.flatMap((item) => item.run === void 0 ? [] : [item.run]);
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				let landed = true;
				for (const write of writes) landed = await write() && landed;
				if (landed) this.staged.clear();
				this.saving = false;
				this.failed = !landed;
				this.publish();
			}
			plan() {
				const plan = [];
				for (const [field, staged] of this.staged) {
					const spec = this.spec(field);
					if (staged.clear) {
						if (this.stored(field)) plan.push({
							field,
							run: () => this.clear(field)
						});
						continue;
					}
					if (staged.text === spec.format(this.sectionValue(field))) continue;
					const write = spec.parse(staged.text);
					if (write === void 0) plan.push({
						field,
						run: void 0
					});
					else if (write.kind === "clear") plan.push({
						field,
						run: () => this.clear(field)
					});
					else plan.push({
						field,
						run: () => this.store(field, write.value)
					});
				}
				return plan;
			}
			async clear(field) {
				await this.scope.unset(field);
				return !this.stored(field);
			}
			async store(field, value) {
				await this.scope.set(field, value);
				return this.userLayer()?.[field] === value || Array.isArray(value) && JSON.stringify(this.userLayer()?.[field]) === JSON.stringify(value);
			}
			stage(field, edit) {
				this.staged.set(field, edit);
				this.failed = false;
				this.publish();
			}
			spec(field) {
				const spec = this.specs.get(field);
				if (spec === void 0) throw new Error(`im-bridge card has no field ${field}`);
				return spec;
			}
			snapshotOf() {
				return this.scope.getSnapshot();
			}
			sectionValue(field) {
				return this.snapshotOf().value?.[field];
			}
			baseValue(field) {
				return this.snapshotOf().base?.[field];
			}
			userLayer() {
				return this.snapshotOf().user;
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/card-controller.ts
		/** Bridges the `im-bridge` scope onto the staged card form. */
		var WecomCardController = class {
			form;
			store;
			/** @param scope - bound settings scope for the `im-bridge` namespace. */
			constructor(scope) {
				this.form = new CardForm(scope, [
					csvField("allowFrom"),
					numberField("agentTimeoutSec"),
					textField("startHint"),
					textField("deniedMessage"),
					textField("welcomeMessage"),
					textField("provider"),
					textField("model")
				]);
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				return {
					...this.form.shell(),
					allowFrom: this.form.field("allowFrom"),
					agentTimeoutSec: this.form.field("agentTimeoutSec"),
					startHint: this.form.field("startHint"),
					deniedMessage: this.form.field("deniedMessage"),
					welcomeMessage: this.form.field("welcomeMessage"),
					provider: this.form.field("provider"),
					model: this.form.field("model")
				};
			}
			/** Face the slot registration injects. */
			inject() {
				return {
					hooks: { wecomCard: this.store },
					...this.form.actions()
				};
			}
		};
		//#endregion
		//#region src/client/locales.ts
		/** English copy for the im-bridge card. */
		const en = {
			title: "WeCom Bridge",
			description: "Allow-list, timeouts, and WeCom-only model overrides.",
			unsaved: "Unsaved",
			readOnly: "This document is read-only.",
			saveFailed: "Save did not land. Correct the fields and try again.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			overridden: "Overridden",
			reset: "Reset",
			invalidNumber: "Enter a finite number.",
			allowFrom: "Allowed sender userids",
			allowFromHint: "Comma-separated. Empty allows everyone.",
			agentTimeoutSec: "Task timeout (seconds)",
			agentTimeoutSecHint: "Progress bar and remaining-time estimate.",
			startHint: "Placeholder while thinking",
			startHintHint: "First stream line after a message arrives.",
			deniedMessage: "Denied-sender reply",
			deniedMessageHint: "Sent when the userid is outside the allow-list.",
			welcomeMessage: "Welcome message",
			welcomeMessageHint: "Sent when a user opens the WeCom chat.",
			provider: "WeCom-only provider",
			providerHint: "Empty follows the GUI default model. Both provider and model must be set to override.",
			model: "WeCom-only model",
			modelHint: "Takes effect only together with provider."
		};
		/** Chinese copy for the im-bridge card. */
		const zh = {
			title: "企业微信桥接",
			description: "白名单、超时和企微专用模型覆盖。",
			unsaved: "未保存",
			readOnly: "当前文档不可写。",
			saveFailed: "保存未生效，请修正后重试。",
			save: "保存",
			saving: "保存中…",
			discard: "放弃",
			overridden: "已覆盖",
			reset: "重置",
			invalidNumber: "请输入有效数字。",
			allowFrom: "允许的发送者 userid",
			allowFromHint: "逗号分隔；空 = 允许所有人。",
			agentTimeoutSec: "单任务超时（秒）",
			agentTimeoutSecHint: "动画进度条和剩余估算的基准。",
			startHint: "开始处理时的占位提示",
			startHintHint: "收到消息后推送的第一条流式文案。",
			deniedMessage: "非白名单拒绝文案",
			deniedMessageHint: "发送者不在白名单时回复。",
			welcomeMessage: "进入会话欢迎语",
			welcomeMessageHint: "用户打开企微会话时发送。",
			provider: "企微专用 provider",
			providerHint: "空 = 跟随 GUI 默认模型。须与 model 同时填写才覆盖。",
			model: "企微专用 model",
			modelHint: "仅在同时填写 provider 时生效。"
		};
		//#endregion
		//#region src/client/index.ts
		/** Settings namespace shared with the Host half. */
		const NS = "im-bridge";
		/** Required browser services. */
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"settingsScope"
		];
		/**
		* Register locale copy and the Plugins-tab card.
		* @param ctx - browser plugin context.
		*/
		function apply(ctx) {
			const card = new WecomCardController(ctx.settingsScope.bind({ namespace: NS }));
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "im-bridge: locale dicts");
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NS,
				locale: NS,
				inject: () => card.inject()
			}, WecomCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map