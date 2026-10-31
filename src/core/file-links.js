'use strict';
// Which link in an answer means a file on this computer, and what kind of
// file it is.
//
// An agent working in a folder links the files it made: [the video](out/run.mp4),
// [the report](C:\work\report.pdf), [the fix](src/app.js:42). Nothing serves
// those paths, so the window asks the main process to show the file in its
// folder, open it with its app, or read it into the side panel.
//
// No Node and no DOM here: the window loads this as a script, the main process
// requires it, and the tests call it directly.
(function (root) {
  // A scheme needs two characters at least, so "C:\out\run.mp4" is a path and
  // "https:…" or "mailto:…" is not.
  const SCHEME = /^[a-z][a-z0-9+.-]+:/i;
  // A path that names its drive or says file://: the sanitizer drops both from
  // an answer unless it is told they are files (01-base.js). Markdown writes
  // the backslash of C:\out as %5C.
  const ABSOLUTE = /^(?:[a-z]:(?:[\\/]|%5c)|file:\/\/)/i;
  const MAX_PATH = 1024;

  const KINDS = {
    image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.svg', '.ico'],
    video: ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v', '.ogv', '.wmv', '.flv', '.mpg', '.mpeg'],
    audio: ['.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus', '.wma', '.mid', '.midi'],
    pdf: ['.pdf'],
    html: ['.html', '.htm', '.xhtml'],
    // Read by their apps, never shown as text.
    document: ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.epub'],
    archive: ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.zst'],
  };
  const KIND_BY_EXT = new Map(Object.entries(KINDS).flatMap(([kind, exts]) => exts.map((ext) => [ext, kind])));

  // Opened by the system, these run instead of showing anything: programs,
  // installers, scripts, shortcuts, and documents that carry macros. Opening
  // one asks first, whatever made the link.
  const RUNS = new Set([
    // Windows programs, installers and what stands in for them
    '.exe', '.com', '.scr', '.pif', '.msi', '.msp', '.mst', '.msix', '.msixbundle', '.appx', '.appxbundle',
    '.cpl', '.msc', '.dll', '.ocx', '.sys', '.drv', '.lnk', '.url', '.scf', '.reg', '.inf', '.gadget',
    '.application', '.appref-ms', '.xbap', '.chm', '.hlp', '.hta', '.jnlp', '.jar', '.library-ms',
    '.settingcontent-ms', '.search-ms', '.searchconnector-ms', '.iqy', '.slk', '.xll', '.appinstaller',
    '.diagcab', '.wsb', '.rdp', '.theme', '.themepack', '.deskthemepack',
    // Scripts the system runs by itself
    '.bat', '.cmd', '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsc', '.wsh', '.sct', '.shb', '.shs',
    '.ps1', '.psm1', '.psd1', '.ps1xml', '.psc1', '.py', '.pyw', '.pyc', '.pyo', '.pyz', '.pyzw',
    '.rb', '.rbw', '.pl', '.sh', '.bash', '.zsh', '.ksh', '.csh', '.fish',
    // macOS and Linux
    '.app', '.command', '.tool', '.pkg', '.mpkg', '.workflow', '.action', '.terminal', '.run', '.bin',
    '.appimage', '.desktop', '.deb', '.rpm', '.so', '.dylib',
    // Office documents with macros
    '.docm', '.dotm', '.xlsm', '.xltm', '.xlam', '.pptm', '.potm', '.ppam', '.ppsm', '.sldm',
  ]);

  // Names and extensions highlight.js does not know by themselves.
  const LANGUAGE_BY_NAME = {
    dockerfile: 'dockerfile', containerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile',
    'cmakelists.txt': 'cmake', '.gitignore': 'bash', '.dockerignore': 'bash', '.env': 'bash',
    '.bashrc': 'bash', '.zshrc': 'bash', '.profile': 'bash', '.editorconfig': 'ini', '.npmrc': 'ini',
  };
  const LANGUAGE_BY_EXT = {
    '.mjs': 'javascript', '.cjs': 'javascript', '.mts': 'typescript', '.cts': 'typescript',
    '.jsonc': 'json', '.json5': 'json', '.vue': 'xml', '.svelte': 'xml', '.astro': 'xml', '.svg': 'xml',
    '.env': 'bash', '.tf': 'ini', '.hcl': 'ini', '.lock': 'yaml', '.txt': 'plaintext', '.log': 'plaintext',
    '.csv': 'plaintext', '.tsv': 'plaintext',
  };

  function baseOf(value) {
    return String(value).split(/[\\/]/).pop() || '';
  }

  function extensionOf(value) {
    const name = baseOf(value);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '';
  }

  function decode(value) {
    if (!value.includes('%')) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  // file:///C:/out/run.mp4 -> C:/out/run.mp4, file:///home/u/a.pdf -> /home/u/a.pdf
  function fromFileUrl(value) {
    let rest = value.replace(/^file:\/\/[^/]*/i, '');
    if (/^\/[a-z]:/i.test(rest)) rest = rest.slice(1);
    return decode(rest.split('#')[0].split('?')[0]);
  }

  /**
   * The file a markdown link points at on this computer, as { path, line },
   * or null when it is a URL, an anchor on the page or nothing at all. A line
   * comes from "src/app.js:42", "src/app.js:42:7" or "src/app.js#L42".
   */
  function localFileTarget(raw) {
    let src = String(raw == null ? '' : raw).trim();
    if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1).trim();
    if (!src || src.startsWith('#') || src.includes('\0') || src.length > MAX_PATH) return null;
    let line = null;
    const anchor = /#L(\d+)(?:-L?\d+)?$/i.exec(src);
    if (anchor) line = Number(anchor[1]);
    if (/^file:\/\//i.test(src)) src = fromFileUrl(src);
    else if (SCHEME.test(src)) return null;
    else src = decode(src.split('#')[0].split('?')[0]);
    src = src.trim();
    const at = /^(.*?[^:\\/]):(\d+)(?::\d+)?$/.exec(src);
    if (at && !/^[a-z]$/i.test(at[1])) {
      src = at[1];
      line = Number(at[2]);
    }
    // Another computer's share (\\server\share, //host/path) is never a file here.
    if (!src || src === '.' || src === '/' || /^[\\/]{2}/.test(src)) return null;
    return { path: src, line: line > 0 ? line : null };
  }

  // A link the sanitizer would drop although it names a file here.
  const isAbsoluteLocal = (raw) => ABSOLUTE.test(String(raw == null ? '' : raw).trim());

  /** image, video, audio, pdf, html, document, archive, or other. */
  const kindOf = (file) => KIND_BY_EXT.get(extensionOf(file)) || 'other';

  /** Whether opening the file with its app would run it. */
  const runsWhenOpened = (file) => RUNS.has(extensionOf(file));

  // A file the side panel may show as text, going by its name: the main
  // process still looks inside it first.
  const maybeText = (file) => {
    const kind = kindOf(file);
    return kind === 'other' || kind === 'html' || extensionOf(file) === '.svg';
  };

  /** The highlight.js language for a file, or the extension for it to look up. */
  function languageOf(file) {
    const name = baseOf(file).toLowerCase();
    if (LANGUAGE_BY_NAME[name]) return LANGUAGE_BY_NAME[name];
    const ext = extensionOf(name);
    if (LANGUAGE_BY_EXT[ext]) return LANGUAGE_BY_EXT[ext];
    return ext ? ext.slice(1) : '';
  }

  const api = { extensionOf, localFileTarget, isAbsoluteLocal, kindOf, runsWhenOpened, maybeText, languageOf };
  root.CF_FILE_LINKS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
