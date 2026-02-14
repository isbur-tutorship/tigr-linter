import ast


def _is_name(node, value):
    return isinstance(node, ast.Name) and node.id == value


def _is_const(node, value):
    return isinstance(node, ast.Constant) and node.value == value


def _is_binop(node, op_type, left_name=None, right_value=None):
    if not isinstance(node, ast.BinOp):
        return False
    if not isinstance(node.op, op_type):
        return False
    if left_name is not None and not _is_name(node.left, left_name):
        return False
    if right_value is not None and not _is_const(node.right, right_value):
        return False
    return True


def _is_compare(node, left, op_type, right_value):
    return (
        isinstance(node, ast.Compare)
        and node.left == left
        and len(node.ops) == 1
        and isinstance(node.ops[0], op_type)
        and len(node.comparators) == 1
        and _is_const(node.comparators[0], right_value)
    )


def _has_return_value(if_node, predicate):
    for stmt in if_node.body:
        if isinstance(stmt, ast.Return) and predicate(stmt.value):
            return True
    return False


def _has_input_call(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "input":
                return node
    return None


def _find_function(tree, name):
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    return None


def _has_recursion(func):
    for node in ast.walk(func):
        if isinstance(node, ast.Call) and _is_name(node.func, "w"):
            return True
    return False


def _has_base_win(func):
    for node in ast.walk(func):
        if isinstance(node, ast.If):
            if _is_compare(node.test, ast.Name("a"), ast.GtE, 34):
                def _return_pred(val):
                    if not isinstance(val, ast.Compare):
                        return False
                    if not _is_binop(val.left, ast.Mod, "m", 2):
                        return False
                    if len(val.ops) != 1 or not isinstance(val.ops[0], ast.Eq):
                        return False
                    if len(val.comparators) != 1 or not _is_const(val.comparators[0], 0):
                        return False
                    return True

                if _has_return_value(node, _return_pred):
                    return True
    return False


def _has_base_steps(func):
    for node in ast.walk(func):
        if isinstance(node, ast.If):
            if _is_compare(node.test, ast.Name("m"), ast.Eq, 0):
                if _has_return_value(node, lambda val: _is_const(val, False)):
                    return True
    return False


def _call_matches(call, a_expr, m_expr):
    if not isinstance(call, ast.Call):
        return False
    if not _is_name(call.func, "w"):
        return False
    if len(call.args) < 2:
        return False
    return call.args[0] == a_expr and call.args[-1] == m_expr


def _has_moves_list(func):
    target_a_plus = ast.BinOp(left=ast.Name("a"), op=ast.Add(), right=ast.Constant(2))
    target_a_mul = ast.BinOp(left=ast.Name("a"), op=ast.Mult(), right=ast.Constant(3))
    target_m_minus = ast.BinOp(left=ast.Name("m"), op=ast.Sub(), right=ast.Constant(1))

    for node in ast.walk(func):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            if not _is_name(node.targets[0], "h"):
                continue
            if not isinstance(node.value, ast.List) or len(node.value.elts) < 2:
                continue
            calls = [elt for elt in node.value.elts if isinstance(elt, ast.Call)]
            has_plus = any(_call_matches(c, target_a_plus, target_m_minus) for c in calls)
            has_mul = any(_call_matches(c, target_a_mul, target_m_minus) for c in calls)
            if has_plus and has_mul:
                return True
    return False


def _has_any_all_branch(func):
    any_found = False
    all_found = False
    m_mod_found = False
    for node in ast.walk(func):
        if isinstance(node, ast.IfExp):
            test = node.test
        elif isinstance(node, ast.If):
            test = node.test
        else:
            continue

        if _is_binop(test, ast.Mod, "m", 2) or (
            isinstance(test, ast.Compare)
            and _is_binop(test.left, ast.Mod, "m", 2)
        ):
            m_mod_found = True

    for node in ast.walk(func):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id == "any":
                any_found = True
            if node.func.id == "all":
                all_found = True

    return any_found and all_found and m_mod_found


def _has_prints(tree):
    targets = {19: False, 20: False, 21: False}
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if isinstance(call.func, ast.Name) and call.func.id == "print":
                if call.args and isinstance(call.args[0], ast.Constant):
                    label = call.args[0].value
                    if label in targets:
                        targets[label] = True
    return all(targets.values())


def _signature_ok(func):
    args = func.args.args
    if len(args) not in (2, 3):
        return False
    if args[0].arg != "a":
        return False
    if args[-1].arg != "m":
        return False
    if len(args) == 3 and args[1].arg != "b":
        return False
    return True


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

    func = _find_function(tree, "w")
    if func is None:
        if "require-w" in enabled_rules:
            diags.append(
                {
                    "message": "Нужна функция w(a, m) (или w(a, b, m)).",
                    "severity": "error",
                    "location": "1:1",
                }
            )
        return diags

    if "signature" in enabled_rules and not _signature_ok(func):
        diags.append(
            {
                "message": "Сигнатура должна быть w(a, m) или w(a, b, m).",
                "severity": "error",
                "location": f"{func.lineno}:1",
            }
        )

    if "recursion" in enabled_rules and not _has_recursion(func):
        diags.append(
            {
                "message": "Рекурсивные вызовы w(...) не найдены.",
                "severity": "error",
                "location": f"{func.lineno}:1",
            }
        )

    if "base-win" in enabled_rules and not _has_base_win(func):
        diags.append(
            {
                "message": "Нужен базовый случай: if a >= 34: return m%2==0.",
                "severity": "error",
                "location": f"{func.lineno}:1",
            }
        )

    if "base-steps" in enabled_rules and not _has_base_steps(func):
        diags.append(
            {
                "message": "Нужен базовый случай: if m == 0: return False.",
                "severity": "error",
                "location": f"{func.lineno}:1",
            }
        )

    if "moves" in enabled_rules and not _has_moves_list(func):
        diags.append(
            {
                "message": "Нужен список ходов: h = [w(a+2, m-1), w(a*3, m-1)].",
                "severity": "error",
                "location": f"{func.lineno}:1",
            }
        )

    if "any-all" in enabled_rules and not _has_any_all_branch(func):
        diags.append(
            {
                "message": "Нужна логика any/all по условию m%2.",
                "severity": "warning",
                "location": f"{func.lineno}:1",
            }
        )

    if "prints" in enabled_rules and not _has_prints(tree):
        diags.append(
            {
                "message": "Нужны печати ответов для 19, 20, 21 задач.",
                "severity": "info",
                "location": "1:1",
            }
        )

    return diags
