const fallback = document.getElementById("fallback");
const diagnosticsEl = document.getElementById("diagnostics");
const errorCountEl = document.getElementById("errorCount");
const warnCountEl = document.getElementById("warnCount");
const infoCountEl = document.getElementById("infoCount");
const ruleListEl = document.getElementById("ruleList");

const builtinRules = [
  {
    id: "require-w",
    title: "Функция w",
    description: "Определите функцию w(a, m) или w(a, b, m).",
    severity: "error",
    enabled: true,
    message: "Нужна функция w(a, m) (или w(a, b, m)).",
  },
  {
    id: "signature",
    title: "Сигнатура",
    description: "Параметры должны быть a, m (или a, b, m).",
    severity: "error",
    enabled: true,
    message: "Сигнатура должна быть w(a, m) или w(a, b, m).",
  },
  {
    id: "recursion",
    title: "Рекурсия",
    description: "Функция должна вызывать w(...) внутри себя.",
    severity: "error",
    enabled: true,
    message: "Рекурсивные вызовы w(...) не найдены.",
  },
  {
    id: "base-win",
    title: "База: a >= 34",
    description: "Должно быть if a >= 34: return m%2==0.",
    severity: "error",
    enabled: true,
    message: "Нужен базовый случай: if a >= 34: return m%2==0.",
  },
  {
    id: "base-steps",
    title: "База: m == 0",
    description: "Должно быть if m == 0: return False.",
    severity: "error",
    enabled: true,
    message: "Нужен базовый случай: if m == 0: return False.",
  },
  {
    id: "moves",
    title: "Ходы",
    description: "Нужны ходы w(a+2, m-1) и w(a*3, m-1).",
    severity: "error",
    enabled: true,
    message: "Нужен список ходов: h = [w(a+2, m-1), w(a*3, m-1)].",
  },
  {
    id: "any-all",
    title: "any/all по m%2",
    description: "Логика any/all должна зависеть от m%2.",
    severity: "warning",
    enabled: true,
    message: "Нужна логика any/all по условию m%2.",
  },
  {
    id: "prints",
    title: "Ответы 19-21",
    description: "Нужны print для 19, 20, 21 задач.",
    severity: "info",
    enabled: true,
    message: "Нужны печати ответов для 19, 20, 21 задач.",
  },
  {
    id: "no-input",
    title: "Без input()",
    description: "Для задач 19-21 не нужен интерактивный ввод.",
    severity: "info",
    enabled: true,
    message: "Обнаружен input(). Для задач 19-21 он обычно не нужен.",
  },
];

const defaultCustomRules = [
  {
    id: "no-while",
    message: "while редко нужен в задачах 19-21",
    regex: "\\bwhile\\b",
    flags: "g",
    severity: "warning",
  },
  {
    id: "use-set",
    message: "Рекомендуется использовать set для позиций выигрыша",
    regex: "\\bset\\s*\\(",
    flags: "g",
    severity: "info",
  },
];

let editor;
let cmEditor;
let monacoReady = false;
let pyodideReady = false;
let pyodide;

