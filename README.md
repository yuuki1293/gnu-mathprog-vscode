# GNU MathProg for VS Code

GNU MathProg (GMPL) のモデル編集と、GLPK の `glpsol` による実行を支援する VS Code 拡張です。VS Code 1.85 以降に対応します。

## インストール

[GitHub Releases](https://github.com/yuuki1293/gnu-mathprog-vscode/releases/latest) から最新版の VSIX をダウンロードできます。

1. VS Code の「拡張機能」ビューを開きます。
2. 右上の「…」から「VSIX からのインストール」を選び、`gnu-mathprog-0.1.0.vsix` を指定します。
3. `.mod`、`.mpl`、`.mathprog` ファイルを開きます。

実行・検査には、別途 **GLPK (`glpsol`)** が必要です。構文ハイライトや補完だけなら GLPK は不要です。
GLPK は [GNU 公式サイト](https://www.gnu.org/software/glpk/) で配布されています。macOS で Homebrew を使用している場合は `brew install glpk`、Ubuntu/Debian では `sudo apt install glpk-utils` で導入できます。Windows は GLPK の実行ファイルを用意し、設定でその場所を指定してください。

`glpsol` が PATH 上にない場合、VS Code の設定で `mathprog.glpsolPath` を絶対パスにします。

```json
{
  "mathprog.glpsolPath": "/opt/homebrew/bin/glpsol",
  "mathprog.timeLimit": 60
}
```

Windows の例は `"mathprog.glpsolPath": "C:\\glpk\\bin\\glpsol.exe"` です。実行ファイルのパスに引数や引用符を含めないでください。
SSH/WSL/Dev Container 利用時は、拡張が動作するリモート環境に GLPK を用意します。

## 機能

- キーワード、関数、数値、文字列、`#` / `/* */` コメントの構文ハイライト
- 括弧・引用符の自動補完、コメント切り替え、`# region` / `# endregion` による折りたたみ
- キーワードと、同一ファイル内の集合・パラメーター・変数・目的関数・制約名の入力補完
- 主要キーワードの日本語ホバー説明、宣言内容の表示
- 「定義へ移動」(F12) とアウトライン表示
- `set`、`param`、`var`、`binary`、`minimize`、`maximize`、`subject`、`sum`、`solve`、`model` のスニペット（候補から選択、必要に応じ Ctrl+Space）
- モデル実行・検査、実行ログ、行番号付きエラーを「問題」へ表示
- モデルごとの外部 `.dat` ファイル選択（ワークスペースごとに記憶）
- 実行キャンセル、制限時間、信頼されたワークスペースでの実行

`.dat` は他言語でも広く使われるため、自動的には関連付けません。MathProg データを編集する場合は右下の言語モードから「GNU MathProg」を選べます。

## 使い方

1. 付属の `examples/production.mod` を開きます。
2. エディター右上の ▶、またはコマンドパレットの **MathProg: Run Model** で実行します。
3. 「出力」→「GNU MathProg」にログと変数・目的関数の値が表示されます。この例の目的関数値は **260** です。
4. **MathProg: Check Model** で、最適化を行わずモデルとデータの生成を検査できます。

外部データを使う場合は、モデルを開いた状態で **MathProg: Select Data File** を実行し、`examples/production.dat` を選択します。モデルを再実行すると目的関数値は **400** になります。選択中のデータパスは実行ログに表示されます。モデル内の `data;` セクションは GLPK の仕様により外部データで置き換わります。
**MathProg: Clear Data File** でモデル内のデータに戻せます。

**MathProg: Show Output** で出力を再表示できます。実行中の通知のキャンセル操作で停止できます。
実行前にモデルと、選択中で開かれているデータファイルを保存します。相対ファイルパスの基準はモデルのあるフォルダーです。

## 検査と制限

検査はコマンド実行時のみです。入力中や保存時に自動実行しません。`--check` では翻訳・モデル生成やモデル内の出力が実行される場合があるため、信頼できるモデルで使用してください。
エラーは `glpsol` が返す行番号を使い、その行全体を示します。編集中に古くなった診断結果は追加しません。
終了コード 0 は処理が完了したことを示します。最適解の有無、実行可能性、時間制限による打ち切りはログの解の状態を確認してください。
実行時には `--tmlim` を指定し、さらに設定時間 + 5 秒の監視タイマーで停止します。

定義移動・補完・アウトラインは簡易解析による同一ファイル内の宣言が対象です。添字変数のスコープ解析、ファイルをまたぐ定義移動、完全な型検査・整形・デバッグは含みません。
GLPK は同梱していません。デスクトップ版 VS Code とリモート拡張ホストに対応し、ブラウザー版には対応しません。

## 開発

開発用に Node.js 22 以降を用意してください。このフォルダーを VS Code で開き、F5 で拡張開発ホストを起動します。拡張本体は JavaScript 製でビルド不要、実行時の追加 npm 依存はありません。

```sh
npm ci
npm test
npm run package
```

`npm test` は言語解析、TextMate 構文、プロセス実行・失敗・キャンセル・タイムアウトを検証します。
実際の GLPK によるテストは `MATHPROG_TEST_GLPSOL=/absolute/path/to/glpsol npm test` で追加実行できます。この環境変数がない場合、GLPK の実機テスト 1 件はスキップされます。

パッケージの publisher `mathprog-local` はローカル配布用の識別子です。Marketplace に公開する場合は自身の登録 publisher に変更してください。

仕様の参照: [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points)、[VSIX のパッケージ化](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)、[GNU GLPK](https://www.gnu.org/software/glpk/)。
