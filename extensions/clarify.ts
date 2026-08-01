/**
 * pi-clarify — rewrite plain-language prompts into precise technical prompts.
 *
 * Triggers:
 *   /clarify <rough idea>
 *   /clarify                         # rewrite current editor text
 *   /clarify model                   # show rewrite model
 *   /clarify model <provider> <id>   # pin a rewrite model
 *   /clarify model reset             # use the current session model again
 *   ... -clarify                     # marker anywhere in a message
 *
 * Config (optional):
 *   <agent-dir>/clarify.json
 *   { "provider": "<provider>", "model": "<model-id>" }
 *
 * When no config is set, the current session model is used.
 */

import { complete, type UserMessage } from "@earendil-works/pi-ai/compat";
import {
	getAgentDir,
	BorderedLoader,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hasClarifyMarker, stripClarifyMarker } from "../src/marker.ts";

const USAGE =
	"Usage: /clarify <idea> | /clarify | /clarify model [provider model|reset] | add -clarify anywhere in the message";

const SYSTEM_PROMPT = `You rewrite rough, plain-language user prompts into clear, precise prompts for a coding agent.

Your job is terminology compression and clarity, not invention.

Rules:
1. Keep the user's intent exactly. Do not add features, constraints, stack choices, or preferences they did not state.
2. When a well-known technical term matches what the user described, use that term instead of the long description.
   Examples of the kind of compression wanted:
   - "remember old card positions, measure new ones, animate between them" → "FLIP animation"
   - "thumbnail grows into the large image on the next screen so it feels like the same image" → "shared-element transition"
   - "one small part working end-to-end from UI through backend and database" → "vertical slice"
   - "show the new state right away, then fix it if the server fails" → "optimistic update"
   - "wait until the user stops typing before searching" → "debounce the search input"
   Apply the same idea in any domain: use the standard name for the pattern, algorithm, UX move, architecture choice, protocol, or process the user is describing.
3. Prefer short, exact terms over long explanations. If a term is right, use it.
4. Preserve all concrete details: product names, file names, paths, numbers, constraints, UI copy, error text, and acceptance criteria.
5. Keep the rewrite as a ready-to-send user prompt. Do not wrap it in quotes. Do not add a preamble like "Here is the rewritten prompt".
6. Use the same language the user wrote in (English stays English, Italian stays Italian, etc.).
7. If the original is already precise, make only light cleanup. Do not invent jargon or force terms that do not fit.
8. Structure multi-part asks with short bullets or numbered steps when that makes the ask clearer.
9. Do not answer the request. Only rewrite the prompt.
10. Output only the rewritten prompt text.`;

type ClarifyConfig = {
	provider: string;
	model: string;
};

type ClarifyUi = {
	hasUI: boolean;
	mode: string;
	model: ExtensionContext["model"];
	modelRegistry: ExtensionContext["modelRegistry"];
	ui: ExtensionContext["ui"];
};

type RewriteModel = NonNullable<ReturnType<ExtensionContext["modelRegistry"]["find"]>>;

function configPath(): string {
	return path.join(getAgentDir(), "clarify.json");
}

function readConfig(): ClarifyConfig | null {
	const filePath = configPath();
	if (!existsSync(filePath)) return null;

	try {
		const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<ClarifyConfig>;
		const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
		const model = typeof raw.model === "string" ? raw.model.trim() : "";
		if (!provider || !model) return null;
		return { provider, model };
	} catch {
		return null;
	}
}

