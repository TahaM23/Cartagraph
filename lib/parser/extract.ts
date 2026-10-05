// Reading a file's imports with the TypeScript parser. Syntax only: nothing
// here resolves a specifier or touches the filesystem.

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
  /** `require(...)` calls seen. Not edges in this version, but counted. */
  requireCalls: number;
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

function namedBindingsAllTypeOnly(
  elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>,
): boolean {
  return elements.length > 0 && elements.every((el) => el.isTypeOnly);
}

export function extractImports(fileName: string, text: string): Extraction {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );

  // parseDiagnostics is not in the public typings, but it is how the
  // compiler itself reports syntax errors for a single file.
  const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    const { line, character } = sf.getLineAndCharacterOfPosition(first.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(first.messageText, " ");
    return {
      imports: [],
      requireCalls: 0,
      syntaxError: `TS${first.code} at ${line + 1}:${character + 1}: ${message}`,
    };
  }

  const imports: RawImport[] = [];
  let requireCalls = 0;
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
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1
      ) {
        requireCalls++;
      }
    } else if (ts.isImportTypeNode(node)) {
      // `typeof import("./x")` in a type position: a real, type-only import.
      const arg = node.argument;
      add("import", node, ts.isLiteralTypeNode(arg) ? arg.literal : arg, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { imports, requireCalls, syntaxError: null };
}
