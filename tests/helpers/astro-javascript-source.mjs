import ts from 'typescript';

// Keep legacy source assertions and extracted-function tests on the JavaScript
// that the browser receives. No assertions or product behavior are rewritten.
export function astroJavaScriptSource(source) {
  const syntax = code => {
    const tree = ts.createSourceFile('page.js', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const visit = node => {
      const children = node.getChildren(tree);
      return children.length ? [node.kind, ...children.map(visit)]
        : [node.kind, node.kind === ts.SyntaxKind.SyntaxList ? '' : node.getText(tree)];
    };
    return JSON.stringify(visit(tree));
  };
  const compile = (code, removeComments = false) => {
    const result = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments },
      reportDiagnostics: true,
    });
    if (result.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) {
      throw new Error('Cannot erase invalid Astro script TypeScript');
    }
    return result.outputText;
  };
  return source.replace(/(<script>)([\s\S]*?)(<\/script>)/g, (_, open, code, close) => {
    const erased = compile(code);
    const joined = erased
      .replace(/if (\([^\n]+\))\n\s+([^\n{}]+;)/g, 'if $1 $2')
      .replace(/}\s+catch \(/g, '} catch (')
      .replace(/\{\s+\}/g, '{}');
    const tree = ts.createSourceFile('page.js', joined, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const literalRanges = [];
    const visit = node => {
      if (ts.isTemplateLiteralToken(node) || ts.isStringLiteral(node) || ts.isRegularExpressionLiteral(node)) {
        literalRanges.push([node.getStart(tree), node.end]);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    let offset = 0;
    const indented = joined.split('\n').map(line => {
      const insideLiteral = literalRanges.some(([start, end]) => start < offset && offset < end);
      offset += line.length + 1;
      return line && !insideLiteral ? '    ' + line : line;
    }).join('\n');
    const expected = compile(erased, true);
    const actual = compile(indented, true);
    if (syntax(expected) !== syntax(actual)) {
      let at = 0;
      while (at < expected.length && expected[at] === actual[at]) at += 1;
      throw new Error('Test source formatting changed executable syntax: ' + JSON.stringify({
        at, expected: expected.slice(Math.max(0, at - 60), at + 180), actual: actual.slice(Math.max(0, at - 60), at + 180),
      }));
    }
    return open + '\n' + indented + '  ' + close;
  });
}
