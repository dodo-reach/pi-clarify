# pi-clarify

A [Pi coding agent](https://pi.dev) extension that rewrites rough, plain-language
prompts into precise technical prompts **before** you send them to the agent.

Use it when you know what you want, but not the exact term or structure.

## Install

```sh
pi install git:github.com/dodo-reach/pi-clarify
```

Also valid:

```sh
pi install https://github.com/dodo-reach/pi-clarify
pi install /path/to/pi-clarify
pi -e git:github.com/dodo-reach/pi-clarify
```

After install, restart Pi or run `/reload`.

## Usage

```text
/clarify make the cards not jump when I drag them
/clarify                          # rewrite current editor text
make the cards not jump -clarify  # marker anywhere in the message
-clarify wait until typing stops before search
```

The rewrite is written back through Pi's editor API (`setEditorText`).
The coding agent does **not** start until you send the rewritten prompt.

### Model selection

By default, clarify uses the **current session model**.

Pin a different model from your Pi registry:

```text
/clarify model                      # show effective model
/clarify model <provider> <model>   # pin a model
/clarify model reset                # back to the session model
```

Pinned model config is stored under the active agent directory:

```text
<agent-dir>/clarify.json
```

Example:

```json
{
  "provider": "your-provider",
  "model": "your-model-id"
}
```

For the default Pi agent dir this is usually `~/.pi/agent/clarify.json`.
The model must already exist in Pi's model registry, with auth configured.

## Behavior

- Registers `/clarify`
- Intercepts the `-clarify` marker anywhere in a normal message
- Runs one model turn to compress long descriptions into standard terms
- Preserves concrete details: names, paths, numbers, error text, acceptance criteria
- Keeps the user's language
- Does not invent scope, stack choices, or extra requirements
- Returns ready-to-send prompt text only (no quotes, no preamble)

## Package layout

```text
pi-clarify/
├── package.json
├── extensions/
│   └── clarify.ts      # Pi extension entry
├── src/
│   └── marker.ts       # pure marker helpers
├── test/
│   └── marker.test.mjs
├── README.md
└── LICENSE
```

Manifest:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions/clarify.ts"]
  }
}
```

See the [Pi packages docs](https://pi.dev/docs/latest/packages).

## Development

```sh
npm test
npm run pack:check
```

## Requirements

- Pi coding agent with extension support
- A configured session model, or a pinned model + API key

## License

MIT