function renderBuiltinRules() {
  ruleListEl.innerHTML = "";
  builtinRules.forEach((rule) => {
    const row = document.createElement("label");
    row.className = "rule";
    row.innerHTML = `
      <input type="checkbox" ${rule.enabled ? "checked" : ""} data-id="${
      rule.id
    }">
      <div>
        <strong>${rule.title}</strong>
        <span>${rule.description}</span>
      </div>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      rule.enabled = event.target.checked;
      lintNow();
    });
    ruleListEl.appendChild(row);
  });
}

function getCode() {
  if (monacoReady && editor) {
    return editor.getValue();
  }
  if (cmEditor) {
    return cmEditor.getValue();
  }
  return fallback.value;
}

function setCode(text) {
  if (monacoReady && editor) {
    editor.setValue(text);
  } else if (cmEditor) {
    cmEditor.setValue(text);
  } else {
    fallback.value = text;
  }
}

function addMarker(markers, range, message, severity) {
  markers.push({
    startLineNumber: range.line,
    startColumn: range.column,
    endLineNumber: range.line,
    endColumn: range.column + Math.max(1, range.length),
    message,
    severity,
  });
}

function lineAtIndex(text, index) {
  const lines = text.slice(0, index).split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

async function collectDiagnostics() {
  const code = getCode();
  const diags = [];
  const markers = [];
  const markersBySeverity = {
    error: 0,
    warning: 0,
    info: 0,
  };

  const enabledRuleIds = builtinRules
    .filter((rule) => rule.enabled)
    .map((rule) => rule.id);

  const astDiagnostics = await runAstLint(code, enabledRuleIds);
  astDiagnostics.forEach((diag) => {
    diags.push(diag);
    markersBySeverity[diag.severity] =
      (markersBySeverity[diag.severity] || 0) + 1;
    if (monacoReady && diag.location && diag.location.includes(":")) {
      const [line, column] = diag.location.split(":").map(Number);
      addMarker(
        markers,
        { line, column, length: 1 },
        diag.message,
        monaco.MarkerSeverity[diag.severity.toUpperCase()] ||
          monaco.MarkerSeverity.Warning
      );
    }
  });

  const customRulesRaw = document.getElementById("customRules").value;
  let customRules = [];
  try {
    customRules = JSON.parse(customRulesRaw);
  } catch (err) {
    diags.push({
      message: "Ошибка JSON в кастомных правилах: " + err.message,
      severity: "error",
      location: "custom",
    });
    markersBySeverity.error += 1;
  }

  if (Array.isArray(customRules)) {
    customRules.forEach((rule) => {
      if (!rule.regex || !rule.message) return;
      let regex;
      try {
        regex = new RegExp(rule.regex, rule.flags || "g");
      } catch (err) {
        diags.push({
          message: `Неверный regex в ${rule.id || "rule"}: ${err.message}`,
          severity: "error",
          location: "custom",
        });
        markersBySeverity.error += 1;
        return;
      }

      let match;
      while ((match = regex.exec(code)) !== null) {
        const { line, column } = lineAtIndex(code, match.index);
        diags.push({
          message: rule.message,
          severity: rule.severity || "warning",
          location: `${line}:${column}`,
        });
        markersBySeverity[rule.severity || "warning"] += 1;
        if (monacoReady) {
          addMarker(
            markers,
            { line, column, length: match[0].length },
            rule.message,
            monaco.MarkerSeverity[
              (rule.severity || "warning").toUpperCase()
            ] || monaco.MarkerSeverity.Warning
          );
        }
      }
    });
  }

  if (monacoReady && editor) {
    const model = editor.getModel();
    monaco.editor.setModelMarkers(model, "ege-linter", markers);
  }

  return { diags, counts: markersBySeverity };
}

function renderDiagnostics(diags, counts) {
  diagnosticsEl.innerHTML = "";
  if (!diags.length) {
    const ok = document.createElement("div");
    ok.className = "diag info";
    ok.textContent = "Ошибок не найдено. Можно усложнить правила.";
    diagnosticsEl.appendChild(ok);
  } else {
    diags.forEach((diag) => {
      const item = document.createElement("div");
      item.className = `diag ${diag.severity || "info"}`;
      item.textContent = `[${diag.location}] ${diag.message}`;
      diagnosticsEl.appendChild(item);
    });
  }

  errorCountEl.textContent = counts.error;
  warnCountEl.textContent = counts.warning;
  infoCountEl.textContent = counts.info;
}

async function lintNow() {
  const result = await collectDiagnostics();
  renderDiagnostics(result.diags, result.counts);
}

function initCustomRules() {
  document.getElementById("customRules").value = JSON.stringify(
    defaultCustomRules,
    null,
    2
  );
}

function initMonaco() {
  if (monacoReady) return;
  const loader = document.createElement("script");
  loader.src = "https://unpkg.com/monaco-editor@0.47.0/min/vs/loader.js";
  loader.onload = () => {
    window.require.config({
      paths: { vs: "https://unpkg.com/monaco-editor@0.47.0/min/vs" },
    });
    window.require(["vs/editor/editor.main"], () => {
      monacoReady = true;
      fallback.style.display = "none";
      editor = monaco.editor.create(document.getElementById("editor"), {
        value: fallback.value,
        language: "python",
        theme: "vs-dark",
        fontFamily: "JetBrains Mono, Fira Code, monospace",
        fontSize: 14,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
      });
      editor.onDidChangeModelContent(() => {
        lintNow();
      });
      lintNow();
    });
  };
  loader.onerror = () => {
    monacoReady = false;
    fallback.style.display = "block";
    initCodeMirror();
  };
  document.body.appendChild(loader);
}

function initCodeMirror() {
  if (cmEditor) return;
  const script = document.createElement("script");
  script.src =
    "https://cdn.jsdelivr.net/npm/codemirror@5.65.16/lib/codemirror.js";
  script.onload = () => {
    const mode = document.createElement("script");
    mode.src =
      "https://cdn.jsdelivr.net/npm/codemirror@5.65.16/mode/python/python.js";
    mode.onload = () => {
      cmEditor = CodeMirror.fromTextArea(fallback, {
        mode: "python",
        theme: "material-darker",
        lineNumbers: true,
        indentUnit: 4,
        tabSize: 4,
      });
      cmEditor.on("change", () => lintNow());
      lintNow();
    };
    document.body.appendChild(mode);
  };
  document.body.appendChild(script);
}

function loadPyodideScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

async function initPyodide() {
  if (pyodideReady) return;
  await loadPyodideScript();
  pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/",
  });

  let linterCode = "";
  const embedded = document.getElementById("lint-rules");
  if (embedded) {
    linterCode = embedded.textContent;
  }
  if (!linterCode.trim()) {
    const response = await fetch("./lint_rules.py");
    linterCode = await response.text();
  }
  await pyodide.runPythonAsync(linterCode);
  pyodideReady = true;
}

async function runAstLint(code, enabledRules) {
  try {
    if (!pyodideReady) {
      await initPyodide();
    }
    pyodide.globals.set("source_code", code);
    pyodide.globals.set("enabled_rules", enabledRules);
    const result = await pyodide.runPythonAsync(
      "lint_code(source_code, enabled_rules)"
    );
    const converted = result.toJs
      ? result.toJs({ dict_converter: Object.fromEntries })
      : result;
    return normalizeDiagnostics(converted);
  } catch (err) {
    return normalizeDiagnostics([
      {
        message: "Не удалось запустить AST-линтер: " + err.message,
        severity: "error",
        location: "1:1",
      },
    ]);
  }
}

function normalizeDiagnostics(diags) {
  if (!Array.isArray(diags)) {
    return [
      {
        message: "Линтер вернул неожиданный формат результата.",
        severity: "error",
        location: "1:1",
      },
    ];
  }
  return diags
    .map((diag) => {
      if (!diag || typeof diag !== "object") {
        return null;
      }
      if (diag instanceof Map) {
        diag = Object.fromEntries(diag);
      }
      return {
        message: diag.message || "Неизвестная диагностика",
        severity: diag.severity || "warning",
        location: diag.location || "1:1",
      };
    })
    .filter(Boolean);
}

document.getElementById("runLint").addEventListener("click", () => lintNow());
document
  .getElementById("applyCustom")
  .addEventListener("click", () => lintNow());
document.getElementById("loadSample").addEventListener("click", () => {
  setCode(`# Решение под задачи 19-21 (пример)
def w(a, m):    # def w(a, b, m): — для двух куч
    if a >= 34: return m%2==0       # Условие победы
    if m == 0: return False         # Прекращаем перебор
    h = [w(a+2, m-1), w(a*3, m-1)]  # Перебор ходов
    return any(h) if m%2 else all(h)

print(19, [s for s in range(1, 34) if w(s, 1)])
print(20, [s for s in range(1, 34) if w(s, 3) and not w(s, 1)])
print(21, [s for s in range(1, 34) if w(s, 4) and not w(s, 2)])
`);
  lintNow();
});

renderBuiltinRules();
initCustomRules();
initMonaco();
initPyodide().then(() => lintNow());
