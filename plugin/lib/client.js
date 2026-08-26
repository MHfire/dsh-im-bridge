window.__ModuleLoader__.load({
	id: "@mhfire/dsh-im-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		//#region \0dsh-css:C:\Users\user\Desktop\dsh-im-bridge\plugin\src\client\PluginCard.module.css.mjs
		const css$1 = ".yj1zEa_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.yj1zEa_card:hover{border-color:var(--dsw-alias-label-dimmed)}.yj1zEa_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.yj1zEa_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.yj1zEa_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.yj1zEa_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.yj1zEa_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.yj1zEa_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.yj1zEa_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.yj1zEa_chevronOpen{transform:rotate(180deg)}.yj1zEa_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}.yj1zEa_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}.yj1zEa_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.yj1zEa_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}.yj1zEa_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}.yj1zEa_discard,.yj1zEa_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.yj1zEa_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.yj1zEa_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.yj1zEa_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.yj1zEa_discard:disabled,.yj1zEa_save:disabled{opacity:.4;cursor:default}.yj1zEa_discard:focus-visible,.yj1zEa_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";
		const tagId$1 = "@mhfire/dsh-im-bridge/PluginCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@mhfire/dsh-im-bridge";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var PluginCard_module_css_default = {
			"body": "yj1zEa_body",
			"card": "yj1zEa_card",
			"cardOpen": "yj1zEa_cardOpen",
			"chevron": "yj1zEa_chevron",
			"chevronOpen": "yj1zEa_chevronOpen",
			"description": "yj1zEa_description",
			"discard": "yj1zEa_discard",
			"failed": "yj1zEa_failed",
			"footer": "yj1zEa_footer",
			"headText": "yj1zEa_headText",
			"header": "yj1zEa_header",
			"name": "yj1zEa_name",
			"pending": "yj1zEa_pending",
			"readOnly": "yj1zEa_readOnly",
			"save": "yj1zEa_save"
		};
		//#endregion
		//#region src/client/PluginCard.tsx
		/** Expandable plugin card chrome matching the Host Plugins section. */
		/**
		* Render one plugin card.
		* @param props - locale copy, form state, and controls.
		* @returns the card, or nothing when the namespace is unavailable.
		*/
		function PluginCard(props) {
			const [open, setOpen] = (0, react.useState)(false);
			const { state } = props;
			if (!state.available) return null;
			const title = props.t(props.titleKey);
			const blocked = !state.dirty || state.invalid || state.saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: open ? `${PluginCard_module_css_default.card} ${PluginCard_module_css_default.cardOpen}` : PluginCard_module_css_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: PluginCard_module_css_default.header,
					"aria-expanded": open,
					"aria-label": `${props.t(open ? "collapse" : "expand")}: ${title}`,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: PluginCard_module_css_default.headText,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PluginCard_module_css_default.name,
								children: title
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PluginCard_module_css_default.description,
								children: props.t(props.descriptionKey)
							})]
						}),
						state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: PluginCard_module_css_default.pending,
							children: props.t("unsaved")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: open ? `${PluginCard_module_css_default.chevron} ${PluginCard_module_css_default.chevronOpen}` : PluginCard_module_css_default.chevron })
					]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: PluginCard_module_css_default.body,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: PluginCard_module_css_default.readOnly,
							role: "status",
							children: props.t("readOnly")
						}) : null,
						props.children,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PluginCard_module_css_default.footer,
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: PluginCard_module_css_default.failed,
									role: "status",
									children: props.t("saveFailed")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: PluginCard_module_css_default.discard,
									disabled: !state.dirty || state.saving,
									onClick: props.onDiscard,
									children: props.t("discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: PluginCard_module_css_default.save,
									disabled: blocked,
									onClick: props.onSave,
									children: props.t(state.saving ? "saving" : "save")
								})
							]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region \0dsh-css:C:\Users\user\Desktop\dsh-im-bridge\plugin\src\client\fields.module.css.mjs
		const css = ".OMD7cq_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}.OMD7cq_field+.OMD7cq_field{border-top:1px solid var(--dsw-alias-border-l2)}.OMD7cq_head{align-items:center;gap:8px;display:flex}.OMD7cq_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}.OMD7cq_badges{align-items:center;gap:8px;display:inline-flex}.OMD7cq_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.OMD7cq_badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}.OMD7cq_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}.OMD7cq_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.OMD7cq_reset:disabled{cursor:default}.OMD7cq_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.OMD7cq_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.OMD7cq_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.OMD7cq_input::placeholder{color:var(--dsw-alias-label-tertiary)}.OMD7cq_inputInvalid{border:1px solid var(--dsw-alias-label-error);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.OMD7cq_inputInvalid:focus-visible{outline:none}.OMD7cq_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}.OMD7cq_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.OMD7cq_install{appearance:none;font:inherit;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border:1px solid #0000;border-radius:8px;align-self:flex-start;padding:5px 14px;font-size:13px;line-height:1.5}.OMD7cq_install:hover:not(:disabled){opacity:.92}.OMD7cq_install:disabled{opacity:.4;cursor:default}.OMD7cq_install:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";
		const tagId = "@mhfire/dsh-im-bridge/fields.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@mhfire/dsh-im-bridge";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var fields_module_css_default = {
			"badge": "OMD7cq_badge",
			"badgeMuted": "OMD7cq_badgeMuted",
			"badges": "OMD7cq_badges",
			"field": "OMD7cq_field",
			"head": "OMD7cq_head",
			"hint": "OMD7cq_hint",
			"input": "OMD7cq_input",
			"inputInvalid": "OMD7cq_inputInvalid",
			"install": "OMD7cq_install",
			"invalid": "OMD7cq_invalid",
			"label": "OMD7cq_label",
			"reset": "OMD7cq_reset"
		};
		//#endregion
		//#region src/client/fields.tsx
		/**
		* A staged value field.
		* @param props - the field's copy, staged text, and edit actions.
		* @returns the labelled control.
		*/
		function ValueField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: fields_module_css_default.field,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: fields_module_css_default.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: fields_module_css_default.label,
							htmlFor: props.id,
							children: props.label
						}), props.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: fields_module_css_default.badges,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: fields_module_css_default.badge,
								children: props.overriddenLabel
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: fields_module_css_default.reset,
								disabled: props.disabled,
								onClick: props.onReset,
								children: props.resetLabel
							})]
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: props.id,
						className: props.invalid ? fields_module_css_default.inputInvalid : fields_module_css_default.input,
						type: "text",
						...props.numeric === true ? { inputMode: "numeric" } : {},
						...props.invalid ? { "aria-invalid": true } : {},
						value: props.text,
						disabled: props.disabled,
						onChange: (event) => {
							props.onEdit(event.target.value);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: props.invalid ? fields_module_css_default.invalid : fields_module_css_default.hint,
						children: props.invalid ? props.invalidLabel : props.hint
					})
				]
			});
		}
		/**
		* Write-only credential control. The literal never rides a response, so the
		* control starts blank and reports only whether one is configured. A configured
		* empty draft shows a dots placeholder so the box does not look unset.
		* @param props - the field's copy, staged text, and configured state.
		* @returns the labelled control.
		*/
		function SecretField(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: fields_module_css_default.field,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: fields_module_css_default.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: fields_module_css_default.label,
							htmlFor: props.id,
							children: props.label
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: fields_module_css_default.badges,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: props.configured ? fields_module_css_default.badge : fields_module_css_default.badgeMuted,
								children: props.stateLabel
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: props.id,
						className: fields_module_css_default.input,
						type: "password",
						autoComplete: "off",
						value: props.text,
						placeholder: props.configured && props.text === "" ? "••••••••" : void 0,
						disabled: props.disabled,
						onChange: (event) => {
							props.onEdit(event.target.value);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: fields_module_css_default.hint,
						children: props.hint
					})
				]
			});
		}
		//#endregion
		//#region src/client/WecomCard.tsx
		/**
		* Render the WeCom settings card.
		* @param props - locale copy, snapshot hook, and form actions.
		* @returns the card, or nothing when the namespace is unavailable.
		*/
		function WecomCard(props) {
			const { t } = props;
			const state = props.useWecomCard((snapshot) => snapshot);
			const disabled = !state.writable;
			const field = {
				overriddenLabel: t("overridden"),
				resetLabel: t("reset"),
				invalidLabel: t("invalidNumber"),
				disabled
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PluginCard, {
				t,
				titleKey: "title",
				descriptionKey: "description",
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretField, {
						id: "im-bridge-botId",
						label: t("botId"),
						hint: t("secretHint"),
						disabled,
						text: state.botId.text,
						configured: state.botIdConfigured,
						stateLabel: state.botIdConfigured ? t("secretConfigured") : t("secretUnset"),
						onEdit: (text) => {
							props.edit("botId", text);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretField, {
						id: "im-bridge-secret",
						label: t("secret"),
						hint: t("secretHint"),
						disabled,
						text: state.secret.text,
						configured: state.secretConfigured,
						stateLabel: state.secretConfigured ? t("secretConfigured") : t("secretUnset"),
						onEdit: (text) => {
							props.edit("secret", text);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillsInstall, {
						t,
						disabled,
						available: state.skillsInstallAvailable,
						status: state.skillsInstallStatus,
						dest: state.skillsDest,
						count: state.skillsCount,
						error: state.skillsError,
						onInstall: props.installSkills
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ValueField, {
						id: "im-bridge-allowFrom",
						label: t("allowFrom"),
						hint: t("allowFromHint"),
						...field,
						...state.allowFrom,
						onEdit: (text) => {
							props.edit("allowFrom", text);
						},
						onReset: () => {
							props.resetField("allowFrom");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ValueField, {
						id: "im-bridge-agentTimeoutSec",
						label: t("agentTimeoutSec"),
						hint: t("agentTimeoutSecHint"),
						numeric: true,
						...field,
						...state.agentTimeoutSec,
						onEdit: (text) => {
							props.edit("agentTimeoutSec", text);
						},
						onReset: () => {
							props.resetField("agentTimeoutSec");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ValueField, {
						id: "im-bridge-startHint",
						label: t("startHint"),
						hint: t("startHintHint"),
						...field,
						...state.startHint,
						onEdit: (text) => {
							props.edit("startHint", text);
						},
						onReset: () => {
							props.resetField("startHint");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ValueField, {
						id: "im-bridge-deniedMessage",
						label: t("deniedMessage"),
						hint: t("deniedMessageHint"),
						...field,
						...state.deniedMessage,
						onEdit: (text) => {
							props.edit("deniedMessage", text);
						},
						onReset: () => {
							props.resetField("deniedMessage");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ValueField, {
						id: "im-bridge-welcomeMessage",
						label: t("welcomeMessage"),
						hint: t("welcomeMessageHint"),
						...field,
						...state.welcomeMessage,
						onEdit: (text) => {
							props.edit("welcomeMessage", text);
						},
						onReset: () => {
							props.resetField("welcomeMessage");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ValueField, {
						id: "im-bridge-provider",
						label: t("provider"),
						hint: t("providerHint"),
						...field,
						...state.provider,
						onEdit: (text) => {
							props.edit("provider", text);
						},
						onReset: () => {
							props.resetField("provider");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ValueField, {
						id: "im-bridge-model",
						label: t("model"),
						hint: t("modelHint"),
						...field,
						...state.model,
						onEdit: (text) => {
							props.edit("model", text);
						},
						onReset: () => {
							props.resetField("model");
						}
					})
				]
			});
		}
		function skillsStatusText(t, status, dest, count, error, available) {
			if (!available) return t("skillsUnavailable");
			if (status === "ok") return t("skillsInstalled").replace("{count}", String(count)).replace("{dest}", dest);
			if (status === "error") return error === "" ? t("skillsFailed") : `${t("skillsFailed")} ${error}`;
			return t("skillsHint");
		}
		/**
		* Host-side install of official wecomcli-* (browser never chooses the path).
		* @param props - copy, status, and the install action.
		* @returns the labelled control.
		*/
		function SkillsInstall(props) {
			const installing = props.status === "installing";
			const status = skillsStatusText(props.t, props.status, props.dest, props.count, props.error, props.available);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: fields_module_css_default.field,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: fields_module_css_default.head,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: fields_module_css_default.label,
							children: props.t("skillsTitle")
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: fields_module_css_default.install,
						disabled: props.disabled || !props.available || installing,
						onClick: props.onInstall,
						children: props.t(installing ? "skillsInstalling" : "skillsInstall")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: props.status === "error" || !props.available ? fields_module_css_default.invalid : fields_module_css_default.hint,
						children: status
					})
				]
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
			secretSpecs;
			staged = /* @__PURE__ */ new Map();
			listeners = /* @__PURE__ */ new Set();
			saving = false;
			failed = false;
			/**
			* @param scope - bound settings scope for this card's namespace.
			* @param specs - section fields this card edits.
			* @param secrets - write-only controls; a blank draft is a no-op.
			*/
			constructor(scope, specs, secrets = []) {
				this.scope = scope;
				this.specs = new Map(specs.map((spec) => [spec.field, spec]));
				this.secretSpecs = new Map(secrets.map((spec) => [spec.field, spec]));
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
				if (this.secretSpecs.has(field)) return {
					text: staged?.text ?? "",
					overridden: false,
					invalid: false
				};
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
					const secret = this.secretSpecs.get(field);
					if (secret !== void 0) {
						const value = staged.text.trim();
						if (value !== "") plan.push({
							field,
							run: () => secret.write(value)
						});
						continue;
					}
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
			/** Rebuild bound projections for card-owned state outside the settings draft. */
			notify() {
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
		/** Settings namespace paired with this card. */
		const NS$1 = "im-bridge";
		/** Bridges the `im-bridge` scope onto the staged card form. */
		var WecomCardController = class {
			scope;
			describe;
			rpc;
			form;
			store;
			skillsInstallStatus = "idle";
			skillsDest = "";
			skillsCount = 0;
			skillsError = "";
			/**
			* @param scope - bound settings scope for the `im-bridge` namespace.
			* @param describe - Host describe face; secret literals never ride it.
			* @param rpc - optional Connection RPC for the skills install button.
			*/
			constructor(scope, describe, rpc) {
				this.scope = scope;
				this.describe = describe;
				this.rpc = rpc;
				this.form = new CardForm(scope, [
					csvField("allowFrom"),
					numberField("agentTimeoutSec"),
					textField("startHint"),
					textField("deniedMessage"),
					textField("welcomeMessage"),
					textField("provider"),
					textField("model")
				], [{
					field: "botId",
					write: (text) => this.writeSecret("botId", text)
				}, {
					field: "secret",
					write: (text) => this.writeSecret("secret", text)
				}]);
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				return {
					...this.form.shell(),
					botId: this.form.field("botId"),
					secret: this.form.field("secret"),
					botIdConfigured: this.secretConfigured("botId"),
					secretConfigured: this.secretConfigured("secret"),
					allowFrom: this.form.field("allowFrom"),
					agentTimeoutSec: this.form.field("agentTimeoutSec"),
					startHint: this.form.field("startHint"),
					deniedMessage: this.form.field("deniedMessage"),
					welcomeMessage: this.form.field("welcomeMessage"),
					provider: this.form.field("provider"),
					model: this.form.field("model"),
					skillsInstallAvailable: this.rpc !== void 0,
					skillsInstallStatus: this.skillsInstallStatus,
					skillsDest: this.skillsDest,
					skillsCount: this.skillsCount,
					skillsError: this.skillsError
				};
			}
			/**
			* Whether the Host reports a configured value for one secret slot.
			* @param field - `botId` or `secret`.
			* @returns true when describe lists that slot as set.
			*/
			secretConfigured(field) {
				return (this.describe.getSnapshot().view?.namespaces.find((candidate) => candidate.ns === NS$1))?.secrets.some((slot) => slot.path[0] === field && slot.set) === true;
			}
			/**
			* Write one credential into the user layer, then read configured state back.
			* @param field - `botId` or `secret`.
			* @param text - the staged literal.
			* @returns whether describe reports the slot set afterwards.
			*/
			async writeSecret(field, text) {
				await this.scope.set(field, text);
				return this.secretConfigured(field);
			}
			/**
			* Download official wecomcli-* into the Host-resolved directory.
			* The browser does not choose the path.
			*/
			installSkills() {
				this.runInstall();
			}
			async runInstall() {
				if (this.rpc === void 0 || this.skillsInstallStatus === "installing") return;
				this.skillsInstallStatus = "installing";
				this.skillsError = "";
				this.form.notify();
				try {
					const result = await this.rpc.call("/im-bridge", "wecomcli.installSkills", {});
					if (!result.ok) {
						this.skillsInstallStatus = "error";
						this.skillsError = result.error.message;
						this.form.notify();
						return;
					}
					const value = result.value;
					this.skillsInstallStatus = "ok";
					this.skillsDest = typeof value.dest === "string" ? value.dest : "";
					this.skillsCount = typeof value.count === "number" ? value.count : 0;
					this.skillsError = "";
				} catch (error) {
					this.skillsInstallStatus = "error";
					this.skillsError = error instanceof Error ? error.message : String(error);
				}
				this.form.notify();
			}
			/** Face the slot registration injects. */
			inject() {
				return {
					hooks: { wecomCard: this.store },
					...this.form.actions(),
					installSkills: () => {
						this.installSkills();
					}
				};
			}
		};
		//#endregion
		//#region src/client/locales.ts
		/** English copy for the im-bridge card. */
		const en = {
			title: "WeCom Bridge",
			description: "Credentials, allow-list, timeouts, and WeCom-only model overrides.",
			unsaved: "Unsaved",
			readOnly: "This document is read-only.",
			saveFailed: "Save did not land. Correct the fields and try again.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			expand: "Show settings",
			collapse: "Hide settings",
			overridden: "Overridden",
			reset: "Reset",
			invalidNumber: "Enter a finite number.",
			botId: "Bot ID",
			secret: "Secret",
			secretHint: "The box stays empty on purpose (the stored value never rides the wire). A Configured badge means it is saved; type a new value to replace it. Save, then restart the process to open the WebSocket.",
			secretConfigured: "Configured",
			secretUnset: "Not configured",
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
			modelHint: "Takes effect only together with provider.",
			skillsTitle: "WeCom office skills",
			skillsHint: "Installs wecomcli-* into the plugin directory ($DSH_HOME/wecom-cli-skills). Do not use npx skills add -g; that CLI has no --dir. An empty Bot ID / Secret box is normal.",
			skillsInstall: "Install official skills",
			skillsInstalling: "Installing…",
			skillsInstalled: "Installed {count} skills into {dest}",
			skillsFailed: "Install failed.",
			skillsUnavailable: "Install needs the Web host Connection."
		};
		/** Chinese copy for the im-bridge card. */
		const zh = {
			title: "企业微信桥接",
			description: "凭证、白名单、超时和企微专用模型覆盖。",
			unsaved: "未保存",
			readOnly: "当前文档不可写。",
			saveFailed: "保存未生效，请修正后重试。",
			save: "保存",
			saving: "保存中…",
			discard: "放弃",
			expand: "展开设置",
			collapse: "收起设置",
			overridden: "已覆盖",
			reset: "重置",
			invalidNumber: "请输入有效数字。",
			botId: "Bot ID",
			secret: "Secret",
			secretHint: "框空是正常的（已存值不会传到浏览器）。徽章「已配置」即已保存；重新输入可覆盖。保存后需重启进程才会连 WebSocket。",
			secretConfigured: "已配置",
			secretUnset: "未配置",
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
			modelHint: "仅在同时填写 provider 时生效。",
			skillsTitle: "企微办公 skills",
			skillsHint: "装到程序目录 $DSH_HOME/wecom-cli-skills。不要用 npx skills add -g；CLI 没有 --dir。Bot ID / Secret 框空是正常的。",
			skillsInstall: "安装官方 skills",
			skillsInstalling: "正在安装…",
			skillsInstalled: "已装 {count} 个到 {dest}",
			skillsFailed: "安装失败。",
			skillsUnavailable: "安装需要 Web Host 的 Connection。"
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
			const connection = ctx.get("connection");
			const card = new WecomCardController(ctx.settingsScope.bind({ namespace: NS }), ctx.settingsScope.describe(), connection?.rpc);
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