function writeConfig(config: ClarifyConfig): void {
	const filePath = configPath();
	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function clearConfig(): void {
	const filePath = configPath();
	if (existsSync(filePath)) unlinkSync(filePath);
}

function resolveRewriteModel(ctx: ClarifyUi): RewriteModel | null {
	const config = readConfig();
	if (config) {
		const pinned = ctx.modelRegistry.find(config.provider, config.model);
		if (!pinned) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Clarify model not found: ${config.provider}/${config.model}. Set one with /clarify model <provider> <model>, or /clarify model reset.`,
					"error",
				);
			}
			return null;
		}
		return pinned;
	}

	if (ctx.model) return ctx.model as RewriteModel;

	if (ctx.hasUI) {
		ctx.ui.notify(
			"No model available for clarify. Select a session model, or pin one with /clarify model <provider> <model>.",
			"error",
		);
	}
	return null;
}

function describeModel(ctx: ClarifyUi): string {
	const config = readConfig();
	if (config) return `${config.provider}/${config.model} (pinned)`;
	if (ctx.model) return `${ctx.model.provider}/${ctx.model.id} (session)`;
	return "none";
}

async function callModel(
	text: string,
	model: RewriteModel,
	ctx: ClarifyUi,
	signal?: AbortSignal,
): Promise<string | null> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		throw new Error(auth.ok ? `No API key for ${model.provider}` : auth.error);
	}

	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};

	const response = await complete(
		model,
		{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			signal,
			cacheRetention: "none",
		},
	);

	if (response.stopReason === "aborted") {
		return null;
	}

	const rewritten = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();

	if (!rewritten) {
		throw new Error("Clarify returned empty text");
	}

	return rewritten;
}

async function rewritePrompt(raw: string, ctx: ClarifyUi): Promise<string | null> {
	const text = raw.trim();
	if (!text) {
		if (ctx.hasUI) ctx.ui.notify(USAGE, "warning");
		return null;
	}

	const model = resolveRewriteModel(ctx);
	if (!model) return null;

	// Interactive TUI can show a loader. Other hosts fall through to a plain call.
	if (ctx.mode === "tui" && ctx.hasUI) {
		const loaded = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(
				tui,
				theme,
				`Clarifying with ${model.provider}/${model.id}...`,
			);
			loader.onAbort = () => done(null);

			const run = async () => {
				try {
					const result = await callModel(text, model, ctx, loader.signal);
					done(result);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(message, "error");
					done(null);
				}
			};

			void run();
			return loader;
		});
		if (loaded !== undefined) return loaded;
	}

	try {
		return await callModel(text, model, ctx);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) ctx.ui.notify(message, "error");
		return null;
	}
}

async function putRewriteInEditor(raw: string, ctx: ClarifyUi): Promise<void> {
	const rewritten = await rewritePrompt(raw, ctx);
	if (rewritten === null) {
		if (ctx.hasUI) ctx.ui.notify("Cancelled", "info");
		return;
	}

	if (ctx.hasUI && typeof ctx.ui.setEditorText === "function") {
		ctx.ui.setEditorText(rewritten);
		ctx.ui.notify("Rewrite ready. Edit if needed, then send.", "info");
		return;
	}

	ctx.ui.notify(rewritten, "info");
}

function handleModelCommand(args: string[], ctx: ClarifyUi): void {
	if (args.length === 0) {
		ctx.ui.notify(
			`Clarify model: ${describeModel(ctx)} · config: ${configPath()}`,
			"info",
		);
		return;
	}

	if (args.length === 1 && args[0].toLowerCase() === "reset") {
		clearConfig();
		ctx.ui.notify(
			`Clarify model reset to session model${ctx.model ? ` (${ctx.model.provider}/${ctx.model.id})` : ""}.`,
			"info",
		);
		return;
	}

	if (args.length >= 2) {
		const provider = args[0].trim();
		const modelId = args.slice(1).join(" ").trim();
		if (!provider || !modelId) {
			ctx.ui.notify(USAGE, "warning");
			return;
		}

		const found = ctx.modelRegistry.find(provider, modelId);
		if (!found) {
			ctx.ui.notify(
				`Model not found: ${provider}/${modelId}. Check the models available in this Pi session.`,
				"error",
			);
			return;
		}

		writeConfig({ provider, model: modelId });
		ctx.ui.notify(`Clarify model pinned to ${provider}/${modelId}`, "info");
		return;
	}

	ctx.ui.notify(USAGE, "warning");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("clarify", {
		description:
			"Rewrite a rough idea into a precise technical prompt (result goes in the editor)",
		handler: async (args, ctx) => {
			const rawArgs = (args ?? "").trim();
			const parts = rawArgs ? rawArgs.split(/\s+/) : [];
			const ui: ClarifyUi = {
				hasUI: ctx.hasUI,
				mode: ctx.mode,
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				ui: ctx.ui,
			};

			if (parts[0]?.toLowerCase() === "model") {
				handleModelCommand(parts.slice(1), ui);
				return;
			}

			const fromArgs = rawArgs;
			const fromEditor =
				ctx.hasUI && typeof ctx.ui.getEditorText === "function"
					? ctx.ui.getEditorText().trim()
					: "";
			const source = fromArgs || fromEditor;

			if (!source) {
				ctx.ui.notify(USAGE, "warning");
				return;
			}

			await putRewriteInEditor(source, ui);
		},
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") {
			return { action: "continue" };
		}

		const text = event.text;
		if (!hasClarifyMarker(text)) {
			return { action: "continue" };
		}

		const rough = stripClarifyMarker(text);
		if (!rough) {
			if (ctx.hasUI) ctx.ui.notify(USAGE, "warning");
			return { action: "handled" };
		}

		const ui: ClarifyUi = {
			hasUI: ctx.hasUI,
			mode: ctx.mode,
			model: ctx.model,
			modelRegistry: ctx.modelRegistry,
			ui: ctx.ui,
		};

		await putRewriteInEditor(rough, ui);
		return { action: "handled" };
	});
}
