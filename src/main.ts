import * as core from '@actions/core'
import * as github from '@actions/github'

/**
 * action.ymlで定義されるinputs.formatの一覧
 */
const formats = ['space-delimited', 'json'] as const

/**
 * action.ymlで定義されるinputs.formatの一覧
 */
type Format = typeof formats[number]

/**
 * 入力値がFormat型の範囲であるかどうかを返します。
 *
 * @param v 検査対象の値
 * @return 値がFormatの範囲ならtrue
 */
function validateFormat(v: string): v is Format {
  return formats.some(e => e === v)
}

/**
 * Formatを文字列から作成する
 * @param v 元となる文字列
 */
function formatFrom(v: string): Format {
  if (validateFormat(v)) {
    return v as Format
  }
  throw new Error(`unsupported format ${v}`)
}

/**
 * カスタムアクションの入力
 */
class ActionInput {
  public readonly token: string
  public readonly format: Format

  constructor() {
    const options = { required: true }
    this.token = core.getInput('input', options)
    this.format = formatFrom(core.getInput('format', options))
  }
}

/**
 * カスタムアクションの出力
 */
class ActionOutput {
  private readonly all: string[]
  private readonly added: string[]
  private readonly modified: string[]
  private readonly addedModified: string[]
  private readonly removed: string[]
  private readonly renamed: string[]

  constructor(all: string[], added: string[], modified: string[], addedModified: string[], removed: string[], renamed: string[]) {
    this.all = all
    this.added = added
    this.modified = modified
    this.addedModified = addedModified
    this.removed = removed
    this.renamed = renamed
  }

  /**
   * GitHub Actionsの出力として出力する
   * @param format データフォーマット
   */
  public output(format: Format): void {
    core.setOutput('all', this.encode(this.all, format))
    core.setOutput('added', this.encode(this.added, format))
    core.setOutput('modified', this.encode(this.modified, format))
    core.setOutput('added_modified', this.encode(this.addedModified, format))
    core.setOutput('removed', this.encode(this.removed, format))
    core.setOutput('renamed', this.encode(this.renamed, format))
  }

  /**
   * ファイル名の一覧を指定された方法で単一の文字列にエンコードする
   * @param values ファイル名一覧
   * @param format データフォーマット
   * @return エンコード済み文字列
   * @private
   */
  private encode(values: string[], format: Format): string {
    switch (format) {
      case 'space-delimited':
        if (values.some(v => v.includes(' '))) {
          throw new Error(`space-delimited format can't encode white space included file name`)
        }
        return values.join(' ')
      case 'json':
        return JSON.stringify(values)
    }
  }
}

/**
 * BaseとHeadのコミットハッシュのペア
 */
class CommitHashes {
  public readonly base: string
  public readonly head: string

  constructor(base: string, head: string) {
    if (!base) {
      throw new Error('base cannot be null or undefined')
    }
    if (!head) {
      throw new Error('head cannot be null or undefined')
    }
    this.base = base
    this.head = head
  }

  /**
   * イベント名ごとに適切なデータソースからコミットハッシュを取得します。
   * @param eventName このアクションがトリガーされたイベント名
   */
  public static fromEventName(eventName: string): CommitHashes {
    switch (eventName) {
      case 'pull_request':
        return new CommitHashes(
          github.context.payload.pull_request?.base?.sha1,
          github.context.payload.pull_request?.head?.sha1,
        )
      case 'push':
        return new CommitHashes(
          github.context.payload.before,
          github.context.payload.after
        )
      default:
        throw new Error(`unsupported event ${eventName}`)
    }
  }

  /**
   * basehead形式にエンコードする。
   * @return base...head 書式の文字列
   */
  public encodeToBaseHead(): string {
    return `${this.base}...${this.head}`
  }
}

export async function runAsync(): Promise<void> {
  const input = new ActionInput()
  const octokit = github.getOctokit(input.token)

  const eventName = github.context.eventName
  const hashes = CommitHashes.fromEventName(eventName)

  const response = await octokit.rest.repos.compareCommitsWithBasehead({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    basehead: hashes.encodeToBaseHead()
  })
  if (response.status != 200) {
    throw new Error(`compareCommitsWithBasehead returned ${response.status}`)
  }
  if (response.data.status != 'ahead') {
    throw new Error(`not supported status ${response.data.status}`)
  }
  if (response.data.files === undefined) {
    throw new Error(`undefined response from compareCommitsWithBasehead`);
  }

  const filename = (file: any) => file.filename
  const only = (...status: string[]) => (file: any) => status.some(s => file.status === s)

  const files = response.data.files
  const output = new ActionOutput(
    files.map(filename),
    files.filter(only('added')).map(filename),
    files.filter(only('modified')).map(filename),
    files.filter(only('added', 'modified')).map(filename),
    files.filter(only('removed')).map(filename),
    files.filter(only('renamed')).map(filename)
  )

  output.output(input.format)
}
