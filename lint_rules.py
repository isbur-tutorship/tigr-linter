import ast


def _has_recursion(func, name):
    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.found = False

        def visit_Call(self, node):
            if isinstance(node.func, ast.Name) and node.func.id == name:
                self.found = True
            self.generic_visit(node)

    visitor = Visitor()
    visitor.visit(func)
    return visitor.found


def _has_base_case(func):
    for node in ast.walk(func):
        if isinstance(node, ast.If):
            for stmt in node.body:
                if isinstance(stmt, ast.Return):
                    return True
    return False


def _has_input_call(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "input":
                return node
    return None


def _has_memo_decorator(func):
    for deco in func.decorator_list:
        if isinstance(deco, ast.Name) and deco.id in ("lru_cache", "cache"):
            return True
        if isinstance(deco, ast.Attribute) and deco.attr in ("lru_cache", "cache"):
            return True
    return False


def lint_code(source, enabled_rules):
    diags = []
    try:
        tree = ast.parse(source)
    except SyntaxError as err:
        lineno = err.lineno or 1
        offset = err.offset or 1
        diags.append(
            {
                "message": f"Синтаксическая ошибка: {err.msg}",
                "severity": "error",
                "location": f"{lineno}:{offset}",
            }
        )
        return diags

    funcs = {
        node.name: node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
    }
    has_game = "game" in funcs
    has_f = "f" in funcs

    if "require-function" in enabled_rules and not (has_game or has_f):
        diags.append(
            {
                "message": "Нет функции game(...) или f(...).",
                "severity": "error",
                "location": "1:1",
            }
        )

    if "recursion" in enabled_rules:
        rec_ok = False
        if has_game and _has_recursion(funcs["game"], "game"):
            rec_ok = True
        if has_f and _has_recursion(funcs["f"], "f"):
            rec_ok = True
        if not rec_ok and (has_game or has_f):
            line = funcs["game"].lineno if has_game else funcs["f"].lineno
            diags.append(
                {
                    "message": "Рекурсивный вызов функции не найден.",
                    "severity": "error",
                    "location": f"{line}:1",
                }
            )

    if "base-case" in enabled_rules:
        base_ok = False
        for name in ("game", "f"):
            if name in funcs and _has_base_case(funcs[name]):
                base_ok = True
        if not base_ok and (has_game or has_f):
            line = funcs["game"].lineno if has_game else funcs["f"].lineno
            diags.append(
                {
                    "message": "Не найден базовый случай (if ... return).",
                    "severity": "warning",
                    "location": f"{line}:1",
                }
            )

    if "no-input" in enabled_rules:
        node = _has_input_call(tree)
        if node is not None:
            line = getattr(node, "lineno", 1)
            col = getattr(node, "col_offset", 0) + 1
            diags.append(
                {
                    "message": "Обнаружен input(). Для задач 19-21 он обычно не нужен.",
                    "severity": "info",
                    "location": f"{line}:{col}",
                }
            )

    if "memo" in enabled_rules and (has_game or has_f):
        memo_ok = False
        for name in ("game", "f"):
            if name in funcs and _has_memo_decorator(funcs[name]):
                memo_ok = True
        if not memo_ok:
            line = funcs["game"].lineno if has_game else funcs["f"].lineno
            diags.append(
                {
                    "message": "Не найдено кэширование (lru_cache/cache).",
                    "severity": "info",
                    "location": f"{line}:1",
                }
            )

    return diags
