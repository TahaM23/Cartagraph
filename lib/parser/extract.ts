// Reading a file's imports, and what it exports through CommonJS, with the
// TypeScript parser. Syntax only: nothing here resolves a specifier or
// touches the filesystem.

import ts from "typescript";
import type { ImportKind } from "./contract.ts";

export interface RawImport {
  kind: ImportKind;
  /** The literal module specifier, or null when it is not a string literal. */
  specifier: string | null;
  /** Source text of the argument when `specifier` is null. */
  expression: string | null;
  typeOnly: boolean;
  line: number;
}

export interface Extraction {
  imports: RawImport[];
  /**
   * Names exported through `module.exports` or `exports`, sorted and distinct;
   * null when the file assigns to neither.
   */
  commonjsExports: string[] | null;
  /** The first syntax error, when there is one. Imports are then incomplete. */
  syntaxError: string | null;
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(fileName)) return ts.ScriptKind.TS;
  if (fileName.endsWith(".jsx") || fileName.endsWith(".js")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function stringLiteral(node: ts.Node | undefined): string | null {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return null;
}

/** A property name as written, when it is one: `a`, `"a"`, `1`. Computed names are not. */
function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;
}

const isIdentifierNamed = (node: ts.Node, text: string): boolean => ts.isIdentifier(node) && node.text === text;

/** `module.exports`. */
function isModuleExports(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    isIdentifierNamed(node.expression, "module") &&
    node.name.text === "exports"
  );
}

/** `exports` or `module.exports`: the object a CommonJS module's names hang off. */
function isExportsObject(node: ts.Node): boolean {
  return isIdentifierNamed(node, "exports") || isModuleExports(node);
}

/**
 * For an assignment to `exports.name` or `exports["name"]` (on either exports
 * object), the name, or null when it is computed. Undefined for any other target.
 */
function exportedMember(target: ts.Expression): { name: string | null } | undefined {
  if (ts.isPropertyAccessExpression(target) && isExportsObject(target.expression)) {
    return { name: ts.isIdentifier(target.name) ? target.name.text : null };
  }
  if (ts.isElementAccessExpression(target) && isExportsObject(target.expression)) {
    return { name: stringLiteral(target.argumentExpression) };
  }
  return undefined;
}

/** Set by compiled ES modules to mark themselves; not a name anything imports. */
const ES_MODULE_MARKER = "__esModule";

function namedBindingsAllTypeOnly(
  elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>,
): boolean {
  return elements.length > 0 && elements.every((el) => el.isTypeOnly);
}

/** A file's syntax tree, parsed the one way every reader in the parser parses it. */
export function parseSyntax(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
}

export function extractImports(fileName: string, text: string): Extraction {
  const sf = parseSyntax(fileName, text);

  // parseDiagnostics is not in the public typings, but it is how the
  // compiler itself reports syntax errors for a single file.
  const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    const { line, character } = sf.getLineAndCharacterOfPosition(first.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(first.messageText, " ");
    return {
      imports: [],
      commonjsExports: null,
      syntaxError: `TS${first.code} at ${line + 1}:${character + 1}: ${message}`,
    };
  }

  const imports: RawImport[] = [];
  const exportNames = new Set<string>();
  let assignsExports = false;
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const add = (kind: ImportKind, node: ts.Node, specNode: ts.Node | undefined, typeOnly: boolean) => {
    const specifier = stringLiteral(specNode);
    imports.push({
      kind,
      specifier,
      expression: specifier === null && specNode ? specNode.getText(sf).slice(0, 200) : null,
      typeOnly,
      line: lineOf(node),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly =
        !!clause &&
        (clause.isTypeOnly ||
          (!clause.name &&
            !!clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            namedBindingsAllTypeOnly(clause.namedBindings.elements)));
      add("import", node, node.moduleSpecifier, typeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add("import", node, node.moduleReference.expression, node.isTypeOnly);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const typeOnly =
        node.isTypeOnly ||
        (!!node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          namedBindingsAllTypeOnly(node.exportClause.elements));
      add("re_export", node, node.moduleSpecifier, typeOnly);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add("dynamic_import", node, node.arguments[0], false);
      } else if (isIdentifierNamed(node.expression, "require") && node.arguments.length === 1) {
        add("require", node, node.arguments[0], false);
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        isIdentifierNamed(node.expression.expression, "Object") &&
        node.expression.name.text === "defineProperty" &&
        node.arguments.length >= 2 &&
        isExportsObject(node.arguments[0])
      ) {
        const name = stringLiteral(node.arguments[1]);
        if (name !== ES_MODULE_MARKER) {
          assignsExports = true;
          if (name !== null) exportNames.add(name);
        }
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (isModuleExports(node.left)) {
        assignsExports = true;
        if (ts.isObjectLiteralExpression(node.right)) {
          // A spread or computed key names something only running the code would show.
          for (const property of node.right.properties) {
            const name = property.name ? propertyName(property.name) : null;
            if (name !== null) exportNames.add(name);
          }
        } else {
          exportNames.add("default");
        }
      } else {
        const member = exportedMember(node.left);
        if (member && member.name !== ES_MODULE_MARKER) {
          assignsExports = true;
          if (member.name !== null) exportNames.add(member.name);
        }
      }
    } else if (ts.isImportTypeNode(node)) {
      // `typeof import("./x")` in a type position: a real, type-only import.
      const arg = node.argument;
      add("import", node, ts.isLiteralTypeNode(arg) ? arg.literal : arg, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return {
    imports,
    commonjsExports: assignsExports ? [...exportNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : null,
    syntaxError: null,
  };
}
