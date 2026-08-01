# pi-clarify

A [Pi coding agent](https://pi.dev) extension that rewrites rough, plain-language
prompts into precise technical prompts **before** you send them to the agent.

Use it when you know what you want, but not the exact term or structure.

## Install

```sh
# recommended
pi install npm:pi-clarify

# from git
pi install git:github.com/dodo-reach/pi-clarify

# from a local checkout
pi install /path/to/pi-clarify

# try once without installing
pi -e npm:pi-clarify
```

Then restart Pi or run `/reload`.

## Usage

```text
/clarify make the cards not jump when I drag them
/clarify                          # rewrite current editor text
make the cards not jump -clarify  # marker anywhere in the message
-clarify wait until typing stops before search
```

The rewrite is put back in the editor. The coding agent does **not** start until
you send the rewritten prompt.

### Model selection

By default, clarify uses the **current session model**.

Pin a cheaper or different model:

```text
/clarify model                         # show effective model
/clarify model openai gpt-5.4-mini     # pin a model from your registry
/clarify model reset                   # back to the session model
```

Pinned model config is stored in:

```text
~/.pi/agent/clarify.json
```

```json
{
  "provider": "openai",
  "model": "gpt-5.4-mini"
}
```

The model must already exist in Pi's model registry, with auth configured.

## What it does

- Registers `/clarify`
- Intercepts the `-clarify` marker anywhere in a normal message
- Calls one model turn to compress long descriptions into standard terms
- Writes the result through `setEditorText`
- Does not invent scope, stack choices, or extra requirements

## Package layout

```text
pi-clarify/
├── package.json          # pi package manifest
├── extensions/
│   └── clarify.ts        # extension entry
├── README.md
└── LICENSE
```

This package declares:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions/clarify.ts"]
  }
}
```

See the [Pi packages docs](https://pi.dev/docs/latest/packages).

## Requirements

- Pi coding agent with extension support
- A configured model and API key for the rewrite call

## License

MIT
