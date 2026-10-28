# GNU MathProg for VS Code

GNU MathProg (GMPL) のモデル編集と、GLPK の `glpsol` による実行を支援する VS Code 拡張です。VS Code 1.85 以降に対応します。

## インストール

[GitHub Releases](https://github.com/yuuki1293/gnu-mathprog-vscode/releases/latest) から最新版の VSIX をダウンロードできます。

1. VS Code の「拡張機能」ビューを開きます。
2. 右上の「…」から「VSIX からのインストール」を選び、`gnu-mathprog-0.4.0.vsix` を指定します。
3. `.mod`、`.mpl`、`.mathprog`、`.dat` ファイルを開きます。

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
- 主要キーワードの日本語ホバー説明、宣言内容と直前のコメントの表示
- 「定義へ移動」(F12) とアウトライン表示
- `set`、`param`、`var`、`binary`、`minimize`、`maximize`、`subject`、`sum`、`solve`、`model` のスニペット（候補から選択、必要に応じ Ctrl+Space）
- `.vscode/launch.json` による名前付き実行構成、モデルと複数データファイルの指定
- モデル実行・検査、実行ログ、行番号付きエラーを「問題」へ表示
- 実行キャンセル、制限時間、信頼されたワークスペースでの実行

`.dat` は GNU MathProg に自動的に関連付けられ、構文ハイライト、キーワード補完、ホバー説明、コメント操作が使えます。データ用のスニペット `data`、`dataset`、`dataparam`、`datatable` も用意しています。ほかの用途の `.dat` には、VS Code の言語モードや `files.associations` で任意の言語を指定できます。

## 実行構成を作る

1. モデルやデータを置いたフォルダーを VS Code で開きます。
2. コマンドパレットで **MathProg: Create Run Configuration** を選びます。
3. モデル、使用するデータ（モデル内または外部ファイル）、構成名を指定します。
4. 作成された `.vscode/launch.json` を確認します。既存の構成や JSONC コメントは保持します。

実行構成は、C/C++ のように VS Code 標準の `.vscode/launch.json` に保存します。ファイル名からモデルとデータを推測しません。データファイルを開いて実行した場合も、実行構成に指定されたモデルとデータを使います。

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "mathprog",
      "request": "launch",
      "name": "生産計画・通常ケース",
      "model": "${workspaceFolder}/examples/production.mod",
      "data": ["${workspaceFolder}/examples/production.dat"],
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

この例は拡張のソースフォルダーをワークスペースとして開いた場合に実行できます。通常は手元のファイルに合わせてパスを変更してください。`examples/launch.json` にも、付属サンプル用の2つの構成を用意しています。

| 項目 | 内容 |
| --- | --- |
| `type` / `request` | `mathprog` / `launch` を指定 |
| `name` | 実行構成を区別する名前 |
| `model` | モデルファイル（必須） |
| `data` | 読み込む順番に並べたデータファイルの配列。最大10件。省略または `[]` ならモデル内のデータを使用 |
| `cwd` | 実行時の作業フォルダー。省略時は構成を保存したワークスペースフォルダー |
| `action` | `run`（既定）または `check` |
| `glpsolPath` | この構成で使う GLPK 実行ファイル。省略時は `mathprog.glpsolPath` |
| `timeLimit` | この構成の時間制限（1〜86400秒）。省略時は `mathprog.timeLimit` |

`model`、`data`、`cwd` の相対パスは、構成が属するワークスペースフォルダーを基準に解決します。`${workspaceFolder}`、`${env:...}` など VS Code 標準の変数も利用できます。CSV などをモデル内で相対パス指定している場合は、そのファイルの場所に合わせて `cwd` を設定してください。

外部データを指定するとモデル内の `data;` セクションは GLPK の仕様により無視されます。複数の `.dat` は配列の順に `--data` オプションとして渡されます。同じ名前のパラメーターを後のファイルで上書きする機能ではありません。

## 実行・検査する

- **VS Code標準の操作:** 「実行とデバッグ」ビューの一覧で作成した構成を選び、実行ボタン、F5、または「デバッグなしで実行」を使います。停止ボタンでキャンセルできます。
- **エディター・コマンドパレット:** **MathProg: Select Run Configuration** で構成を選び、▶ または **MathProg: Run Configuration** で実行します。**MathProg: Check Configuration** は同じ構成を使ってモデルの生成を検査します。

エディターの実行操作では、最後に実行・選択した構成を使います。選択がない場合、構成が1つならその構成を使い、複数ある場合は選択画面を表示します。構成がない場合は作成を案内します。「実行とデバッグ」から実行した構成も記憶します。各構成は名前を変えて追加でき、`launch.json` を共有すれば同じ組み合わせを再現できます。

結果は「出力」→「GNU MathProg」とデバッグコンソールに表示します。構成名、モデル、すべてのデータファイル、作業フォルダーもログで確認できます。付属サンプルの目的関数値は、モデル内のデータなら **260**、`production.dat` を指定した構成なら **400** です。

**MathProg: Show Output** で出力を再表示できます。実行前に構成で指定したモデルとデータファイルの編集内容を保存します。実行中に入力が変更された場合は古い診断を追加しません。

v0.3以前の「Select Data File」「Select Model File for Data」と同名モデルの探索は廃止しました。従来の組み合わせは、実行構成として作成してください。

## 宣言コメントのホバー表示

変数、集合、パラメーター、目的関数、制約の名前にホバーすると、定義に続けて宣言の直前に書いたコメントを表示します。同じファイル内の使用箇所からのホバーにも対応します。

```mathprog
# 製品ごとの生産数量
# 単位: 個
var quantity{PRODUCTS} >= 0;

/*
 * 1個あたりの費用
 * 単位: 円
 */
param cost{PRODUCTS} >= 0;
```

連続する `#` コメントと `/* ... */` コメントをまとめて表示します。コメントと宣言の間に空行や別の文がある場合、そのコメントは表示しません。別の文の行末コメントも対象外です。コメント内の Markdown やリンクは、文字列として表示します。

## 検査と制限

検査はコマンド実行時のみです。入力中や保存時に自動実行しません。`--check` では翻訳・モデル生成やモデル内の出力が実行される場合があるため、信頼できるモデルで使用してください。
エラーは `glpsol` が返す行番号を使い、その行全体を示します。編集中に古くなった診断結果は追加しません。
終了コード 0 は処理が完了したことを示します。最適解の有無、実行可能性、時間制限による打ち切りはログの解の状態を確認してください。
実行時には `--tmlim` を指定し、さらに設定時間 + 5 秒の監視タイマーで停止します。

VS Code の起動・停止UIを使いますが、モデル内のステップ実行やブレークポイントには対応していません。

定義移動・補完・アウトラインは簡易解析による同一ファイル内の宣言が対象です。添字変数のスコープ解析、ファイルをまたぐ定義移動、完全な型検査・整形・デバッグは含みません。
GLPK は同梱していません。デスクトップ版 VS Code とリモート拡張ホストに対応し、ブラウザー版には対応しません。

## 開発

開発用に Node.js 22 以降を用意してください。このフォルダーを VS Code で開き、F5 で拡張開発ホストを起動します。拡張本体は JavaScript 製でビルド不要、実行時の追加 npm 依存はありません。

```sh
npm ci
npm test
npm run package
```

`npm test` は言語解析、TextMate 構文、実行構成の検証、起動・停止の連携、プロセス実行・失敗・キャンセル・タイムアウトを検証します。
実際の GLPK によるテストは `MATHPROG_TEST_GLPSOL=/absolute/path/to/glpsol npm test` で追加実行できます。この環境変数がない場合、GLPK の実機テスト 1 件はスキップされます。

パッケージの publisher `mathprog-local` はローカル配布用の識別子です。Marketplace に公開する場合は自身の登録 publisher に変更してください。

仕様の参照: [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points)、[VSIX のパッケージ化](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)、[GNU GLPK](https://www.gnu.org/software/glpk/)。
