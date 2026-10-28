# Changelog

## 0.6.0

- Add F2 Rename Symbol and Shift+F12 Find All References for model objects and data headers.
- Include configured data files across all scenarios using the same model; support initiating rename from data files.
- Preserve comments, strings, data labels, local indices, suffixes, and external table column names.
- Validate name collisions and reject ambiguous changes to data shared by different models.
- Use unsaved editor contents and native WorkspaceEdit previews/undo without saving files or invoking GLPK.

## 0.5.0

- Automatically check the selected launch configuration after saving model/data inputs, opening inputs, and changing configuration.
- Add editor toolbar and status bar toggles; remember the enabled state per workspace.
- Publish background diagnostics without opening output or notifications, and clear obsolete results when editing, switching configuration, or disabling analysis.
- Serialize background work, pause it for manual launches, wait for unsaved edits, and respect workspace trust.
- Resolve non-interactive launch variables and add a separate automatic-analysis time limit (10 seconds by default).

## 0.4.1

- Handle resource URI arguments from editor title buttons correctly instead of treating them as configuration names.

- Open the configuration creation wizard directly when Run or Check has no configuration.
- When no workspace is open, select a folder and resume creation after opening it; cancel quietly without launching anything.

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
