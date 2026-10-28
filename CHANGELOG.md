# Changelog

## 0.4.0

- Replace filename-based model discovery and per-file model/data choices with explicit `.vscode/launch.json` configurations.
- Add Create Run Configuration and Select Run Configuration commands, schema completion, and native VS Code launch/stop integration.
- Support ordered lists of data files, working directories, per-configuration solver paths and time limits, and check-only configurations.
- Preserve existing launch configurations and JSONC comments when adding a configuration.


## 0.3.0

- Show comments directly preceding a declaration below its definition in symbol hovers.
- Support consecutive `#` comments, multiline `/* ... */` comments, and mixed comment blocks; stop at blank lines or intervening code.

## 0.2.0

- Associate `.dat` files with GNU MathProg for highlighting and editing support.
- Add data-section, set, parameter, and table snippets.
- Run or check from a data file using a remembered or matching model; select a different model with Select Model File for Data.

## 0.1.0

- MathProg syntax highlighting, snippets, completions, hover, definitions, and outline.
- GLPK model checking and solving, separate data files, cancellation and error diagnostics.
